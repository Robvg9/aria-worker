CREATE OR REPLACE FUNCTION aria_internal.recover_running_connector_stalls_v1(
  p_stale_after interval DEFAULT '00:01:15'::interval
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','aria_internal'
AS $function$
DECLARE
  n integer := 0;
BEGIN
  UPDATE aria_internal.mission_state m
  SET status='queued',
      current_step=0,
      completed_steps=0,
      attempt_count=0,
      next_action='recovery: retry stalled connector read with bounded timeout',
      last_stderr='connector_read_stall_recovered',
      finished_at=null,
      lease_owner=null,
      lease_until=null,
      recovery_count=coalesce(m.recovery_count,0)+1,
      last_recovery_reason='connector_read_stall_recovered',
      updated_at=clock_timestamp(),
      checkpoint=jsonb_set(
        jsonb_set(
          coalesce(m.checkpoint,'{}'::jsonb),
          '{recovery,previous_plan}',
          coalesce(m.checkpoint->'plan','[]'::jsonb),
          true
        ),
        '{recovery}',
        coalesce(m.checkpoint->'recovery','{}'::jsonb) ||
          jsonb_build_object(
            'status','retry_scheduled',
            'replan_required',false,
            'reason','connector_read_stall_recovered',
            'recovered_at',clock_timestamp()
          ),
        true
      )
  WHERE m.status='running'
    AND m.lease_owner IS NOT NULL
    AND m.lease_until > clock_timestamp()
    AND coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)='{}'::jsonb
    AND lower(coalesce(m.checkpoint->'active_step'->>'executor_type',''))='connector'
    AND lower(coalesce(m.checkpoint->'active_step'->>'operation','')) IN
        ('repo_read','tree_read','file_read','ref_read','pr_find','pr_read','pr_checks','main_workflow_runs')
    AND nullif(m.checkpoint->'active_step'->>'started_at','') IS NOT NULL
    AND to_timestamp((m.checkpoint->'active_step'->>'started_at')::double precision / 1000.0)
        < clock_timestamp()-p_stale_after;

  GET DIAGNOSTICS n=row_count;
  RETURN n;
END;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.run_mission_runner_tick_v1()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','aria_internal','vault','net'
AS $function$
declare
  rid bigint;
  active_count integer;
begin
  perform aria_internal.recover_running_connector_stalls_v1('00:01:15'::interval);
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
