-- Phase 4 watchdog v2: same fix carried forward after remote migration watermark advanced beyond v1.
CREATE OR REPLACE FUNCTION aria_internal.execution_jobs_watchdog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, aria_internal
AS $$
DECLARE
  v_policy aria_internal.runtime_job_policy;
  v_reclaimed integer := 0;
  v_timed_out integer := 0;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_policy
    FROM aria_internal.runtime_job_policy
   WHERE policy_id=1;

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
         OR (
           started_at IS NOT NULL
           AND started_at + ((greatest(1000, coalesce(timeout_ms,120000)) + v_policy.watchdog_grace_ms) * interval '1 millisecond') < v_now
         )
         OR (
           lease_until IS NULL
           AND updated_at < v_now - interval '60 seconds'
         )
       )
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
         jsonb_build_object(
           'reason',case
             when j.started_at is not null
              and j.started_at + ((greatest(1000, coalesce(j.timeout_ms,120000)) + v_policy.watchdog_grace_ms) * interval '1 millisecond') < v_now
               then 'watchdog_running_timeout'
             else 'watchdog_running_lease_expired'
           end,
           'timeout_ms',j.timeout_ms,
           'watchdog_grace_ms',v_policy.watchdog_grace_ms,
           'recovery_count',j.recovery_count,
           'recovered_at',v_now
         )
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
    'policy',(SELECT to_jsonb(pol) FROM aria_internal.runtime_job_policy pol WHERE pol.policy_id=1)
  );
END;
$$;

REVOKE ALL ON FUNCTION aria_internal.execution_jobs_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.execution_jobs_watchdog() TO service_role;