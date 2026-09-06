select cron.alter_job(
  23,
  command := $$SELECT net.http_post(
    url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-canonical-runtime-v1',
    headers := jsonb_build_object(
      'X-ARIA-AUTONOMY-TOKEN',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='aria_autonomy_cron_token' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );$$
);
