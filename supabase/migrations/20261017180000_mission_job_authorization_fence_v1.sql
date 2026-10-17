-- Fail-closed mission authorization fence for physical execution jobs.
-- Keep mission and job state changes coordinated under row locks.
-- Only queued/claimed jobs are cancelled when the parent mission is no longer executable.
-- A running command is not represented as safely stopped by changing DB status alone.

CREATE OR REPLACE FUNCTION aria_internal.mission_allows_execution(p_mission_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'aria_internal', 'pg_catalog'
AS $function$
  SELECT COALESCE((
    SELECT m.status IN ('running','waiting')
      FROM aria_internal.mission_state m
     WHERE m.mission_id = p_mission_id
  ), false);
$function$;

CREATE OR REPLACE FUNCTION aria_internal.cancel_unauthorized_pending_jobs(p_mission_id text, p_reason text DEFAULT 'mission_not_authorized')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'aria_internal', 'pg_catalog'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE aria_internal.execution_jobs j
     SET status = CASE WHEN j.status = 'queued' THEN 'blocked' ELSE 'cancelled' END,
         completed_at = clock_timestamp(),
         updated_at = clock_timestamp(),
         lease_owner = NULL,
         lease_until = NULL,
         claimed_at = NULL,
         exit_code = NULL,
         stderr = concat_ws(E'\\n', NULLIF(j.stderr,''), 'fail_closed:' || left(coalesce(p_reason,'mission_not_authorized'),160))
   WHERE j.mission_id = p_mission_id
     AND j.status IN ('queued','claimed')
     AND j.completed_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_execution_job_gateway(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE r jsonb;
BEGIN
  SELECT to_jsonb(x) INTO r
    FROM aria_internal.claim_execution_job(p_device_id) x
   WHERE x.mission_id IS NULL OR aria_internal.mission_allows_execution(x.mission_id)
   LIMIT 1;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_execution_job_gateway(p_job_id text, p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE
  v_mission_id text;
  v_mission_status text;
  r jsonb;
BEGIN
  -- Lock mission first, matching the mission-transition trigger's lock order.
  SELECT j.mission_id INTO v_mission_id
    FROM aria_internal.execution_jobs j
   WHERE j.job_id = p_job_id AND j.device_id = p_device_id AND j.status = 'claimed'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_mission_id IS NOT NULL THEN
    SELECT m.status INTO v_mission_status
      FROM aria_internal.mission_state m
     WHERE m.mission_id = v_mission_id
     FOR UPDATE;

    IF NOT FOUND OR v_mission_status NOT IN ('running','waiting') THEN
      UPDATE aria_internal.execution_jobs
         SET status='cancelled',
             completed_at=clock_timestamp(),
             updated_at=clock_timestamp(),
             lease_owner=NULL,
             lease_until=NULL,
             claimed_at=NULL,
             exit_code=NULL,
             stderr=concat_ws(E'\\n', NULLIF(stderr,''), 'fail_closed:mission_not_authorized_at_start')
       WHERE job_id=p_job_id AND status='claimed'
       RETURNING to_jsonb(execution_jobs.*) INTO r;
      INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
      VALUES (p_job_id,p_device_id,'job.blocked_mission_not_authorized',
              jsonb_build_object('mission_id',v_mission_id,'mission_status',v_mission_status,'phase','start','at',clock_timestamp()));
      RETURN NULL;
    END IF;
  END IF;

  UPDATE aria_internal.execution_jobs
     SET status='running', started_at=clock_timestamp(), updated_at=clock_timestamp()
   WHERE job_id=p_job_id AND device_id=p_device_id AND status='claimed'
   RETURNING to_jsonb(execution_jobs.*) INTO r;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.enforce_mission_job_authorization_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'aria_internal', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('running','waiting') THEN
    PERFORM aria_internal.cancel_unauthorized_pending_jobs(
      NEW.mission_id,
      'mission_status_' || NEW.status
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mission_job_authorization_fence ON aria_internal.mission_state;
CREATE TRIGGER trg_mission_job_authorization_fence
AFTER UPDATE OF status ON aria_internal.mission_state
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION aria_internal.enforce_mission_job_authorization_fence();

CREATE OR REPLACE FUNCTION public.enqueue_execution_job_gateway(
  p_job_id text,
  p_mission_id text,
  p_device_id text,
  p_operation text,
  p_command text,
  p_cwd text DEFAULT NULL,
  p_timeout_ms integer DEFAULT 120000,
  p_policy jsonb DEFAULT '{}'::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE
  v_mission_status text;
  r jsonb;
BEGIN
  IF p_mission_id IS NOT NULL THEN
    SELECT m.status INTO v_mission_status
      FROM aria_internal.mission_state m
     WHERE m.mission_id=p_mission_id
     FOR UPDATE;
    IF NOT FOUND OR v_mission_status NOT IN ('running','waiting') THEN
      RAISE EXCEPTION 'mission_not_authorized_for_execution:%:%',p_mission_id,coalesce(v_mission_status,'missing')
        USING ERRCODE='42501';
    END IF;
  END IF;

  INSERT INTO aria_internal.execution_jobs(
    job_id,mission_id,device_id,operation,command,cwd,timeout_ms,policy,metadata,status
  ) VALUES (
    p_job_id,p_mission_id,p_device_id,p_operation,p_command,p_cwd,
    coalesce(p_timeout_ms,120000),coalesce(p_policy,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb),'queued'
  )
  RETURNING to_jsonb(execution_jobs.*) INTO r;
  RETURN r;
END;
$function$;
