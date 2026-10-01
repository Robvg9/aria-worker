create or replace function aria_internal.run_mission_runner_tick_v1()
returns bigint
language plpgsql
security definer
set search_path = 'pg_catalog','aria_internal','vault','net'
as $function$
declare
  rid bigint;
  active_count integer;
begin
  perform aria_internal.reconcile_meditation_queue_v2();

  select count(*) into active_count
  from aria_internal.mission_state m
  where m.status in ('planning','running')
    and m.lease_until is not null
    and m.lease_until > clock_timestamp();

  -- Two concurrent canonical mission runners are allowed. Claiming itself is
  -- fenced with row-level locks/leases, so a second runner cannot claim the
  -- same mission.
  if active_count >= 2 then
    return null;
  end if;

  if not exists (
    select 1
    from aria_internal.mission_state m
    where (
      m.status='queued'
      or (m.status in ('planning','running','failed') and (m.lease_until is null or m.lease_until < clock_timestamp()))
      or (m.status='paused' and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
      or (m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','')='verification_pending')
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
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into rid;
  return rid;
end;
$function$;

revoke all on function aria_internal.run_mission_runner_tick_v1() from public,anon,authenticated;
grant execute on function aria_internal.run_mission_runner_tick_v1() to service_role;
