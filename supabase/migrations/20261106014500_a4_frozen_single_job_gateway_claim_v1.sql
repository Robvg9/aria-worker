-- Mission Wonder 2 / Step 4 A4: narrow device-gateway exception for the
-- exact one-shot read-only job already authorized by the consumed A4 tick.
-- MISSION_EXECUTION_PAUSED remains true. Every other paused job claim/start
-- continues to fail closed at the device gateway.

begin;

create or replace function aria_internal.aria_m22_a4_frozen_job_authorized_v1(
  p_job_id text,
  p_device_id text,
  p_required_status text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare
  v_mission aria_internal.mission_state;
  v_scope aria_internal.mission_wonder_2_a4_scopes;
  v_job aria_internal.execution_jobs;
  v_device aria_internal.device_registry;
  v_dispatch jsonb;
  v_step jsonb;
  v_pending jsonb;
  v_eligible_count integer := 0;
  v_job_count integer := 0;
begin
  if coalesce(p_job_id,'') <> 'uo_mission_a4_authorized_once_a4_readonly_utc_clock_probe_a1_da6b3354e92efcbb'
     or coalesce(p_device_id,'') <> 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
     or coalesce(p_required_status,'') not in ('queued','claimed','running') then
    return false;
  end if;

  select * into v_mission
    from aria_internal.mission_state
   where mission_id='mission_a4_authorized_once';
  if not found
     or v_mission.status not in ('waiting','running')
     or v_mission.current_step <> 0
     or v_mission.completed_steps <> 0
     or (v_mission.lease_owner is not null and v_mission.lease_until > clock_timestamp()) then
    return false;
  end if;

  if coalesce(v_mission.metadata->>'execution_lane','') <> 'user'
     or coalesce(v_mission.metadata->>'source_application','') <> 'aria-app-v1'
     or coalesce(v_mission.metadata->>'goal_source','') <> 'user'
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_readonly','') <> 'true'
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_scope_id','') <> 'mission_wonder_2_a4_authorized_once'
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_goal_hash','') <> '6f66a99cf889877617b5d166151ac51e4cc90fafa592309b2aa440b103e7a5ef'
     or coalesce(v_mission.metadata->>'request_id','') <> '5d92b435-c42b-4d8b-9a07-2f73b8ec7a38'
     or coalesce(v_mission.metadata->>'user_id','') <> '39a8f5fd-18e6-4bba-bdd3-31691ec18f3e'
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_allowed_device_id','') <> p_device_id
     or nullif(coalesce(v_mission.metadata->>'project_id',''),'') is not null then
    return false;
  end if;

  v_dispatch := coalesce(v_mission.metadata->'a4_recovery_dispatch_v1','{}'::jsonb);
  if coalesce(v_dispatch->>'granted','false') <> 'true'
     or coalesce(v_dispatch->>'consumed','false') <> 'true'
     or coalesce(v_dispatch->>'grant_ref','') <> 'a4-recovery-42110933267.1'
     or coalesce(v_dispatch->>'tick_claimed','false') <> 'true'
     or coalesce(v_dispatch->>'tick_claim_ref','') <> 'a4-recovery-42110933267.1:tick'
     or coalesce(v_dispatch->>'scope_resume_count','0') <> '1'
     or coalesce(v_dispatch->>'scope_resume_grant_ref','') <> 'a4-recovery-42110933267.1'
     or coalesce(v_dispatch->>'runner_handoff_retry_count','0') <> '1'
     or coalesce(v_dispatch->>'runner_handoff_retry_ref','') <> 'a4-recovery-42110933267.1:runner-handoff-retry'
     or coalesce(v_dispatch->>'runner_handoff_retry_source_run','') <> '42131077740'
     or coalesce(v_dispatch->>'runner_handoff_retry_source_status','') <> '401'
     or coalesce(v_dispatch->>'runner_handoff_scope_resume_count','0') <> '1'
     or coalesce(v_dispatch->>'runner_handoff_scope_resume_source_run','') <> '42131077740' then
    return false;
  end if;

  select * into v_scope
    from aria_internal.mission_wonder_2_a4_scopes
   where scope_id='mission_wonder_2_a4_authorized_once'
     and mission_id='mission_a4_authorized_once'
     and scope_key='mission-wonder-2-step4-a4:single-authorized-execution'
     and owner_user_id='39a8f5fd-18e6-4bba-bdd3-31691ec18f3e'
     and request_id='5d92b435-c42b-4d8b-9a07-2f73b8ec7a38'
     and goal_hash='6f66a99cf889877617b5d166151ac51e4cc90fafa592309b2aa440b103e7a5ef'
     and allowed_device_id=p_device_id;
  if not found or v_scope.status <> 'bound' or v_scope.expires_at <= clock_timestamp() then
    return false;
  end if;
  -- revoked_at remains untouched as historical audit evidence.

  if jsonb_typeof(v_mission.checkpoint->'plan') is distinct from 'array'
     or jsonb_array_length(v_mission.checkpoint->'plan') <> 1 then
    return false;
  end if;
  v_step := v_mission.checkpoint->'plan'->0;
  if coalesce(v_step->>'id','') <> 'a4_readonly_utc_clock_probe'
     or coalesce(v_step->>'operation','') <> 'shell.execute'
     or coalesce(v_step->>'executor_type','') <> 'device'
     or coalesce(v_step->>'risk','') <> 'READ'
     or coalesce(v_step->'target'->>'type','') <> 'device'
     or coalesce(v_step->'target'->>'device_id','') <> p_device_id
     or coalesce(v_step->'input'->>'command','') <> '[DateTime]::UtcNow.ToString(''o'')'
     or v_step->'input'->>'cwd' is not null
     or coalesce(v_step->>'timeout_ms','') <> '15000'
     or coalesce(v_step->>'retryable','true') <> 'false'
     or coalesce(v_step->>'max_attempts','') <> '1'
     or jsonb_typeof(v_step->'depends_on') is distinct from 'array'
     or jsonb_array_length(v_step->'depends_on') <> 0
     or coalesce(v_step->'policy'->>'read_only','false') <> 'true'
     or coalesce(v_step->'policy'->>'read_only_audit','false') <> 'true'
     or coalesce(v_step->'policy'->>'mission_wonder_2_a4_readonly','false') <> 'true'
     or coalesce(v_step->'authorization'->>'status','') <> 'approved'
     or coalesce(v_step->'authorization'->>'risk_class','') <> 'READ'
     or coalesce(v_step->'authorization'->>'evidence_ref','') <> 'mission-wonder-2-step4-a4-v1'
     or coalesce(v_step->'verify'->>'expected_exit_code','') <> '0'
     or coalesce(v_step->'verify'->>'stdout_contains','') <> 'Z' then
    return false;
  end if;

  if coalesce(v_mission.checkpoint->'recovery'->>'status','') <> 'waiting_for_async_executor' then
    return false;
  end if;
  v_pending := v_mission.checkpoint->'pending_jobs'->'a4_readonly_utc_clock_probe';
  if coalesce(v_pending->>'job_id','') <> p_job_id then
    return false;
  end if;

  select * into v_job
    from aria_internal.execution_jobs
   where job_id=p_job_id
     and mission_id='mission_a4_authorized_once'
     and device_id=p_device_id
     and operation='shell.execute'
     and command='[DateTime]::UtcNow.ToString(''o'')'
     and cwd is null
     and timeout_ms=15000
     and policy @> '{"read_only":true,"read_only_audit":true,"mission_wonder_2_a4_readonly":true}'::jsonb
     and metadata->>'idempotency_key'=p_job_id;
  if not found or v_job.status <> p_required_status or v_job.completed_at is not null then
    return false;
  end if;
  if p_required_status='queued' and (v_job.claimed_at is not null or v_job.lease_owner is not null or v_job.lease_until is not null) then
    return false;
  end if;
  if p_required_status in ('claimed','running') and
     (v_job.lease_owner is null or v_job.lease_until is null or v_job.lease_until <= clock_timestamp()) then
    return false;
  end if;

  select count(*) into v_job_count
    from aria_internal.execution_jobs
   where mission_id='mission_a4_authorized_once';
  if v_job_count <> 1 then
    return false;
  end if;

  select * into v_device
    from aria_internal.device_registry
   where device_id=p_device_id;
  if not found
     or v_device.agent_type <> 'windows-local'
     or v_device.status <> 'online'
     or v_device.token_hash is null
     or not (v_device.capabilities @> '["shell.execute"]'::jsonb)
     or v_device.last_seen_at <= clock_timestamp()-interval '180 seconds' then
    return false;
  end if;

  select count(*) into v_eligible_count
    from aria_internal.device_registry d
   where d.agent_type='windows-local'
     and d.status='online'
     and d.token_hash is not null
     and d.capabilities @> '["shell.execute"]'::jsonb
     and d.last_seen_at > clock_timestamp()-interval '180 seconds';
  if v_eligible_count <> 1 then
    return false;
  end if;

  return true;
end;
$function$;

create or replace function aria_internal.aria_m22_a4_claim_frozen_one_shot_job_v1(
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare
  v_job aria_internal.execution_jobs;
  v_updated integer := 0;
begin
  if coalesce(p_device_id,'') <> 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089' then
    return null;
  end if;

  perform 1
    from aria_internal.mission_state
   where mission_id='mission_a4_authorized_once'
   for update;
  if not found then
    return null;
  end if;

  select * into v_job
    from aria_internal.execution_jobs
   where job_id='uo_mission_a4_authorized_once_a4_readonly_utc_clock_probe_a1_da6b3354e92efcbb'
     and status='queued'
   for update skip locked;
  if not found then
    return null;
  end if;

  if not aria_internal.aria_m22_a4_frozen_job_authorized_v1(v_job.job_id,p_device_id,'queued') then
    return null;
  end if;

  update aria_internal.execution_jobs j
     set status='claimed',
         claimed_at=clock_timestamp(),
         lease_owner=md5(p_device_id || ':' || clock_timestamp()::text || ':' || random()::text),
         lease_until=clock_timestamp()+((greatest(j.timeout_ms,1000)+60000)::numeric*interval '1 millisecond'),
         updated_at=clock_timestamp()
   where j.job_id=v_job.job_id
     and j.mission_id='mission_a4_authorized_once'
     and j.device_id=p_device_id
     and j.status='queued'
     and j.completed_at is null;
  get diagnostics v_updated=row_count;
  if v_updated <> 1 then
    return null;
  end if;

  select * into v_job
    from aria_internal.execution_jobs
   where job_id='uo_mission_a4_authorized_once_a4_readonly_utc_clock_probe_a1_da6b3354e92efcbb';

  insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  values (
    v_job.job_id,p_device_id,'job.claimed_a4_one_shot',
    jsonb_build_object(
      'mission_id','mission_a4_authorized_once',
      'scope_id','mission_wonder_2_a4_authorized_once',
      'scope_key','mission-wonder-2-step4-a4:single-authorized-execution',
      'existing_tick_claim_reused',true,
      'new_tick_claim_created',false,
      'global_execution_freeze_preserved',true,
      'claimed_at',clock_timestamp()
    )
  );

  return to_jsonb(v_job);
end;
$function$;

create or replace function aria_internal.mission_job_authorization_allowed(
  p_mission_id text,
  p_job_id text
)
returns boolean
language plpgsql
security definer
set search_path to 'aria_internal', 'pg_catalog'
as $function$
declare
  v_status text;
  v_checkpoint jsonb;
  v_pending_jobs jsonb;
  v_device_id text;
  v_job_status text;
begin
  if p_mission_id is null or p_job_id is null or length(p_job_id)=0 then
    return false;
  end if;

  select m.status, coalesce(m.checkpoint, '{}'::jsonb)
    into v_status, v_checkpoint
    from aria_internal.mission_state m
   where m.mission_id=p_mission_id;

  if not found then
    return false;
  end if;

  if p_mission_id='mission_a4_authorized_once' then
    if p_job_id <> 'uo_mission_a4_authorized_once_a4_readonly_utc_clock_probe_a1_da6b3354e92efcbb' then
      return false;
    end if;
    select j.device_id,j.status into v_device_id,v_job_status
      from aria_internal.execution_jobs j
     where j.job_id=p_job_id and j.mission_id=p_mission_id;
    if not found then
      return false;
    end if;
    return aria_internal.aria_m22_a4_frozen_job_authorized_v1(p_job_id,v_device_id,v_job_status);
  end if;

  if v_status='running' then
    return true;
  end if;

  if v_status not in ('paused','waiting') then
    return false;
  end if;

  if coalesce(v_checkpoint->'recovery'->>'status','') <> 'waiting_for_async_executor' then
    return false;
  end if;

  v_pending_jobs := v_checkpoint->'pending_jobs';
  if jsonb_typeof(v_pending_jobs) is distinct from 'object' then
    return false;
  end if;

  return exists (
    select 1
      from jsonb_each(v_pending_jobs) as pending(step_id, job)
     where pending.job->>'job_id'=p_job_id
  );
end;
$function$;

revoke all on function aria_internal.aria_m22_a4_frozen_job_authorized_v1(text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a4_claim_frozen_one_shot_job_v1(text) from public,anon,authenticated;
grant execute on function aria_internal.aria_m22_a4_frozen_job_authorized_v1(text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a4_claim_frozen_one_shot_job_v1(text) to service_role;

commit;
