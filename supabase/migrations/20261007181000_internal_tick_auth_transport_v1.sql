-- Canonical internal tick transport: use Authorization Bearer for the
-- autonomy token so Supabase's internal HTTP layer and canonical runtime
-- see one unambiguous credential channel.

CREATE OR REPLACE FUNCTION aria_internal.runner_tick_for_mission(p_mission_id text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
declare
  v_token text;
  v_req bigint;
begin
  if p_mission_id is null or length(trim(p_mission_id))=0 then
    raise exception 'mission_id_required';
  end if;

  v_token:=public.read_aria_credential_secret('aria_autonomy_cron_token');
  if v_token is null or length(v_token)<20 then
    raise exception 'autonomy_cron_token_unavailable';
  end if;

  select net.http_post(
    url:='https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-canonical-runtime-v1',
    headers:=jsonb_build_object(
      'content-type','application/json',
      'authorization','Bearer '||v_token,
      'x-aria-trigger','mission-tick'
    ),
    body:=jsonb_build_object('mission_id',p_mission_id),
    timeout_milliseconds:=60000
  ) into v_req;

  return v_req;
end;
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
  v_token text;
begin
  perform aria_internal.recover_running_replan_stalls_v1('00:01:00'::interval);
  perform aria_internal.recover_running_idle_stalls_v1('00:02:00'::interval);

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
     and coalesce(m.completed_steps,0)>=coalesce(m.total_steps,0)
     and m.updated_at<clock_timestamp()-interval '2 minutes';

  perform aria_internal.reconcile_meditation_queue_v2();

  select count(*) into active_count
  from aria_internal.mission_state m
  where m.status in ('planning','running')
    and m.lease_until is not null
    and m.lease_until>clock_timestamp()
    and lower(coalesce(nullif(m.metadata->>'execution_lane',''),nullif(m.metadata->>'goal_source',''),'')) not in
      ('test','human_gate_e2e','diagnostic','supervisor_probe');

  if active_count>=2 then return null; end if;

  if not exists (
    select 1 from aria_internal.mission_state m
    where (
      m.status='queued'
      or (m.status in ('planning','running','failed') and (m.lease_until is null or m.lease_until<clock_timestamp()))
      or (m.status='paused' and coalesce(m.checkpoint->'pending_jobs','{}'::jsonb)<>'{}'::jsonb)
      or (m.status='waiting' and coalesce(m.checkpoint->'recovery'->>'status','') in ('verification_pending','waiting_for_alternative_strategy'))
    )
      and aria_internal.aria_mission_claim_eligible(m.mission_id)
      and lower(coalesce(nullif(m.metadata->>'execution_lane',''),nullif(m.metadata->>'goal_source',''),'')) not in
        ('test','human_gate_e2e','diagnostic','supervisor_probe')
  ) then return null; end if;

  v_token:=(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token');
  if v_token is null or length(v_token)<20 then return null; end if;

  select net.http_post(
    url:='https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-canonical-runtime-v1',
    headers:=jsonb_build_object(
      'content-type','application/json',
      'authorization','Bearer '||v_token,
      'x-aria-trigger','scheduler'
    ),
    body:='{}'::jsonb,
    timeout_milliseconds:=60000
  ) into rid;

  return rid;
end;
$function$;
