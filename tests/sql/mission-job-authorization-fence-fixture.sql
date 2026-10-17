-- Minimal PostgreSQL contract schema for mission/job authorization-fence integration tests.
-- Mirror the Supabase API roles for permission assertions in isolated PostgreSQL.
DO $roles$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$roles$;
DO $roles$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$roles$;
DO $roles$
BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$roles$;

CREATE SCHEMA aria_internal;

CREATE TABLE aria_internal.mission_state (
  mission_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('queued','planning','running','waiting','blocked','paused','failed','succeeded','cancelled')),
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE aria_internal.execution_jobs (
  job_id text PRIMARY KEY,
  mission_id text NOT NULL REFERENCES aria_internal.mission_state(mission_id),
  device_id text,
  operation text NOT NULL,
  command text NOT NULL,
  cwd text,
  timeout_ms integer NOT NULL DEFAULT 120000,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','running','succeeded','failed','timeout','cancelled','blocked')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  exit_code integer,
  stdout text,
  stderr text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_until timestamptz,
  recovery_count integer NOT NULL DEFAULT 0
);

CREATE TABLE aria_internal.execution_job_events (
  event_id bigserial PRIMARY KEY,
  job_id text NOT NULL,
  device_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION aria_internal.execution_job_can_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $function$
  SELECT CASE
    WHEN p_from = p_to THEN true
    WHEN p_from = 'queued' THEN p_to IN ('claimed','cancelled','blocked')
    WHEN p_from = 'claimed' THEN p_to IN ('queued','running','succeeded','failed','timeout','cancelled','blocked')
    WHEN p_from = 'running' THEN p_to IN ('succeeded','failed','timeout','cancelled','blocked')
    WHEN p_from IN ('succeeded','failed','timeout','cancelled','blocked') THEN false
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.guard_execution_job_transition()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_terminal boolean := NEW.status IN ('succeeded','failed','timeout','cancelled','blocked');
BEGIN
  IF NOT aria_internal.execution_job_can_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'invalid_execution_job_transition:%->%', OLD.status, NEW.status;
  END IF;
  IF v_terminal AND NEW.completed_at IS NULL THEN
    RAISE EXCEPTION 'terminal_execution_job_requires_completed_at:%', NEW.status;
  END IF;
  IF v_terminal AND (NEW.lease_owner IS NOT NULL OR NEW.lease_until IS NOT NULL) THEN
    RAISE EXCEPTION 'terminal_execution_job_must_release_lease:%', NEW.status;
  END IF;
  IF NOT v_terminal AND NEW.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'nonterminal_execution_job_cannot_have_completed_at:%', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER execution_job_transition_guard
BEFORE UPDATE ON aria_internal.execution_jobs
FOR EACH ROW EXECUTE FUNCTION aria_internal.guard_execution_job_transition();

CREATE OR REPLACE FUNCTION aria_internal.claim_execution_job(p_device_id text)
RETURNS SETOF aria_internal.execution_jobs
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  UPDATE aria_internal.execution_jobs j
     SET device_id=p_device_id,
         status='claimed',
         claimed_at=clock_timestamp(),
         lease_owner='integration-test-lease',
         lease_until=clock_timestamp() + interval '2 minutes',
         updated_at=clock_timestamp()
   WHERE j.job_id=(
     SELECT q.job_id
       FROM aria_internal.execution_jobs q
      WHERE q.status='queued'
        AND (q.device_id IS NULL OR q.device_id=p_device_id)
      ORDER BY q.requested_at,q.job_id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING j.*;
END;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.enqueue_execution_job(
  p_job_id text,
  p_mission_id text,
  p_device_id text,
  p_operation text,
  p_command text,
  p_cwd text,
  p_timeout_ms integer,
  p_policy jsonb,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $function$
DECLARE r jsonb;
BEGIN
  INSERT INTO aria_internal.execution_jobs(job_id,mission_id,device_id,operation,command,cwd,timeout_ms,policy,metadata,status)
  VALUES (p_job_id,p_mission_id,p_device_id,p_operation,p_command,p_cwd,coalesce(p_timeout_ms,120000),coalesce(p_policy,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb),'queued')
  ON CONFLICT (job_id) DO NOTHING;
  SELECT to_jsonb(j) INTO r FROM aria_internal.execution_jobs j WHERE j.job_id=p_job_id;
  RETURN r;
END;
$function$;


CREATE OR REPLACE FUNCTION aria_internal.schedule_mission_runner_after_execution_job(
  p_mission_id text,
  p_status text,
  p_job_id text,
  p_device_id text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN;
END;
$function$;

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
BEGIN
  UPDATE aria_internal.execution_jobs
     SET status=p_status,
         exit_code=p_exit_code,
         stdout=p_stdout,
         stderr=p_stderr,
         result=p_result,
         completed_at=now(),
         updated_at=now(),
         lease_owner=NULL,
         lease_until=NULL
   WHERE job_id=p_job_id
     AND device_id=p_device_id
     AND status IN ('running','claimed')
   RETURNING to_jsonb(execution_jobs.*), mission_id
      INTO r, v_mission_id;
  IF r IS NULL THEN RETURN NULL; END IF;

  INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  VALUES (p_job_id,p_device_id,'job.'||p_status,
          jsonb_build_object('exit_code',p_exit_code,'mission_id',v_mission_id));
  IF p_status IN ('succeeded','failed','timeout') THEN
    PERFORM aria_internal.schedule_mission_runner_after_execution_job(
      v_mission_id,p_status,p_job_id,p_device_id
    );
  END IF;
  RETURN r;
END;
$function$;
