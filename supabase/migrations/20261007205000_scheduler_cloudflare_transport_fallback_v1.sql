-- Prefer the Cloudflare runtime edge as the scheduler transport. This keeps the
-- canonical runner unchanged while avoiding transient pg_net DNS/TCP failures
-- between the database and Supabase Edge Functions.

CREATE OR REPLACE FUNCTION aria_internal.run_mission_runner_tick_v1()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','aria_internal','vault','net'
AS $function$
declare
  rid bigint;
  fallback_rid bigint;
  token text;
  active_count integer;
begin
  perform aria_internal.recover_running_replan_stalls_v1('00:01:00'::interval);

  update aria_internal.mission_state m
     set status='failed',
         lease_owner=null,
         lease_until=null,
         finished_at=coalesce(m.finished_at,clock_timestamp()),
         next_action='replan: prior execution failed final verification',
         last_stderr=coalesce(m.last_stderr,'final_verification_failed'),
         last_recovery_reason='stale_final_verification_failure_terminalized',
         updated_at=clock_timestamp()
   where m.status='running'
     and coalesce(m.last_stderr,'')='final_verification_failed'
     and coalesce(m.next_action,'')='recovery: universal runner exception'
     and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)='{}'::jsonb
     and coalesce(m.completed_steps,0) >= coalesce(m.total_steps,0)
     and m.updated_at < clock_timestamp() - interval '2 minutes';

  perform aria_internal.reconcile_meditation_queue_v2();

  select count(*)
    into active_count
    from aria_internal.mission_state m
   where m.status in ('planning','running')
     and m.lease_until is not null
     and m.lease_until > clock_timestamp();

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
       or (m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','') in ('verification_pending','waiting_for_alternative_strategy'))
     )
       and aria_internal.aria_mission_claim_eligible(m.mission_id)
  ) then
    return null;
  end if;

  token := (select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token');
  if token is null or length(token) < 20 then
    return null;
  end if;

  begin
    select net.http_post(
      url := 'https://aria.robvg9.workers.dev/scheduler/tick',
      headers := jsonb_build_object(
        'content-type','application/json',
        'x-aria-autonomy-token',token
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    ) into rid;
    if rid is not null then
      return rid;
    end if;
  exception when others then
    rid := null;
  end;

  select net.http_post(
    url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-runner-v22',
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-aria-autonomy-token',token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into fallback_rid;

  return fallback_rid;
end;
$function$;
