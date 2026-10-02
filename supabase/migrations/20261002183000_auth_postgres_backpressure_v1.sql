-- 2026-10-02: stabilize Supabase Auth/Postgres by reducing autonomous scheduler pressure.
-- Evidence: cron jobs 42/43 (canonical supervisor/watchdog v3) repeatedly reported
-- job startup timeout while Auth emitted 500/504 and Postgres emitted statement timeout.
-- Keep autonomy enabled, but stagger it at 10-minute cadence and bound the supervisor
-- HTTP enqueue to 15s so scheduler work cannot monopolize the small Free/Nano pool.

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
       'aria-execution-jobs-watchdog-every-2-minutes',
       'aria-execution-jobs-watchdog-every-5-minutes',
       'aria-autonomy-supervisor-v5-every-10-minutes',
       'aria-execution-jobs-watchdog-every-10-minutes'
     )
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'aria-autonomy-supervisor-v5-every-10-minutes',
    '2-59/10 * * * *',
    $cmd$
      select aria_internal.run_mission_runner_tick_v1();
      select net.http_post(
        url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-autonomy-supervisor-v5',
        headers := jsonb_build_object(
          'X-ARIA-AUTONOMY-TOKEN',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1),
          'Content-Type','application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 15000
      );
    $cmd$
  );

  PERFORM cron.schedule(
    'aria-execution-jobs-watchdog-every-10-minutes',
    '7-59/10 * * * *',
    'select aria_internal.execution_jobs_watchdog();'
  );
END $$;