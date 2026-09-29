-- ARIA Supabase backpressure v3.
-- Keep recovery owned by the watchdog instead of repeating recovery scans on every device claim.
-- Offset the canonical cron jobs so they never fire together and avoid the top-of-hour / half-hour burst marks.

CREATE OR REPLACE FUNCTION aria_internal.claim_execution_job(p_device_id text)
RETURNS SETOF aria_internal.execution_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
DECLARE
  v_device_status text;
BEGIN
  SELECT status INTO v_device_status
    FROM aria_internal.device_registry
   WHERE device_id = p_device_id;

  IF NOT FOUND OR v_device_status = 'disabled' THEN
    RETURN;
  END IF;

  -- Recovery is owned by aria_internal.execution_jobs_watchdog().
  -- Keeping stale-job UPDATE scans out of the claim hot path prevents every idle
  -- device poll from competing with long-running recovery work on the Nano pool.

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
DECLARE
  r jsonb;
BEGIN
  SELECT to_jsonb(x) INTO r
    FROM aria_internal.claim_execution_job(p_device_id) x
   LIMIT 1;
  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_execution_job_gateway(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_execution_job_gateway(text) TO service_role;

DO $cron$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT jobid
      FROM cron.job
     WHERE jobname IN (
       'aria-autonomy-supervisor-v5-every-minute',
       'aria-execution-jobs-watchdog-every-minute',
       'aria-autonomy-supervisor-v5-every-5-minutes',
       'aria-execution-jobs-watchdog-every-2-minutes'
     )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'aria-autonomy-supervisor-v5-every-5-minutes',
    '2-59/5 * * * *',
    $cmd$
      select aria_internal.run_mission_runner_tick_v1();
      select net.http_post(
        url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-autonomy-supervisor-v5',
        headers := jsonb_build_object(
          'X-ARIA-AUTONOMY-TOKEN',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1),
          'Content-Type','application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    $cmd$
  );

  PERFORM cron.schedule(
    'aria-execution-jobs-watchdog-every-5-minutes',
    '4-59/5 * * * *',
    'select aria_internal.execution_jobs_watchdog();'
  );
END;
$cron$;

comment on function aria_internal.claim_execution_job(text)
is 'Canonical execution-job claim hot path. Recovery scans are intentionally owned by execution_jobs_watchdog and are not repeated on every device poll.';
