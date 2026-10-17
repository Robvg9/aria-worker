-- Preserve the single explicitly authorized asynchronous device job while a
-- mission is paused waiting for that exact pending job. Human-gate pauses,
-- generic waits, blocked/cancelled missions and unrelated jobs remain denied.
--
-- Authorization invariant:
--   * running mission: job may enqueue/start/complete, subject to job ownership
--   * paused/waiting mission: only the job_id explicitly persisted under
--     checkpoint.pending_jobs while recovery.status=waiting_for_async_executor
--     may continue
--   * every other state: fail closed

CREATE OR REPLACE FUNCTION aria_internal.mission_job_authorization_allowed(
  p_mission_id text,
  p_job_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'aria_internal', 'pg_catalog'
AS $function$
DECLARE
  v_status text;
  v_checkpoint jsonb;
  v_pending_jobs jsonb;
BEGIN
  IF p_mission_id IS NULL OR p_job_id IS NULL OR length(p_job_id)=0 THEN
    RETURN false;
  END IF;

  SELECT m.status, coalesce(m.checkpoint, '{}'::jsonb)
    INTO v_status, v_checkpoint
    FROM aria_internal.mission_state m
   WHERE m.mission_id=p_mission_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_status='running' THEN
    RETURN true;
  END IF;

  IF v_status NOT IN ('paused','waiting') THEN
    RETURN false;
  END IF;

  IF coalesce(v_checkpoint->'recovery'->>'status','') <> 'waiting_for_async_executor' THEN
    RETURN false;
  END IF;

  v_pending_jobs := v_checkpoint->'pending_jobs';
  IF jsonb_typeof(v_pending_jobs) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM jsonb_each(v_pending_jobs) AS pending(step_id, job)
     WHERE pending.job->>'job_id'=p_job_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.mission_job_authorization_allowed(text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION aria_internal.cancel_unauthorized_pending_jobs(
  p_mission_id text,
  p_reason text DEFAULT 'mission_not_authorized'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'aria_internal', 'pg_catalog'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE aria_internal.execution_jobs j
     SET status=CASE WHEN j.status='queued' THEN 'blocked' ELSE 'cancelled' END,
         completed_at=clock_timestamp(),
         updated_at=clock_timestamp(),
         lease_owner=NULL,
         lease_until=NULL,
         claimed_at=NULL,
         exit_code=NULL,
         stderr=concat_ws(E'\\n', NULLIF(j.stderr,''), 'fail_closed:' || left(coalesce(p_reason,'mission_not_authorized'),160))
   WHERE j.mission_id=p_mission_id
     AND j.status IN ('queued','claimed','running')
     AND j.completed_at IS NULL
     AND NOT aria_internal.mission_job_authorization_allowed(j.mission_id,j.job_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.cancel_unauthorized_pending_jobs(text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION aria_internal.enforce_mission_job_authorization_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'aria_internal', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- Evaluate each job against the new persisted mission state. This preserves
    -- only the exact job awaiting an async executor; Human Gate pauses do not
    -- carry that marker/pending-job binding and therefore cancel all active jobs.
    PERFORM aria_internal.cancel_unauthorized_pending_jobs(
      NEW.mission_id,
      'mission_status_' || NEW.status
    );
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.enforce_mission_job_authorization_fence() FROM PUBLIC, anon, authenticated;

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
BEGIN
  -- New jobs can be enqueued only while the parent is actively running.
  -- Existing async jobs are authorized separately by their exact pending_jobs ID.
  IF p_mission_id IS NOT NULL THEN
    SELECT m.status INTO v_mission_status
      FROM aria_internal.mission_state m
     WHERE m.mission_id=p_mission_id
     FOR UPDATE;
    IF NOT FOUND OR v_mission_status <> 'running' THEN
      RAISE EXCEPTION 'mission_not_authorized_for_execution:%:%',p_mission_id,coalesce(v_mission_status,'missing')
        USING ERRCODE='42501';
    END IF;
  END IF;

  IF p_operation='computer.use.android' THEN
    RETURN aria_internal.enqueue_android_ui_job(
      p_job_id,p_mission_id,p_device_id,p_command,p_cwd,p_timeout_ms,p_policy,p_metadata
    );
  END IF;
  IF p_operation='android.notification' THEN
    RETURN aria_internal.enqueue_android_notification_job(
      p_job_id,p_mission_id,p_device_id,p_command,p_cwd,p_timeout_ms,p_policy,p_metadata
    );
  END IF;
  RETURN aria_internal.enqueue_execution_job(
    p_job_id,p_mission_id,p_device_id,p_operation,p_command,p_cwd,p_timeout_ms,p_policy,p_metadata
  );
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
  -- Read without locking the job, then use the global mission -> job lock order.
  SELECT j.mission_id INTO v_mission_id
    FROM aria_internal.execution_jobs j
   WHERE j.job_id=p_job_id AND j.device_id=p_device_id AND j.status='claimed';
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT m.status INTO v_mission_status
    FROM aria_internal.mission_state m
   WHERE m.mission_id=v_mission_id
   FOR UPDATE;

  IF NOT FOUND OR NOT aria_internal.mission_job_authorization_allowed(v_mission_id,p_job_id) THEN
    UPDATE aria_internal.execution_jobs
       SET status='cancelled',
           completed_at=clock_timestamp(),
           updated_at=clock_timestamp(),
           lease_owner=NULL,
           lease_until=NULL,
           claimed_at=NULL,
           exit_code=NULL,
           stderr=concat_ws(E'\\n', NULLIF(stderr,''), 'fail_closed:mission_not_authorized_at_start')
     WHERE job_id=p_job_id AND device_id=p_device_id AND status='claimed'
     RETURNING to_jsonb(execution_jobs.*) INTO r;
    INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    VALUES (p_job_id,p_device_id,'job.blocked_mission_not_authorized',
            jsonb_build_object('mission_id',v_mission_id,'mission_status',v_mission_status,'phase','start','at',clock_timestamp()));
    RETURN NULL;
  END IF;

  UPDATE aria_internal.execution_jobs
     SET status='running',started_at=clock_timestamp(),updated_at=clock_timestamp()
   WHERE job_id=p_job_id AND device_id=p_device_id AND status='claimed'
   RETURNING to_jsonb(execution_jobs.*) INTO r;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_execution_job_gateway(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE
  v_job aria_internal.execution_jobs%ROWTYPE;
  v_mission_status text;
  r jsonb;
BEGIN
  SELECT x.* INTO v_job
    FROM aria_internal.claim_execution_job(p_device_id) AS x
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT m.status INTO v_mission_status
    FROM aria_internal.mission_state m
   WHERE m.mission_id=v_job.mission_id;

  -- The start RPC remains the serialized final gate. This first check avoids
  -- dispatching obviously unauthorized claimed rows to a physical device.
  IF NOT FOUND OR NOT aria_internal.mission_job_authorization_allowed(v_job.mission_id,v_job.job_id) THEN
    UPDATE aria_internal.execution_jobs
       SET status='cancelled',
           completed_at=clock_timestamp(),
           updated_at=clock_timestamp(),
           lease_owner=NULL,
           lease_until=NULL,
           claimed_at=NULL,
           exit_code=NULL,
           stderr=concat_ws(E'\\n', NULLIF(stderr,''), 'fail_closed:mission_not_authorized_at_claim')
     WHERE job_id=v_job.job_id AND status='claimed'
     RETURNING to_jsonb(execution_jobs.*) INTO r;

    IF r IS NOT NULL THEN
      INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
      VALUES (v_job.job_id,p_device_id,'job.blocked_mission_not_authorized',
              jsonb_build_object('mission_id',v_job.mission_id,'mission_status',v_mission_status,'phase','claim','at',clock_timestamp()));
    END IF;
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_job);
END;
$function$;

CREATE OR REPLACE FUNCTION public.execution_job_authorization_status_gateway(
  p_job_id text,
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE
  v_mission_id text;
  v_mission_status text;
  v_job_status text;
  v_authorized boolean := false;
BEGIN
  SELECT j.mission_id INTO v_mission_id
    FROM aria_internal.execution_jobs j
   WHERE j.job_id=p_job_id AND j.device_id=p_device_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','job_not_owned_or_missing','authorized',false);
  END IF;

  -- Lock mission then job, serializing checks against mission status changes.
  SELECT m.status INTO v_mission_status
    FROM aria_internal.mission_state m
   WHERE m.mission_id=v_mission_id
   FOR UPDATE;

  SELECT j.status INTO v_job_status
    FROM aria_internal.execution_jobs j
   WHERE j.job_id=p_job_id AND j.device_id=p_device_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','job_not_owned_or_missing','authorized',false);
  END IF;

  IF NOT aria_internal.mission_job_authorization_allowed(v_mission_id,p_job_id) THEN
    IF v_job_status IN ('queued','claimed','running') THEN
      UPDATE aria_internal.execution_jobs
         SET status=CASE WHEN v_job_status='queued' THEN 'blocked' ELSE 'cancelled' END,
             completed_at=clock_timestamp(),
             updated_at=clock_timestamp(),
             lease_owner=NULL,
             lease_until=NULL,
             claimed_at=NULL,
             exit_code=NULL,
             stderr=concat_ws(E'\\n', NULLIF(stderr,''), 'fail_closed:mission_not_authorized_during_execution')
       WHERE job_id=p_job_id AND device_id=p_device_id AND completed_at IS NULL;
      v_job_status := CASE WHEN v_job_status='queued' THEN 'blocked' ELSE 'cancelled' END;
    END IF;
  ELSE
    v_authorized := v_job_status='running';
  END IF;

  RETURN jsonb_build_object(
    'job_id',p_job_id,
    'status',v_job_status,
    'mission_status',coalesce(v_mission_status,'missing'),
    'authorized',v_authorized
  );
END;
$function$;

-- A late physical completion is allowed only for a running mission or the exact
-- pending async job that caused the mission to pause. A stale completion cannot
-- turn a cancelled job back into success.
CREATE OR REPLACE FUNCTION public.complete_execution_job_gateway(
  p_job_id text,
  p_device_id text,
  p_status text,
  p_exit_code integer,
  p_stdout text,
  p_stderr text,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'aria_internal'
AS $function$
DECLARE
  r jsonb;
  v_mission_id text;
  v_mission_status text;
BEGIN
  SELECT j.mission_id INTO v_mission_id
    FROM aria_internal.execution_jobs j
   WHERE j.job_id=p_job_id
     AND j.device_id=p_device_id
     AND j.status IN ('running','claimed');
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT m.status INTO v_mission_status
    FROM aria_internal.mission_state m
   WHERE m.mission_id=v_mission_id
   FOR UPDATE;

  IF NOT FOUND OR NOT aria_internal.mission_job_authorization_allowed(v_mission_id,p_job_id) THEN
    UPDATE aria_internal.execution_jobs
       SET status='cancelled',
           completed_at=clock_timestamp(),
           updated_at=clock_timestamp(),
           lease_owner=NULL,
           lease_until=NULL,
           claimed_at=NULL,
           exit_code=NULL,
           stderr=concat_ws(E'\\n', NULLIF(stderr,''), 'fail_closed:mission_not_authorized_at_completion')
     WHERE job_id=p_job_id AND device_id=p_device_id
       AND status IN ('running','claimed') AND completed_at IS NULL
     RETURNING to_jsonb(execution_jobs.*) INTO r;

    IF r IS NOT NULL THEN
      INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
      VALUES (p_job_id,p_device_id,'job.blocked_mission_not_authorized',
              jsonb_build_object('mission_id',v_mission_id,'mission_status',v_mission_status,'phase','complete','attempted_status',p_status,'at',clock_timestamp()));
    END IF;
    RETURN NULL;
  END IF;

  UPDATE aria_internal.execution_jobs
     SET status=p_status,
         exit_code=p_exit_code,
         stdout=p_stdout,
         stderr=p_stderr,
         result=p_result,
         completed_at=clock_timestamp(),
         updated_at=clock_timestamp(),
         lease_owner=NULL,
         lease_until=NULL
   WHERE job_id=p_job_id AND device_id=p_device_id AND status IN ('running','claimed')
   RETURNING to_jsonb(execution_jobs.*),mission_id INTO r,v_mission_id;
  IF r IS NULL THEN RETURN NULL; END IF;

  INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  VALUES (p_job_id,p_device_id,'job.' || p_status,
          jsonb_build_object('exit_code',p_exit_code,'duration_ms',coalesce((p_result->>'duration_ms')::numeric,NULL),'mission_id',v_mission_id));

  IF p_status IN ('succeeded','failed','timeout') THEN
    PERFORM aria_internal.schedule_mission_runner_after_execution_job(v_mission_id,p_status,p_job_id,p_device_id);
  END IF;

  RETURN r;
END;
$function$;

-- The internal predicate may only be invoked by its SECURITY DEFINER callers.
REVOKE ALL ON FUNCTION aria_internal.mission_job_authorization_allowed(text,text) FROM PUBLIC, anon, authenticated;
