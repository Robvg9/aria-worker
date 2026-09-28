begin;

-- Restore the canonical mission-queue consumer without adding another scheduler.
-- The existing autonomy supervisor cron remains the single active scheduler.
create or replace function aria_internal.run_mission_runner_tick_v1()
returns bigint
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal', 'vault', 'net'
as $function$
declare
  rid bigint;
begin
  -- Backpressure: never start another runner while a live mission lease exists.
  if exists (
    select 1
      from aria_internal.mission_state m
     where m.status in ('planning','running')
       and m.lease_until is not null
       and m.lease_until > clock_timestamp()
  ) then
    return null;
  end if;

  -- Only wake the runner when at least one mission is actually reclaimable.
  if not exists (
    select 1
      from aria_internal.mission_state m
     where (
       m.status = 'queued'
       or (m.status in ('planning','running','failed') and (m.lease_until is null or m.lease_until < clock_timestamp()))
       or (m.status = 'paused' and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb) <> '{}'::jsonb)
       or (m.status = 'waiting' and coalesce(m.checkpoint->'recovery'->>'status','') = 'verification_pending')
     )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
  ) then
    return null;
  end if;

  select net.http_post(
    url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-runner-v22',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-aria-autonomy-token',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token')
    ),
    body := '{}'::jsonb
  ) into rid;

  return rid;
end;
$function$;

revoke all on function aria_internal.run_mission_runner_tick_v1() from public;
revoke all on function aria_internal.run_mission_runner_tick_v1() from anon;
revoke all on function aria_internal.run_mission_runner_tick_v1() from authenticated;
grant execute on function aria_internal.run_mission_runner_tick_v1() to service_role;

-- Keep job 34 as the only active autonomy scheduler, but reconnect the
-- canonical queued-mission consumer before the supervisor tick.
select cron.alter_job(
  job_id := 34,
  schedule := '* * * * *',
  command := $job$
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
  $job$,
  active := true
);

comment on function aria_internal.run_mission_runner_tick_v1()
is 'Canonical bounded mission queue consumer. Runs only when a claimable mission exists and no active mission lease is present; invokes aria-mission-runner-v22 via pg_net.';

commit;
