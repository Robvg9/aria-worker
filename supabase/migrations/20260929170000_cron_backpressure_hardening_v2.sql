-- Canonical/idempotent cron backpressure hardening.
-- Reconciles historical every-minute names and the v1 reduced-frequency names,
-- then recreates exactly the intended canonical schedules.
DO $$
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
    '*/5 * * * *',
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
    'aria-execution-jobs-watchdog-every-2-minutes',
    '*/2 * * * *',
    'select aria_internal.execution_jobs_watchdog();'
  );
END $$;
