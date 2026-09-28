-- Phase 4: deterministic jobs + recovery hardening.
-- State machine, watchdog, backpressure, idempotency and bounded strategy repetition.

CREATE TABLE IF NOT EXISTS aria_internal.runtime_job_policy (
  policy_id smallint PRIMARY KEY,
  max_active_jobs integer NOT NULL DEFAULT 8 CHECK (max_active_jobs BETWEEN 1 AND 64),
  max_active_jobs_per_device integer NOT NULL DEFAULT 2 CHECK (max_active_jobs_per_device BETWEEN 1 AND 16),
  same_strategy_replan_threshold integer NOT NULL DEFAULT 3 CHECK (same_strategy_replan_threshold BETWEEN 1 AND 5),
  same_strategy_hard_block_threshold integer NOT NULL DEFAULT 5 CHECK (same_strategy_hard_block_threshold BETWEEN 2 AND 10),
  watchdog_grace_ms integer NOT NULL DEFAULT 10000 CHECK (watchdog_grace_ms BETWEEN 1000 AND 300000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO aria_internal.runtime_job_policy(policy_id)
VALUES (1)
ON CONFLICT (policy_id) DO NOTHING;

-- Normalize existing terminal rows before installing the invariant trigger.
UPDATE aria_internal.execution_jobs
   SET completed_at=COALESCE(completed_at,updated_at,clock_timestamp()),
       lease_owner=NULL,
       lease_until=NULL
 WHERE status IN ('succeeded','failed','timeout','cancelled','blocked')
   AND (completed_at IS NULL OR lease_owner IS NOT NULL OR lease_until IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS execution_jobs_idempotency_key_uidx
  ON aria_internal.execution_jobs(idempotency_key)
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '';

CREATE OR REPLACE FUNCTION aria_internal.execution_job_can_transition(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    CASE
      WHEN p_from = p_to THEN true
      WHEN p_from = 'queued'  THEN p_to IN ('claimed','cancelled','blocked')
      WHEN p_from = 'claimed' THEN p_to IN ('queued','running','succeeded','failed','timeout','cancelled','blocked')
      WHEN p_from = 'running' THEN p_to IN ('succeeded','failed','timeout','cancelled','blocked')
      WHEN p_from IN ('succeeded','failed','timeout','cancelled','blocked') THEN false
      ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION aria_internal.guard_execution_job_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_terminal boolean := NEW.status IN ('succeeded','failed','timeout','cancelled','blocked');
BEGIN
  IF NOT aria_internal.execution_job_can_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'invalid_execution_job_transition:%->%', OLD.status, NEW.status;
  END IF;

  IF v_terminal THEN
    IF NEW.completed_at IS NULL THEN
      RAISE EXCEPTION 'terminal_execution_job_requires_completed_at:%', NEW.status;
    END IF;
    IF NEW.lease_owner IS NOT NULL OR NEW.lease_until IS NOT NULL THEN
      RAISE EXCEPTION 'terminal_execution_job_must_release_lease:%', NEW.status;
    END IF;
  ELSIF NEW.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'nonterminal_execution_job_cannot_have_completed_at:%', NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS execution_job_transition_guard ON aria_internal.execution_jobs;
CREATE TRIGGER execution_job_transition_guard
BEFORE UPDATE OF status, completed_at, lease_owner, lease_until
ON aria_internal.execution_jobs
FOR EACH ROW
EXECUTE FUNCTION aria_internal.guard_execution_job_transition();

CREATE OR REPLACE FUNCTION aria_internal.guard_execution_job_backpressure()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  p aria_internal.runtime_job_policy;
  v_active integer;
  v_device_active integer;
BEGIN
  IF NEW.status <> 'queued' OR NEW.completed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO p
    FROM aria_internal.runtime_job_policy
   WHERE policy_id = 1
   FOR UPDATE;

  SELECT count(*)::int INTO v_active
    FROM aria_internal.execution_jobs
   WHERE completed_at IS NULL
     AND status IN ('queued','claimed','running');

  IF v_active >= p.max_active_jobs THEN
    RAISE EXCEPTION 'execution_backpressure_global:max_active_jobs=%', p.max_active_jobs;
  END IF;

  SELECT count(*)::int INTO v_device_active
    FROM aria_internal.execution_jobs
   WHERE completed_at IS NULL
     AND status IN ('queued','claimed','running')
     AND device_id = NEW.device_id;

  IF v_device_active >= p.max_active_jobs_per_device THEN
    RAISE EXCEPTION 'execution_backpressure_device:device_id=% max_active_jobs_per_device=%',
      NEW.device_id, p.max_active_jobs_per_device;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS execution_job_backpressure_guard ON aria_internal.execution_jobs;
CREATE TRIGGER execution_job_backpressure_guard
BEFORE INSERT
ON aria_internal.execution_jobs
FOR EACH ROW
EXECUTE FUNCTION aria_internal.guard_execution_job_backpressure();

CREATE OR REPLACE FUNCTION aria_internal.execution_jobs_watchdog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $$
DECLARE
  v_reclaimed integer := 0;
  v_timed_out integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  UPDATE aria_internal.execution_jobs
     SET status='queued',
         claimed_at=NULL,
         lease_owner=NULL,
         lease_until=NULL,
         updated_at=v_now,
         recovery_count=coalesce(recovery_count,0)+1,
         stderr=concat_ws(E'\n', NULLIF(stderr,''), 'watchdog: claim lease expired before start')
   WHERE status='claimed'
     AND completed_at IS NULL
     AND (
       (lease_until IS NOT NULL AND lease_until < v_now)
       OR (lease_until IS NULL AND claimed_at IS NOT NULL AND claimed_at < v_now - interval '60 seconds')
     );
  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;

  WITH stale AS (
    SELECT job_id,device_id
      FROM aria_internal.execution_jobs
     WHERE status='running'
       AND completed_at IS NULL
       AND (
         (lease_until IS NOT NULL AND lease_until < v_now)
         OR (lease_until IS NULL AND updated_at < v_now - interval '60 seconds')
       )
       AND updated_at < v_now - interval '10 seconds'
     FOR UPDATE SKIP LOCKED
  )
  UPDATE aria_internal.execution_jobs j
     SET status='timeout',
         completed_at=v_now,
         updated_at=v_now,
         lease_owner=NULL,
         lease_until=NULL,
         exit_code=NULL,
         recovery_count=coalesce(recovery_count,0)+1,
         stderr=concat_ws(E'\n', NULLIF(stderr,''), 'watchdog: running lease expired')
    FROM stale s
   WHERE j.job_id=s.job_id;

  GET DIAGNOSTICS v_timed_out = ROW_COUNT;

  INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  SELECT j.job_id,j.device_id,'job.timeout',
         jsonb_build_object('reason','watchdog_running_lease_expired','recovery_count',j.recovery_count,'recovered_at',v_now)
    FROM aria_internal.execution_jobs j
   WHERE j.updated_at=v_now
     AND j.status='timeout';

  INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  SELECT j.job_id,j.device_id,'job.recovered',
         jsonb_build_object('reason','watchdog_claim_reclaim','recovery_count',j.recovery_count,'recovered_at',v_now)
    FROM aria_internal.execution_jobs j
   WHERE j.updated_at=v_now
     AND j.status='queued'
     AND j.stderr ILIKE '%watchdog: claim lease expired%';

  RETURN jsonb_build_object(
    'ok',true,
    'reclaimed',v_reclaimed,
    'timed_out',v_timed_out,
    'checked_at',v_now,
    'policy',(SELECT to_jsonb(p) FROM aria_internal.runtime_job_policy p WHERE p.policy_id=1)
  );
END;
$$;

REVOKE ALL ON FUNCTION aria_internal.execution_jobs_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.execution_jobs_watchdog() TO service_role;

DO $cron$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
      FROM cron.job
     WHERE jobname='aria-execution-jobs-watchdog-every-minute'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'aria-execution-jobs-watchdog-every-minute',
    '* * * * *',
    'select aria_internal.execution_jobs_watchdog();'
  );
END;
$cron$;
