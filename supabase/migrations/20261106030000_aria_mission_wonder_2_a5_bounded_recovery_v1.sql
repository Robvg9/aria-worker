-- Mission Wonder 2 / Step 5 A5: one ordinary PWA mission with an exact,
-- idempotent interruption/recovery pilot. Global mission execution remains paused.
-- This migration creates contracts only; it does not create a mission, scope, job or lease.
begin;

create table if not exists aria_internal.mission_wonder_2_a5_scopes (
  scope_id text primary key,
  scope_key text not null unique,
  owner_user_id text not null,
  request_id text,
  goal_hash text not null check (goal_hash ~ '^[0-9a-f]{64}$'),
  mission_id text not null unique,
  job_id text not null unique,
  allowed_device_id text not null,
  command text not null,
  status text not null default 'armed'
    check (status in ('armed','claimed','bound','recovered','completed','revoked')),
  recovery_used boolean not null default false,
  recovery_grant_ref text,
  old_lease_owner_hash text,
  old_lease_until timestamptz,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  bound_at timestamptz,
  recovered_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (request_id is null or length(request_id) between 1 and 200),
  check (length(job_id) between 8 and 180),
  check (length(command) between 100 and 12000),
  check ((recovery_used=false and recovery_grant_ref is null) or
         (recovery_used=true and recovery_grant_ref is not null))
);
create unique index if not exists mission_wonder_2_a5_request_uidx
  on aria_internal.mission_wonder_2_a5_scopes(request_id) where request_id is not null;
alter table aria_internal.mission_wonder_2_a5_scopes enable row level security;
revoke all on aria_internal.mission_wonder_2_a5_scopes from public,anon,authenticated;
grant select,insert,update on aria_internal.mission_wonder_2_a5_scopes to service_role;

create or replace function aria_internal.aria_m22_a5_claim_scope_v1(
  p_user_id text,p_request_id text,p_goal_hash text,p_project_id text default null
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare s aria_internal.mission_wonder_2_a5_scopes;
begin
  if nullif(btrim(p_user_id),'') is null or nullif(btrim(p_request_id),'') is null
     or length(p_request_id)>200 or p_goal_hash is null
     or p_goal_hash !~ '^[0-9a-f]{64}$' or p_project_id is not null then return null; end if;
  select * into s from aria_internal.mission_wonder_2_a5_scopes
   where scope_id='mission_wonder_2_a5_authorized_once'
     and scope_key='mission-wonder-2-step5-a5:single-authorized-recovery'
     and owner_user_id=btrim(p_user_id) and goal_hash=p_goal_hash
     and status in ('armed','claimed','bound') and expires_at>clock_timestamp()
   for update;
  if not found then return null; end if;
  if s.status='armed' then
    update aria_internal.mission_wonder_2_a5_scopes
       set request_id=btrim(p_request_id),status='claimed',
           claimed_at=clock_timestamp(),updated_at=clock_timestamp()
     where scope_id=s.scope_id returning * into s;
  elsif s.request_id is distinct from btrim(p_request_id) then return null; end if;
  return jsonb_build_object(
    'scope_id',s.scope_id,'mission_id',s.mission_id,'job_id',s.job_id,
    'allowed_device_id',s.allowed_device_id,'command',s.command,
    'status',s.status,'expires_at',s.expires_at
  );
end;
$function$;

create or replace function aria_internal.aria_m22_a5_bind_scope_v1(
  p_scope_id text,p_mission_id text,p_user_id text,p_request_id text,p_goal_hash text
) returns boolean
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare n integer;
begin
  if p_scope_id<>'mission_wonder_2_a5_authorized_once'
     or p_mission_id<>'mission_a5_authorized_once' then return false; end if;
  if not exists (
    select 1 from aria_internal.mission_state m
     where m.mission_id=p_mission_id
       and m.metadata->>'mission_wonder_2_a5_scope_id'=p_scope_id
       and m.metadata->>'mission_wonder_2_a5_goal_hash'=p_goal_hash
       and m.metadata->>'mission_wonder_2_a5_recovery'='true'
       and m.metadata->>'mission_wonder_2_a5_allowed_device_id' =
          (select allowed_device_id from aria_internal.mission_wonder_2_a5_scopes where scope_id=p_scope_id)
       and m.metadata->>'user_id'=p_user_id
       and m.metadata->>'request_id'=p_request_id
       and m.metadata->>'execution_lane'='user'
       and m.metadata->>'source_application'='aria-app-v1'
       and m.metadata->>'goal_source'='user'
       and nullif(coalesce(m.metadata->>'project_id',''),'') is null
  ) then return false; end if;
  update aria_internal.mission_wonder_2_a5_scopes
     set status='bound',bound_at=coalesce(bound_at,clock_timestamp()),updated_at=clock_timestamp()
   where scope_id=p_scope_id and mission_id=p_mission_id and owner_user_id=p_user_id
     and request_id=p_request_id and goal_hash=p_goal_hash and status in ('claimed','bound')
     and expires_at>clock_timestamp();
  get diagnostics n=row_count;
  return n=1 or exists (
    select 1 from aria_internal.mission_wonder_2_a5_scopes
     where scope_id=p_scope_id and mission_id=p_mission_id and owner_user_id=p_user_id
       and request_id=p_request_id and goal_hash=p_goal_hash and status in ('bound','recovered','completed')
  );
end;
$function$;

create or replace function aria_internal.aria_m22_a5_frozen_job_authorized_v1(
  p_job_id text,p_device_id text,p_required_status text
) returns boolean
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  v_mission aria_internal.mission_state;
  v_scope aria_internal.mission_wonder_2_a5_scopes;
  v_job aria_internal.execution_jobs;
  v_step jsonb;
  v_pending jsonb;
  v_attempt integer;
  v_job_count integer;
  v_eligible_count integer;
begin
  if coalesce(p_job_id,'')='' or coalesce(p_device_id,'')=''
     or p_required_status not in ('queued','claimed','running') then return false; end if;
  select * into v_scope from aria_internal.mission_wonder_2_a5_scopes
   where scope_id='mission_wonder_2_a5_authorized_once'
     and mission_id='mission_a5_authorized_once'
     and scope_key='mission-wonder-2-step5-a5:single-authorized-recovery'
     and job_id=p_job_id and allowed_device_id=p_device_id;
  if not found or v_scope.status not in ('bound','recovered')
     or v_scope.expires_at<=clock_timestamp() then return false; end if;
  if (v_scope.recovery_used and v_scope.status<>'recovered')
     or (not v_scope.recovery_used and v_scope.status<>'bound') then return false; end if;

  select * into v_mission from aria_internal.mission_state
   where mission_id='mission_a5_authorized_once';
  if not found or v_mission.status not in ('waiting','running')
     or v_mission.current_step<>0 or v_mission.completed_steps<>0 or v_mission.total_steps<>1 then return false; end if;
  if coalesce(v_mission.metadata->>'mission_wonder_2_a5_scope_id','')<>v_scope.scope_id
     or coalesce(v_mission.metadata->>'mission_wonder_2_a5_goal_hash','')<>v_scope.goal_hash
     or coalesce(v_mission.metadata->>'mission_wonder_2_a5_allowed_device_id','')<>p_device_id
     or coalesce(v_mission.metadata->>'mission_wonder_2_a5_recovery','false')<>'true'
     or coalesce(v_mission.metadata->>'user_id','')<>v_scope.owner_user_id
     or coalesce(v_mission.metadata->>'request_id','')<>v_scope.request_id
     or coalesce(v_mission.metadata->>'execution_lane','')<>'user'
     or coalesce(v_mission.metadata->>'source_application','')<>'aria-app-v1'
     or coalesce(v_mission.metadata->>'goal_source','')<>'user'
     or nullif(coalesce(v_mission.metadata->>'project_id',''),'') is not null then return false; end if;

  if jsonb_typeof(v_mission.checkpoint->'plan') is distinct from 'array' then return false; end if;
  if jsonb_array_length(v_mission.checkpoint->'plan')<>1 then return false; end if;
  v_step:=v_mission.checkpoint->'plan'->0;
  if coalesce(v_step->>'id','')<>'a5_idempotent_recovery_marker'
     or coalesce(v_step->>'operation','')<>'shell.execute'
     or coalesce(v_step->>'executor_type','')<>'device'
     or coalesce(v_step->>'risk','')<>'WRITE'
     or coalesce(v_step->'target'->>'type','')<>'device'
     or coalesce(v_step->'target'->>'device_id','')<>p_device_id
     or coalesce(v_step->'input'->>'command','')<>v_scope.command
     or coalesce(v_step->'input'->>'cwd','')<>'C:\Windows\Temp'
     or coalesce(v_step->>'timeout_ms','')<>'900000'
     or coalesce(v_step->>'retryable','true')<>'false'
     or coalesce(v_step->>'max_attempts','')<>'2'
     or coalesce(v_step->'policy'->>'mission_wonder_2_a5_recovery','false')<>'true'
     or coalesce(v_step->'policy'->>'idempotent_artifact','false')<>'true'
     or coalesce(v_step->'authorization'->>'status','')<>'approved'
     or coalesce(v_step->'authorization'->>'risk_class','')<>'WRITE'
     or coalesce(v_step->'authorization'->>'evidence_ref','')<>'mission-wonder-2-step5-a5-v1-owner-authorization'
     or coalesce(v_step->'verify'->>'expected_exit_code','')<>'0'
     or coalesce(v_step->'verify'->>'stdout_contains','')<>'A5_RECOVERY_ALREADY_IDENTICAL' then return false; end if;

  v_pending:=v_mission.checkpoint->'pending_jobs'->'a5_idempotent_recovery_marker';
  v_attempt:=case when v_scope.recovery_used then 2 else 1 end;
  if coalesce(v_pending->>'job_id','')<>p_job_id
     or coalesce(v_pending->>'attempt','0')<>v_attempt::text then return false; end if;

  select * into v_job from aria_internal.execution_jobs
   where job_id=p_job_id and mission_id='mission_a5_authorized_once'
     and device_id=p_device_id and operation='shell.execute'
     and command=v_scope.command and cwd='C:\Windows\Temp'
     and timeout_ms=900000
     and policy @> '{"mission_wonder_2_a5_recovery":true,"idempotent_artifact":true,"max_artifacts":1}'::jsonb
     and metadata->>'idempotency_key'=p_job_id;
  if not found or v_job.status<>p_required_status or v_job.completed_at is not null then return false; end if;
  if p_required_status='queued' and
     (v_job.claimed_at is not null or v_job.lease_owner is not null or v_job.lease_until is not null) then return false; end if;
  if p_required_status in ('claimed','running') and
     (v_job.lease_owner is null or v_job.lease_until is null or v_job.lease_until<=clock_timestamp()) then return false; end if;
  select count(*) into v_job_count from aria_internal.execution_jobs where mission_id='mission_a5_authorized_once';
  if v_job_count<>1 then return false; end if;

  select count(*) into v_eligible_count from aria_internal.device_registry d
   where d.device_id=p_device_id and d.agent_type='windows-local' and d.status='online'
     and d.token_hash is not null and d.capabilities @> '["shell.execute"]'::jsonb
     and d.last_seen_at>clock_timestamp()-interval '180 seconds'
     and not exists (
       select 1 from aria_internal.device_registry other
        where other.device_id<>d.device_id and other.agent_type='windows-local'
          and other.status='online' and other.token_hash is not null
          and other.capabilities @> '["shell.execute"]'::jsonb
          and other.last_seen_at>clock_timestamp()-interval '180 seconds'
     );
  return v_eligible_count=1;
end;
$function$;

create or replace function aria_internal.aria_m22_a5_recover_running_job_v1(
  p_mission_id text,p_scope_id text,p_job_id text,p_grant_ref text
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  v_mission aria_internal.mission_state;
  v_scope aria_internal.mission_wonder_2_a5_scopes;
  v_job aria_internal.execution_jobs;
  v_pending jsonb;
  v_checkpoint jsonb;
  v_updated integer;
  v_eligible_count integer;
begin
  if coalesce(btrim(p_mission_id),'')<>'mission_a5_authorized_once'
     or coalesce(btrim(p_scope_id),'')<>'mission_wonder_2_a5_authorized_once'
     or coalesce(btrim(p_job_id),'')='' or length(p_job_id)>180
     or coalesce(btrim(p_grant_ref),'') !~ '^a5-recovery-[0-9]{6,20}\.[0-9]{1,3}$' then
    return jsonb_build_object('action','rejected','reason','identity_or_grant_invalid');
  end if;

  select * into v_mission from aria_internal.mission_state
   where mission_id='mission_a5_authorized_once' for update;
  if not found then return jsonb_build_object('action','rejected','reason','mission_missing'); end if;
  select * into v_scope from aria_internal.mission_wonder_2_a5_scopes
   where scope_id='mission_wonder_2_a5_authorized_once' for update;
  if not found or v_scope.mission_id<>v_mission.mission_id or v_scope.job_id<>p_job_id
     or v_scope.scope_key<>'mission-wonder-2-step5-a5:single-authorized-recovery'
     or v_scope.status<>'bound' or v_scope.recovery_used
     or v_scope.expires_at<=clock_timestamp() then
    return jsonb_build_object('action','rejected','reason','scope_not_recoverable');
  end if;
  if v_mission.status<>'waiting' or v_mission.current_step<>0
     or v_mission.completed_steps<>0 or v_mission.total_steps<>1
     or coalesce(v_mission.metadata->>'mission_wonder_2_a5_scope_id','')<>v_scope.scope_id
     or coalesce(v_mission.metadata->>'mission_wonder_2_a5_goal_hash','')<>v_scope.goal_hash
     or coalesce(v_mission.metadata->>'mission_wonder_2_a5_recovery','false')<>'true'
     or coalesce(v_mission.metadata->>'user_id','')<>v_scope.owner_user_id
     or coalesce(v_mission.metadata->>'request_id','')<>v_scope.request_id
     or coalesce(v_mission.metadata->>'mission_wonder_2_a5_allowed_device_id','')<>v_scope.allowed_device_id then
    return jsonb_build_object('action','rejected','reason','mission_identity_or_checkpoint_invalid');
  end if;

  v_pending:=v_mission.checkpoint->'pending_jobs'->'a5_idempotent_recovery_marker';
  if coalesce(v_mission.checkpoint->'recovery'->>'status','')<>'waiting_for_async_executor'
     or coalesce(v_pending->>'job_id','')<>p_job_id
     or coalesce(v_pending->>'attempt','0')<>'1' then
    return jsonb_build_object('action','rejected','reason','same_job_checkpoint_attempt_1_required');
  end if;

  select * into v_job from aria_internal.execution_jobs
   where job_id=p_job_id and mission_id=v_mission.mission_id for update;
  if not found or v_job.status<>'running' or v_job.device_id<>v_scope.allowed_device_id
     or v_job.operation<>'shell.execute' or v_job.command<>v_scope.command
     or v_job.cwd<>'C:\Windows\Temp' or v_job.completed_at is not null
     or v_job.lease_owner is null or v_job.lease_until is null
     or v_job.lease_until<=clock_timestamp()
     or v_job.recovery_count<>0
     or coalesce(v_job.metadata->>'mission_wonder_2_a5_attempt','1')<>'1'
     or not aria_internal.aria_m22_a5_frozen_job_authorized_v1(p_job_id,v_scope.allowed_device_id,'running')
     or (select count(*) from aria_internal.execution_jobs where mission_id=v_mission.mission_id)<>1 then
    return jsonb_build_object('action','rejected','reason','one_running_job_with_live_lease_required');
  end if;

  select count(*) into v_eligible_count from aria_internal.device_registry d
   where d.device_id=v_scope.allowed_device_id and d.agent_type='windows-local'
     and d.status='online' and d.token_hash is not null
     and d.capabilities @> '["shell.execute"]'::jsonb
     and d.last_seen_at>clock_timestamp()-interval '180 seconds'
     and not exists (
       select 1 from aria_internal.device_registry other
        where other.device_id<>d.device_id and other.agent_type='windows-local'
          and other.status='online' and other.token_hash is not null
          and other.capabilities @> '["shell.execute"]'::jsonb
          and other.last_seen_at>clock_timestamp()-interval '180 seconds'
     );
  if v_eligible_count<>1 then return jsonb_build_object('action','rejected','reason','agent_not_unique_and_fresh'); end if;

  update aria_internal.mission_wonder_2_a5_scopes
     set status='recovered',recovery_used=true,recovery_grant_ref=btrim(p_grant_ref),
         old_lease_owner_hash=md5(v_job.lease_owner),old_lease_until=v_job.lease_until,
         recovered_at=clock_timestamp(),updated_at=clock_timestamp()
   where scope_id=v_scope.scope_id and status='bound' and recovery_used=false;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then return jsonb_build_object('action','rejected','reason','scope_recovery_race'); end if;

  -- Persist the interruption as a terminal timeout first, then permit exactly one
  -- scope-bound timeout->queued requeue inside this transaction.
  update aria_internal.execution_jobs
     set status='timeout',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
         lease_owner=null,lease_until=null,exit_code=null,
         stderr='a5_controlled_interruption_after_artifact_checkpoint'
   where job_id=p_job_id and status='running' and completed_at is null;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'a5_interruption_timeout_transition_failed'; end if;
  insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  values (p_job_id,v_scope.allowed_device_id,'job.timeout',
    jsonb_build_object('reason','a5_controlled_interruption_after_artifact_checkpoint',
      'same_job_recovery',true,'scope_id',v_scope.scope_id,'grant_ref',btrim(p_grant_ref)));

  perform set_config('aria_internal.a5_requeue_job_id',p_job_id,true);
  update aria_internal.execution_jobs
     set status='queued',completed_at=null,claimed_at=null,started_at=null,
         lease_owner=null,lease_until=null,exit_code=null,stdout='',stderr='',
         result='{}'::jsonb,recovery_count=coalesce(recovery_count,0)+1,
         metadata=metadata || jsonb_build_object(
           'mission_wonder_2_a5_attempt',2,
           'mission_wonder_2_a5_recovery_ref',btrim(p_grant_ref)
         ),
         updated_at=clock_timestamp()
   where job_id=p_job_id and status='timeout' and completed_at is not null;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'a5_same_job_requeue_failed'; end if;

  v_checkpoint:=v_mission.checkpoint;
  v_checkpoint:=jsonb_set(v_checkpoint,'{pending_jobs}',
    coalesce(v_checkpoint->'pending_jobs','{}'::jsonb) ||
    jsonb_build_object('a5_idempotent_recovery_marker',
      coalesce(v_pending,'{}'::jsonb) || jsonb_build_object('status','queued','attempt',2,'job_id',p_job_id)),true);
  v_checkpoint:=jsonb_set(v_checkpoint,'{attempts}',
    coalesce(v_checkpoint->'attempts','{}'::jsonb) ||
    jsonb_build_object('a5_idempotent_recovery_marker',2),true);
  v_checkpoint:=jsonb_set(v_checkpoint,'{recovery}',
    coalesce(v_checkpoint->'recovery','{}'::jsonb) ||
    jsonb_build_object('status','waiting_for_async_executor',
      'reason','a5_same_job_reclaimed_after_controlled_interruption',
      'job_id',p_job_id,'previous_attempt',1,'next_attempt',2,
      'grant_ref',btrim(p_grant_ref)),true);
  update aria_internal.mission_state
     set checkpoint=v_checkpoint,status='waiting',lease_owner=null,lease_until=null,
         next_action='resume_same_execution_job_attempt_2',updated_at=clock_timestamp()
   where mission_id=v_mission.mission_id;

  insert into aria_internal.mission_events(mission_id,event_type,payload)
  values (v_mission.mission_id,'mission_resumed',
    jsonb_build_object('reason','mission_wonder_2_step5_a5_same_job_recovery',
      'scope_id',v_scope.scope_id,'job_id',p_job_id,'previous_attempt',1,'next_attempt',2,
      'new_job_created',false,'global_execution_freeze_preserved',true,
      'grant_ref',btrim(p_grant_ref)));

  return jsonb_build_object('action','recovered','mission_id',v_mission.mission_id,
    'scope_id',v_scope.scope_id,'job_id',p_job_id,'previous_attempt',1,'next_attempt',2,
    'same_job_id',true,'new_job_created',false,'recovery_count',1);
end;
$function$;

create or replace function aria_internal.aria_m22_a5_claim_frozen_one_shot_job_v1(
  p_device_id text
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare v_job aria_internal.execution_jobs; v_n integer;
begin
  if p_device_id<>'windows-fe722cc6681e4f9c9cc35f5ebbb0a089' then return null; end if;
  perform 1 from aria_internal.mission_state where mission_id='mission_a5_authorized_once' for update;
  if not found then return null; end if;
  select * into v_job from aria_internal.execution_jobs
   where job_id='uo_mission_a5_authorized_once_a5_idempotent_recovery_marke_a1_b5d6865a66a4def1'
     and status='queued' for update skip locked;
  if not found or not aria_internal.aria_m22_a5_frozen_job_authorized_v1(v_job.job_id,p_device_id,'queued') then return null; end if;
  update aria_internal.execution_jobs j
     set status='claimed',claimed_at=clock_timestamp(),
         lease_owner=md5(p_device_id||':'||clock_timestamp()::text||':'||random()::text),
         lease_until=clock_timestamp()+((greatest(j.timeout_ms,1000)+60000)::numeric*interval '1 millisecond'),
         updated_at=clock_timestamp()
   where j.job_id=v_job.job_id and j.device_id=p_device_id
     and j.status='queued' and j.completed_at is null;
  get diagnostics v_n=row_count;
  if v_n<>1 then return null; end if;
  select * into v_job from aria_internal.execution_jobs
   where job_id='uo_mission_a5_authorized_once_a5_idempotent_recovery_marke_a1_b5d6865a66a4def1';
  insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  values (v_job.job_id,p_device_id,'job.claimed_a5_one_shot',
    jsonb_build_object('mission_id','mission_a5_authorized_once',
      'scope_id','mission_wonder_2_a5_authorized_once',
      'attempt',case when v_job.metadata->>'mission_wonder_2_a5_attempt'='2' then 2 else 1 end,
      'same_job_reclaimed',coalesce(v_job.metadata->>'mission_wonder_2_a5_attempt','1')='2',
      'global_execution_freeze_preserved',true));
  return to_jsonb(v_job);
end;
$function$;

create or replace function aria_internal.aria_m22_a5_complete_scope_v1(
  p_scope_id text,p_mission_id text,p_job_id text
) returns boolean
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare n integer;
begin
  if p_scope_id<>'mission_wonder_2_a5_authorized_once'
     or p_mission_id<>'mission_a5_authorized_once'
     or p_job_id<>'uo_mission_a5_authorized_once_a5_idempotent_recovery_marke_a1_b5d6865a66a4def1'
     or not exists (
       select 1 from aria_internal.mission_state m
       where m.mission_id=p_mission_id and m.status='succeeded'
         and m.completed_steps=1 and m.total_steps=1
         and m.lease_owner is null and m.lease_until is null
     )
     or not exists (
       select 1 from aria_internal.execution_jobs j
       where j.job_id=p_job_id and j.mission_id=p_mission_id
         and j.status='succeeded' and j.exit_code=0
         and j.metadata->>'mission_wonder_2_a5_attempt'='2'
         and j.stdout like '%A5_RECOVERY_ALREADY_IDENTICAL%'
         and j.completed_at is not null and j.lease_owner is null and j.lease_until is null
     )
     or (select count(*) from aria_internal.execution_jobs where mission_id=p_mission_id)<>1
     or (select count(*) from aria_internal.execution_job_events
          where job_id=p_job_id and event_type='job.timeout')<>1
     or (select count(*) from aria_internal.execution_job_events
          where job_id=p_job_id and event_type='job.claimed_a5_one_shot'
            and payload->>'attempt'='1')<>1
     or (select count(*) from aria_internal.execution_job_events
          where job_id=p_job_id and event_type='job.claimed_a5_one_shot'
            and payload->>'attempt'='2')<>1
     or (select count(*) from aria_internal.execution_job_events
          where job_id=p_job_id and event_type='job.a5_stale_attempt_rejected'
            and payload->>'expected_http_status'='409'
            and payload->>'stale_attempt'='1'
            and payload->>'current_attempt'='2')<>1
     or (select count(*) from aria_internal.execution_job_events
          where job_id=p_job_id and event_type='job.succeeded')<>1
     or (select count(*) from aria_internal.mission_events
          where mission_id=p_mission_id and event_type='mission_verified')<>1 then return false; end if;
  update aria_internal.mission_wonder_2_a5_scopes
     set status='completed',completed_at=coalesce(completed_at,clock_timestamp()),updated_at=clock_timestamp()
   where scope_id=p_scope_id and mission_id=p_mission_id and job_id=p_job_id
     and recovery_used=true and status='recovered';
  get diagnostics n=row_count;
  return n=1 or exists(select 1 from aria_internal.mission_wonder_2_a5_scopes
    where scope_id=p_scope_id and mission_id=p_mission_id and job_id=p_job_id
      and recovery_used=true and status='completed');
end;
$function$;

create or replace function aria_internal.aria_m22_a5_revoke_scope_v1(p_scope_id text)
returns boolean language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare n integer;
begin
  update aria_internal.mission_wonder_2_a5_scopes
     set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),updated_at=clock_timestamp()
   where scope_id=p_scope_id and status in ('armed','claimed','bound','recovered');
  get diagnostics n=row_count;
  return n=1 or exists(select 1 from aria_internal.mission_wonder_2_a5_scopes
    where scope_id=p_scope_id and status='revoked');
end;
$function$;

-- A5-only exception to the otherwise forbidden timeout->queued transition.
-- The trigger recognizes the transaction-local job id only when its matching A5
-- scope is already recovered; callers cannot set this through any exposed API.
create or replace function aria_internal.guard_execution_job_transition()
returns trigger language plpgsql
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  v_terminal boolean := NEW.status IN ('succeeded','failed','timeout','cancelled','blocked');
  v_a5_requeue boolean := false;
begin
  if OLD.status='timeout' and NEW.status='queued'
     and current_setting('aria_internal.a5_requeue_job_id',true)=OLD.job_id
     and EXISTS(
       select 1 from aria_internal.mission_wonder_2_a5_scopes s
        where s.scope_id='mission_wonder_2_a5_authorized_once'
          and s.mission_id=OLD.mission_id and s.job_id=OLD.job_id
          and s.status='recovered' and s.recovery_used=true
     ) then
    v_a5_requeue:=true;
  end if;
  if not aria_internal.execution_job_can_transition(OLD.status,NEW.status) and not v_a5_requeue then
    raise exception 'invalid_execution_job_transition:%->%',OLD.status,NEW.status;
  end if;
  if v_terminal then
    if NEW.completed_at is null then raise exception 'terminal_execution_job_requires_completed_at:%',NEW.status; end if;
    if NEW.lease_owner is not null or NEW.lease_until is not null then
      raise exception 'terminal_execution_job_must_release_lease:%',NEW.status;
    end if;
  elsif NEW.completed_at is not null then
    raise exception 'nonterminal_execution_job_cannot_have_completed_at:%',NEW.status;
  end if;
  if v_a5_requeue and (NEW.claimed_at is not null or NEW.started_at is not null
      or NEW.lease_owner is not null or NEW.lease_until is not null) then
    raise exception 'a5_requeue_must_clear_old_lease:%',OLD.job_id;
  end if;
  return NEW;
end;
$function$;

-- Keep the generic authorization model intact, with one exact A5 row-level branch.
create or replace function aria_internal.mission_job_authorization_allowed(
  p_mission_id text,p_job_id text
) returns boolean
language plpgsql security definer
set search_path to 'aria_internal','pg_catalog'
as $function$
declare
  v_status text;
  v_checkpoint jsonb;
  v_pending_jobs jsonb;
  v_device_id text;
  v_job_status text;
begin
  if p_mission_id is null or p_job_id is null or length(p_job_id)=0 then return false; end if;
  select m.status,coalesce(m.checkpoint,'{}'::jsonb)
    into v_status,v_checkpoint
    from aria_internal.mission_state m where m.mission_id=p_mission_id;
  if not found then return false; end if;

  if p_mission_id='mission_a4_authorized_once' then
    if p_job_id<>'uo_mission_a4_authorized_once_a4_readonly_utc_clock_probe_a1_da6b3354e92efcbb' then return false; end if;
    select j.device_id,j.status into v_device_id,v_job_status from aria_internal.execution_jobs j
     where j.job_id=p_job_id and j.mission_id=p_mission_id;
    if not found then return false; end if;
    return aria_internal.aria_m22_a4_frozen_job_authorized_v1(p_job_id,v_device_id,v_job_status);
  end if;

  if p_mission_id='mission_a5_authorized_once' then
    select j.device_id,j.status into v_device_id,v_job_status
      from aria_internal.execution_jobs j where j.job_id=p_job_id and j.mission_id=p_mission_id;
    if not found then return false; end if;
    return aria_internal.aria_m22_a5_frozen_job_authorized_v1(p_job_id,v_device_id,v_job_status);
  end if;

  if v_status='running' then return true; end if;
  if v_status not in ('paused','waiting') then return false; end if;
  if coalesce(v_checkpoint->'recovery'->>'status','')<>'waiting_for_async_executor' then return false; end if;
  v_pending_jobs:=v_checkpoint->'pending_jobs';
  if jsonb_typeof(v_pending_jobs) is distinct from 'object' then return false; end if;
  return exists(select 1 from jsonb_each(v_pending_jobs) as pending(step_id,job) where pending.job->>'job_id'=p_job_id);
end;
$function$;

-- Exactly one stale result from attempt 1 must be rejected with HTTP 409 while the
-- same job is queued for attempt 2. Persist one audit event for that rejection.
create unique index if not exists a5_stale_attempt_rejected_once_uidx
  on aria_internal.execution_job_events(job_id) where event_type='job.a5_stale_attempt_rejected';

create or replace function public.complete_execution_job_gateway(
  p_job_id text,p_device_id text,p_status text,p_exit_code integer,
  p_stdout text,p_stderr text,p_result jsonb
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r jsonb;
  v_mission_id text;
  v_mission_status text;
  v_job_status text;
  v_current_attempt integer := 1;
  v_submitted_attempt integer := 1;
  v_is_a5 boolean := false;
begin
  -- Establish the canonical lock order (mission, then job), matching recovery.
  -- The attempt is read only after both locks so a late attempt-1 result cannot
  -- race the atomic same-job timeout->queued transition.
  select j.mission_id into v_mission_id
    from aria_internal.execution_jobs j
   where j.job_id=p_job_id and j.device_id=p_device_id;
  if not found then return null; end if;

  select m.status into v_mission_status
    from aria_internal.mission_state m
   where m.mission_id=v_mission_id
   for update;
  if not found then return null; end if;

  select j.status,
         coalesce(nullif(j.metadata->>'mission_wonder_2_a5_attempt','')::integer,1)
    into v_job_status,v_current_attempt
    from aria_internal.execution_jobs j
   where j.job_id=p_job_id and j.device_id=p_device_id
   for update;
  if not found then return null; end if;

  select exists(
    select 1 from aria_internal.mission_wonder_2_a5_scopes s
     where s.scope_id='mission_wonder_2_a5_authorized_once'
       and s.mission_id=v_mission_id and s.job_id=p_job_id
       and s.recovery_used=true and s.status='recovered'
  ) into v_is_a5;

  if v_is_a5 then
    v_submitted_attempt:=coalesce(nullif(p_result->'metadata'->>'mission_wonder_2_a5_attempt','')::integer,1);
    if v_submitted_attempt<>v_current_attempt then
      if v_submitted_attempt=1 and v_current_attempt=2 then
        insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
        values(p_job_id,p_device_id,'job.a5_stale_attempt_rejected',
          jsonb_build_object('mission_id','mission_a5_authorized_once',
            'scope_id','mission_wonder_2_a5_authorized_once',
            'stale_attempt',v_submitted_attempt,'current_attempt',v_current_attempt,
            'job_status_at_rejection',v_job_status,'expected_http_status',409))
        on conflict (job_id) where event_type='job.a5_stale_attempt_rejected' do nothing;
      end if;
      return null;
    end if;
  end if;

  if v_job_status not in ('running','claimed') then return null; end if;

  if not aria_internal.mission_job_authorization_allowed(v_mission_id,p_job_id) then
    update aria_internal.execution_jobs
       set status='cancelled',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
           lease_owner=null,lease_until=null,claimed_at=null,exit_code=null,
           stderr=concat_ws(E'\n',nullif(stderr,''),'fail_closed:mission_not_authorized_at_completion')
     where job_id=p_job_id and device_id=p_device_id
       and status in ('running','claimed') and completed_at is null
     returning to_jsonb(execution_jobs.*) into r;
    if r is not null then
      insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
      values(p_job_id,p_device_id,'job.blocked_mission_not_authorized',
        jsonb_build_object('mission_id',v_mission_id,'mission_status',v_mission_status,
          'phase','complete','attempted_status',p_status,'at',clock_timestamp()));
    end if;
    return null;
  end if;

  update aria_internal.execution_jobs
     set status=p_status,exit_code=p_exit_code,stdout=p_stdout,stderr=p_stderr,result=p_result,
         completed_at=clock_timestamp(),updated_at=clock_timestamp(),
         lease_owner=null,lease_until=null
   where job_id=p_job_id and device_id=p_device_id and status in ('running','claimed')
   returning to_jsonb(execution_jobs.*),mission_id into r,v_mission_id;
  if r is null then return null; end if;
  insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  values(p_job_id,p_device_id,'job.'||p_status,
    jsonb_build_object('exit_code',p_exit_code,'duration_ms',coalesce((p_result->>'duration_ms')::numeric,null),'mission_id',v_mission_id));
  if p_status in ('succeeded','failed','timeout') then
    perform aria_internal.schedule_mission_runner_after_execution_job(v_mission_id,p_status,p_job_id,p_device_id);
  end if;
  return r;
end;
$function$;

revoke all on function aria_internal.aria_m22_a5_claim_scope_v1(text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a5_bind_scope_v1(text,text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a5_frozen_job_authorized_v1(text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a5_recover_running_job_v1(text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a5_claim_frozen_one_shot_job_v1(text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a5_complete_scope_v1(text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a5_revoke_scope_v1(text) from public,anon,authenticated;
grant execute on function aria_internal.aria_m22_a5_claim_scope_v1(text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a5_bind_scope_v1(text,text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a5_frozen_job_authorized_v1(text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a5_recover_running_job_v1(text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a5_claim_frozen_one_shot_job_v1(text) to service_role;
grant execute on function aria_internal.aria_m22_a5_complete_scope_v1(text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a5_revoke_scope_v1(text) to service_role;

commit;
