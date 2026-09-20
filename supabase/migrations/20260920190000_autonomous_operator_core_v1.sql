begin;

do $$
begin
  if exists (select 1 from cron.job where jobname='aria-mission-runner-v16-autonomous-every-minute') then
    perform cron.unschedule('aria-mission-runner-v16-autonomous-every-minute');
  end if;

  if exists (select 1 from cron.job where jobname='aria-autonomy-supervisor-v10-every-5-min') then
    perform cron.unschedule('aria-autonomy-supervisor-v10-every-5-min');
  end if;

  if not exists (select 1 from cron.job where jobname='aria-autonomy-supervisor-v5-every-minute') then
    perform cron.schedule(
      'aria-autonomy-supervisor-v5-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-autonomy-supervisor-v5',
          headers := jsonb_build_object(
            'X-ARIA-AUTONOMY-TOKEN',
            (select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1),
            'Content-Type','application/json'
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  end if;
end $$;

commit;
