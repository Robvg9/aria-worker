-- Execution-job lifecycle hardening.
-- A worker lease must cover the requested timeout plus a bounded grace period.
-- A dead RUNNING lease is terminalized as timeout, never silently requeued,
-- because requeueing could duplicate a non-idempotent physical side effect.

ALTER TABLE aria_internal.execution_jobs
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE INDEX IF NOT EXISTS execution_jobs_lease_idx
  ON aria_internal.execution_jobs(status, lease_until)
  WHERE completed_at IS NULL;

CREATE OR REPLACE FUNCTION aria_internal.claim_execution_job(p_device_id text)
RETURNS SETOF aria_internal.execution_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  v_device_status text;
  v_recovered record;
BEGIN
  SELECT status INTO v_device_status
    FROM aria_internal.device_registry
   WHERE device_id = p_device_id;

  IF NOT FOUND OR v_device_status = 'disabled' THEN
    RETURN;
  END IF;

  UPDATE aria_internal.execution_jobs
     SET status='queued',
         claimed_at=NULL,
         lease_owner=NULL,
         lease_until=NULL,
         updated_at=clock_timestamp(),
         recovery_count=coalesce(recovery_count,0)+1,
         stderr=concat_ws(E'\n', NULLIF(stderr,''), 'requeued: claim lease expired before start')
   WHERE status='claimed'
     AND completed_at IS NULL
     AND lease_until IS NOT NULL
     AND lease_until < clock_timestamp();

  FOR v_recovered IN
    UPDATE aria_internal.execution_jobs
       SET status='timeout',
           completed_at=clock_timestamp(),
           updated_at=clock_timestamp(),
           lease_owner=NULL,
           lease_until=NULL,
           recovery_count=coalesce(recovery_count,0)+1,
           exit_code=NULL,
           stderr=concat_ws(E'\n', NULLIF(stderr,''), 'timeout: execution lease expired while running')
     WHERE status='running'
       AND completed_at IS NULL
       AND lease_until IS NOT NULL
       AND lease_until < clock_timestamp()
       AND updated_at < clock_timestamp() - interval '10 seconds'
     RETURNING job_id, device_id
  LOOP
    INSERT INTO aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    VALUES (
      v_recovered.job_id,
      coalesce(v_recovered.device_id, p_device_id),
      'job.timeout',
      jsonb_build_object(
        'reason','stale_running_lease',
        'recovered_by_device_id',p_device_id,
        'recovered_at',clock_timestamp()
      )
    );
  END LOOP;

  RETURN QUERY
  UPDATE aria_internal.execution_jobs j
     SET device_id=p_device_id,
         status='claimed',
         claimed_at=clock_timestamp(),
         lease_owner=md5(p_device_id || ':' || clock_timestamp()::text || ':' || random()::text),
         lease_until=clock_timestamp() + ((greatest(j.timeout_ms, 1000) + 60000)::numeric * interval '1 millisecond'),
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
$$;

REVOKE ALL ON FUNCTION aria_internal.claim_execution_job(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.claim_execution_job(text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_execution_job_gateway(p_device_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $$
DECLARE r jsonb;
BEGIN
  SELECT to_jsonb(x) INTO r
    FROM aria_internal.claim_execution_job(p_device_id) x
   LIMIT 1;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_execution_job_gateway(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_execution_job_gateway(text) TO service_role;
