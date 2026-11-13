-- A6 durable recovery hardening.
-- This migration changes only A6 control-plane functions and private recovery metadata.
-- It does not arm/start a run, create missions/jobs, activate cron, or alter the global freeze.
begin;

alter table aria_internal.mission_wonder_2_a6_runs
  add column if not exists max_recovery_attempts smallint not null default 1;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid='aria_internal.mission_wonder_2_a6_runs'::regclass
       and conname='mission_wonder_2_a6_runs_max_recovery_attempts_check'
  ) then
    alter table aria_internal.mission_wonder_2_a6_runs
      add constraint mission_wonder_2_a6_runs_max_recovery_attempts_check
      check (max_recovery_attempts between 0 and 1);
  end if;
end;
$constraints$;

create table if not exists aria_internal.mission_wonder_2_a6_recovery_gates (
  run_id text primary key
    references aria_internal.mission_wonder_2_a6_runs(run_id) on delete cascade,
  reason text not null,
  started_at timestamptz not null,
  deadline_at timestamptz not null,
  last_seen_at timestamptz,
  last_sampled_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint mission_wonder_2_a6_recovery_gate_deadline_check
    check (deadline_at > started_at)
);

revoke all on table aria_internal.mission_wonder_2_a6_recovery_gates from public, anon, authenticated;

create or replace function aria_internal.aria_m22_a6_sample_runtime_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r aria_internal.mission_wonder_2_a6_runs;
  d aria_internal.device_registry;
  pending_count integer;
  oldest_pending_age_ms bigint;
  previous_sample timestamptz;
  previous_device_seen timestamptz;
  sample_gap_ms bigint;
  heartbeat_age_ms bigint;
  observed_heartbeat_gap_ms bigint;
  block_reason text;
  current_scope_id text;
  payload jsonb;
  gate aria_internal.mission_wonder_2_a6_recovery_gates;
  has_gate boolean := false;
  suspect_since timestamptz;
  recovery_deadline timestamptz;
  active_job_ids jsonb;
  now_at timestamptz := clock_timestamp();
begin
  select * into r
    from aria_internal.mission_wonder_2_a6_runs
   where status='running'
   order by started_at desc
   limit 1;
  if not found then return jsonb_build_object('status','idle'); end if;

  select * into d
    from aria_internal.device_registry
   where device_id=r.allowed_device_id;

  heartbeat_age_ms := case when d.last_seen_at is null then null
    else greatest(0,(extract(epoch from (now_at-d.last_seen_at))*1000)::bigint) end;

  select sampled_at,device_last_seen_at
    into previous_sample,previous_device_seen
    from aria_internal.mission_wonder_2_a6_telemetry
   where run_id=r.run_id and event_type='heartbeat_sample'
   order by sampled_at desc
   limit 1;

  sample_gap_ms := case when previous_sample is null then 0
    else greatest(0,(extract(epoch from (now_at-previous_sample))*1000)::bigint) end;

  observed_heartbeat_gap_ms := case
    when previous_device_seen is null or d.last_seen_at is null then 0
    else greatest(0,(extract(epoch from (d.last_seen_at-previous_device_seen))*1000)::bigint)
  end;

  select count(*)::integer,
         coalesce(max((extract(epoch from (now_at-j.requested_at))*1000)::bigint),0)
    into pending_count,oldest_pending_age_ms
    from aria_internal.execution_jobs j
    join aria_internal.mission_wonder_2_a6_scopes sc on sc.job_id=j.job_id
   where sc.run_id=r.run_id and j.status in ('queued','claimed','running');

  select coalesce(jsonb_agg(j.job_id),'[]'::jsonb)
    into active_job_ids
    from aria_internal.execution_jobs j
    join aria_internal.mission_wonder_2_a6_scopes sc on sc.job_id=j.job_id
   where sc.run_id=r.run_id and j.status in ('claimed','running');

  payload := jsonb_build_object(
    'heartbeatIntervalMs',r.heartbeat_interval_ms,
    'maxNormalHeartbeatGapMs',r.max_normal_heartbeat_gap_ms,
    'maxRecoveryMs',r.max_recovery_ms,
    'heartbeatAgeMs',heartbeat_age_ms,
    'heartbeatObservedGapMs',observed_heartbeat_gap_ms,
    'sampleGapMs',sample_gap_ms,
    'deviceLastSeenAt',d.last_seen_at,
    'deviceOnline',coalesce(d.status='online',false),
    'a6PendingJobs',pending_count,
    'oldestA6PendingAgeMs',oldest_pending_age_ms,
    'nonA6JobsIncluded',false,
    'globalMissionFreezePreserved',true
  );

  insert into aria_internal.mission_wonder_2_a6_telemetry(
    run_id,event_type,device_last_seen_at,device_status,heartbeat_age_ms,payload
  ) values (
    r.run_id,'heartbeat_sample',d.last_seen_at,d.status,heartbeat_age_ms,payload
  );

  if pending_count>1 or oldest_pending_age_ms>300000 then
    block_reason := 'a6_backlog_threshold_exceeded';
  elsif heartbeat_age_ms is not null and heartbeat_age_ms>r.max_recovery_ms then
    block_reason := 'heartbeat_recovery_deadline_exceeded';
  elsif sample_gap_ms>r.max_recovery_ms then
    block_reason := 'sampler_recovery_deadline_exceeded';
  elsif observed_heartbeat_gap_ms>r.max_recovery_ms then
    block_reason := 'heartbeat_observed_gap_exceeded';
  elsif coalesce(d.status,'')<>'online' or heartbeat_age_ms is null
     or heartbeat_age_ms>r.max_normal_heartbeat_gap_ms then
    select * into gate
      from aria_internal.mission_wonder_2_a6_recovery_gates
     where run_id=r.run_id
     for update;
    has_gate := found;
    if has_gate then
      recovery_deadline := gate.deadline_at;
      suspect_since := gate.started_at;
    else
      suspect_since := coalesce(previous_device_seen,previous_sample,r.started_at,now_at);
      recovery_deadline := suspect_since + (r.max_recovery_ms * interval '1 millisecond');
      if recovery_deadline<=now_at then
        block_reason := 'heartbeat_recovery_deadline_exceeded';
      else
        insert into aria_internal.mission_wonder_2_a6_recovery_gates(
          run_id,reason,started_at,deadline_at,last_seen_at,last_sampled_at,updated_at
        ) values (
          r.run_id,'device_heartbeat_stale',suspect_since,recovery_deadline,d.last_seen_at,previous_sample,now_at
        )
        on conflict (run_id) do nothing;
        insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
        values (r.run_id,'recovery_started',jsonb_build_object(
          'reason','device_heartbeat_stale',
          'started_at',suspect_since,
          'deadline_at',recovery_deadline,
          'heartbeat_age_ms',heartbeat_age_ms,
          'sample_gap_ms',sample_gap_ms,
          'active_job_ids',active_job_ids,
          'automatic_retry',true,
          'claims_paused',true
        ));
      end if;
    end if;

    if block_reason is null and now_at<=recovery_deadline then
      update aria_internal.mission_wonder_2_a6_recovery_gates
         set last_seen_at=d.last_seen_at,last_sampled_at=previous_sample,updated_at=now_at
       where run_id=r.run_id;
      return jsonb_build_object(
        'status','recovering','run_id',r.run_id,'reason','device_heartbeat_stale',
        'deadline_at',recovery_deadline,'payload',payload
      );
    elsif block_reason is null then
      block_reason := 'heartbeat_recovery_deadline_exceeded';
    end if;
  elsif sample_gap_ms>r.max_normal_heartbeat_gap_ms then
    -- The sampler resumed inside the configured recovery window and the device
    -- is already healthy. Record the gap; do not turn a recovered monitor tick
    -- into a false device failure.
    insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
    values (r.run_id,'recovery_observed',jsonb_build_object(
      'reason','sampler_gap_recovered',
      'sample_gap_ms',sample_gap_ms,
      'max_recovery_ms',r.max_recovery_ms,
      'device_healthy',true
    ));
  end if;

  if block_reason is not null then
    delete from aria_internal.mission_wonder_2_a6_recovery_gates where run_id=r.run_id;
    select scope_id into current_scope_id
      from aria_internal.mission_wonder_2_a6_scopes
     where run_id=r.run_id and status in ('claimed','bound')
     order by ordinal limit 1;
    if current_scope_id is not null then
      perform aria_internal.aria_m22_a6_block_run_v1(r.run_id,current_scope_id,block_reason);
    else
      update aria_internal.mission_wonder_2_a6_runs
         set status='blocked',completed_at=clock_timestamp(),updated_at=clock_timestamp()
       where run_id=r.run_id and status='running';
      update aria_internal.mission_wonder_2_a6_scopes
         set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),updated_at=clock_timestamp()
       where run_id=r.run_id and status in ('armed','claimed','bound');
      perform aria_internal.aria_m22_a6_set_dispatcher_active_v1(false);
    end if;
    insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
    values (r.run_id,'fault_observed',jsonb_build_object(
      'event',block_reason,
      'deviceOnline',coalesce(d.status='online',false),
      'heartbeatAgeMs',heartbeat_age_ms,
      'heartbeatObservedGapMs',observed_heartbeat_gap_ms,
      'sampleGapMs',sample_gap_ms,
      'maxNormalHeartbeatGapMs',r.max_normal_heartbeat_gap_ms,
      'maxRecoveryMs',r.max_recovery_ms,
      'a6PendingJobs',pending_count,
      'oldestA6PendingAgeMs',oldest_pending_age_ms,
      'automaticRetry',false,
      'manualReconciliationRequired',(current_scope_id is not null)
    ));
    return jsonb_build_object('status','blocked','run_id',r.run_id,
      'reason',block_reason,'payload',payload);
  end if;

  select * into gate
    from aria_internal.mission_wonder_2_a6_recovery_gates
   where run_id=r.run_id
   for update;
  if found and coalesce(d.status,'')='online'
     and heartbeat_age_ms is not null
     and heartbeat_age_ms<=r.max_normal_heartbeat_gap_ms then
    delete from aria_internal.mission_wonder_2_a6_recovery_gates where run_id=r.run_id;
    insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
    values (r.run_id,'recovery_resolved',jsonb_build_object(
      'reason',gate.reason,
      'started_at',gate.started_at,
      'deadline_at',gate.deadline_at,
      'recovered_at',now_at,
      'heartbeat_age_ms',heartbeat_age_ms,
      'heartbeat_observed_gap_ms',observed_heartbeat_gap_ms,
      'automatic_retry',true,
      'claims_resumed',true
    ));
  end if;

  return jsonb_build_object('status','sampled','run_id',r.run_id,'payload',payload);
end;
$function$;

-- Claims use exactly the configured normal freshness limit and cannot pass while
-- the run has an active recovery gate. The previous 180-second allowance was unsafe.
do $claim_scope_patch$
declare
  v_definition text;
  v_old text := $old$and d.last_seen_at>clock_timestamp()-interval '180 seconds'$old$;
  v_new text := $new$and d.last_seen_at>clock_timestamp()-(ru.max_normal_heartbeat_gap_ms*interval '1 millisecond')
          and not exists(select 1 from aria_internal.mission_wonder_2_a6_recovery_gates g where g.run_id=ru.run_id)$new$;
begin
  select pg_get_functiondef(
    'aria_internal.aria_m22_a6_claim_due_scope_v1()'::regprocedure
  ) into v_definition;
  if position(v_new in v_definition)=0 then
    if position(v_old in v_definition)=0 then
      raise exception 'A6_CLAIM_SCOPE_FRESHNESS_PATCH_ANCHOR_MISSING';
    end if;
    execute replace(v_definition,v_old,v_new);
  end if;
end;
$claim_scope_patch$;

-- Keep the existing frozen-job contract, but align it with the same 90-second
-- health fence, pause claims during recovery, and accept only the same job's
-- single controlled recovery attempt.
do $frozen_authorization_patch$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text)'::regprocedure
  ) into v_definition;

  v_old := $old$or r.allowed_device_id<>p_device_id then return false; end if;$old$;
  v_new := $new$or r.allowed_device_id<>p_device_id
     or exists(select 1 from aria_internal.mission_wonder_2_a6_recovery_gates g where g.run_id=r.run_id)
     then return false; end if;$new$;
  if position(v_new in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'A6_AUTH_RUN_GATE_ANCHOR_MISSING'; end if;
    v_definition := replace(v_definition,v_old,v_new);
  end if;

  v_old := $old$or coalesce(step->>'max_attempts','')<>'1'$old$;
  v_new := $new$or coalesce(step->>'max_attempts','') not in ('1','2')$new$;
  if position(v_new in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'A6_AUTH_PLAN_ATTEMPTS_ANCHOR_MISSING'; end if;
    v_definition := replace(v_definition,v_old,v_new);
  end if;

  v_old := $old$if coalesce(pending->>'job_id','')<>p_job_id
     or coalesce(pending->>'attempt','')<>'1' then return false; end if;$old$;
  v_new := $new$if coalesce(pending->>'job_id','')<>p_job_id
     or coalesce(nullif(pending->>'attempt','')::integer,0) not in (1,2)
     or coalesce(nullif((select metadata->>'mission_wonder_2_a6_attempt'
                           from aria_internal.execution_jobs where job_id=p_job_id),'')::integer,1)
        <>coalesce(nullif(pending->>'attempt','')::integer,0) then return false; end if;$new$;
  if position(v_new in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'A6_AUTH_PENDING_ATTEMPT_ANCHOR_MISSING'; end if;
    v_definition := replace(v_definition,v_old,v_new);
  end if;

  v_old := $old$if not found or j.status<>p_required_status or j.completed_at is not null then return false; end if;$old$;
  v_new := $new$if not found or j.status<>p_required_status or j.completed_at is not null
     or coalesce(nullif(j.metadata->>'mission_wonder_2_a6_attempt','')::integer,1) not in (1,2)
     or coalesce(j.recovery_count,0)>(select max_recovery_attempts from aria_internal.mission_wonder_2_a6_runs where run_id=s.run_id)
     then return false; end if;$new$;
  if position(v_new in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'A6_AUTH_JOB_ATTEMPT_ANCHOR_MISSING'; end if;
    v_definition := replace(v_definition,v_old,v_new);
  end if;

  v_old := $old$and d.last_seen_at>clock_timestamp()-interval '180 seconds'$old$;
  v_new := $new$and d.last_seen_at>clock_timestamp()-(r.max_normal_heartbeat_gap_ms*interval '1 millisecond')
     and not exists(select 1 from aria_internal.mission_wonder_2_a6_recovery_gates g where g.run_id=r.run_id)$new$;
  if position(v_new in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'A6_AUTH_DEVICE_FRESHNESS_ANCHOR_MISSING'; end if;
    v_definition := replace(v_definition,v_old,v_new);
  end if;

  execute v_definition;
end;
$frozen_authorization_patch$;

do $claim_event_patch$
declare
  v_definition text;
  v_old text := $old$'attempt',1,'ordinal',$old$;
  v_new text := $new$'attempt',coalesce(nullif(j.metadata->>'mission_wonder_2_a6_attempt','')::integer,1),'ordinal',$new$;
begin
  select pg_get_functiondef(
    'aria_internal.aria_m22_a6_claim_frozen_job_v1(text)'::regprocedure
  ) into v_definition;
  if position(v_new in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'A6_CLAIM_EVENT_ATTEMPT_ANCHOR_MISSING'; end if;
    execute replace(v_definition,v_old,v_new);
  end if;
end;
$claim_event_patch$;

-- A same-job retry is the only recovery allowed by A6: the operation is a
-- bounded idempotent artifact write, network/external effects remain forbidden,
-- and the old worker is fenced by its previous lease_owner.
create or replace function aria_internal.guard_execution_job_transition()
returns trigger
language plpgsql
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  v_terminal boolean := NEW.status IN ('succeeded','failed','timeout','cancelled','blocked');
  v_a5_requeue boolean := false;
  v_a6_requeue boolean := false;
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

  if OLD.status in ('timeout','cancelled') and NEW.status='queued'
     and current_setting('aria_internal.a6_requeue_job_id',true)=OLD.job_id
     and EXISTS(
       select 1
         from aria_internal.mission_wonder_2_a6_scopes s
         join aria_internal.mission_wonder_2_a6_runs r on r.run_id=s.run_id
        where s.job_id=OLD.job_id and s.mission_id=OLD.mission_id
          and s.status='bound' and r.status='running'
          and r.max_recovery_attempts>=1
     ) then
    v_a6_requeue:=true;
  end if;

  if not aria_internal.execution_job_can_transition(OLD.status,NEW.status)
     and not v_a5_requeue and not v_a6_requeue then
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

  if (v_a5_requeue or v_a6_requeue) and (
       NEW.claimed_at is not null or NEW.started_at is not null
       or NEW.lease_owner is not null or NEW.lease_until is not null
     ) then
    raise exception 'controlled_requeue_must_clear_old_lease:%',OLD.job_id;
  end if;
  return NEW;
end;
$function$;

create or replace function aria_internal.aria_m22_a6_recover_running_job_v1(
  p_run_id text,p_scope_id text,p_mission_id text,p_job_id text
) returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r aria_internal.mission_wonder_2_a6_runs;
  s aria_internal.mission_wonder_2_a6_scopes;
  m aria_internal.mission_state;
  j aria_internal.execution_jobs;
  v_attempt integer;
  v_step_id text;
  v_pending jsonb;
  v_plan jsonb;
  v_checkpoint jsonb;
  v_recovery_allowed boolean := false;
  v_updated integer;
  v_now timestamptz := clock_timestamp();
begin
  select * into m from aria_internal.mission_state
   where mission_id=p_mission_id for update;
  if not found or m.status not in ('waiting','running','queued','planning') then return false; end if;

  select * into s from aria_internal.mission_wonder_2_a6_scopes
   where run_id=p_run_id and scope_id=p_scope_id and mission_id=p_mission_id and job_id=p_job_id
   for update;
  if not found or s.status<>'bound' then return false; end if;

  select * into r from aria_internal.mission_wonder_2_a6_runs
   where run_id=p_run_id for update;
  if not found or r.status<>'running' or r.expires_at<=v_now
     or r.max_recovery_attempts<1 then return false; end if;

  select * into j from aria_internal.execution_jobs
   where job_id=p_job_id and mission_id=p_mission_id for update;
  if not found or j.device_id<>s.allowed_device_id or j.operation<>'shell.execute'
     or j.command<>s.command or j.cwd<>'C:\\Windows\\Temp' or j.timeout_ms<>60000
     or j.metadata->>'idempotency_key'<>p_job_id
     or not (j.policy @> '{"mission_wonder_2_a6_continuity":true,"idempotent_artifact":true,"max_artifacts":1,"network_access":false,"external_mutations":false}'::jsonb)
     or coalesce(j.recovery_count,0)>r.max_recovery_attempts then return false; end if;

  v_attempt := coalesce(nullif(j.metadata->>'mission_wonder_2_a6_attempt','')::integer,1);
  if v_attempt<>1 then return false; end if;

  if j.status='running' and j.lease_until is not null and j.lease_until<=v_now then
    update aria_internal.execution_jobs
       set status='timeout',completed_at=v_now,updated_at=v_now,
           lease_owner=null,lease_until=null,exit_code=null,
           recovery_count=1,
           stderr='watchdog: a6 running lease expired'
     where job_id=p_job_id and status='running' and completed_at is null;
    get diagnostics v_updated=row_count;
    if v_updated<>1 then return false; end if;
    insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    values (p_job_id,j.device_id,'job.timeout',jsonb_build_object(
      'reason','watchdog_running_lease_expired',
      'mission_wonder_2_a6_same_job_recovery',true,
      'at',v_now
    ));
    select * into j from aria_internal.execution_jobs where job_id=p_job_id for update;
  end if;

  if j.status='queued' and j.completed_at is null and j.recovery_count=1
     and j.claimed_at is null and j.lease_owner is null and j.lease_until is null then
    v_recovery_allowed:=true; -- claimed attempt expired before starting; no side effect ran
  elsif j.status='timeout' and j.completed_at is not null and j.recovery_count=1
     and exists(
       select 1 from aria_internal.execution_job_events e
        where e.job_id=p_job_id and e.event_type='job.timeout'
          and e.payload->>'reason' in ('watchdog_running_timeout','watchdog_running_lease_expired','stale_running_lease')
     ) then
    v_recovery_allowed:=true;
  elsif j.status='cancelled' and j.completed_at is not null and j.recovery_count=0
     and j.result->'metadata'->>'mission_wonder_2_a6_attempt'='1'
     and coalesce(j.result->'metadata'->>'lease_owner','')<>''
     and j.result->>'status'='cancelled'
     and exists(
       select 1 from aria_internal.mission_wonder_2_a6_telemetry t
        where t.run_id=p_run_id and t.event_type='recovery_started'
          and t.sampled_at>=coalesce(j.started_at,j.claimed_at,j.requested_at)
          and coalesce(t.payload->'active_job_ids','[]'::jsonb) ? p_job_id
     ) then
    v_recovery_allowed:=true;
  end if;
  if not v_recovery_allowed then return false; end if;

  if (select count(*) from aria_internal.execution_jobs where mission_id=p_mission_id)<>1 then return false; end if;
  if exists(select 1 from aria_internal.mission_wonder_2_a6_recovery_gates where run_id=p_run_id) then
    return false;
  end if;

  if jsonb_typeof(m.checkpoint->'plan') is distinct from 'array'
     or jsonb_array_length(m.checkpoint->'plan')<>1 then return false; end if;
  v_plan:=m.checkpoint->'plan';
  v_step_id:=v_plan->0->>'id';
  if v_step_id is distinct from ('a6_continuity_marker_'||lpad(s.ordinal::text,2,'0'))
     or v_plan->0->'policy'->>'idempotent_artifact'<>'true'
     or v_plan->0->'policy'->>'network_access'<>'false'
     or v_plan->0->'policy'->>'external_mutations'<>'false' then return false; end if;

  v_pending:=m.checkpoint->'pending_jobs'->v_step_id;
  if coalesce(v_pending->>'job_id','')<>p_job_id
     or coalesce(v_pending->>'attempt','')<>'1' then return false; end if;

  v_checkpoint:=jsonb_set(m.checkpoint,ARRAY['pending_jobs',v_step_id],
    coalesce(v_pending,'{}'::jsonb)||jsonb_build_object('status','queued','attempt',2,'job_id',p_job_id),true);
  v_checkpoint:=jsonb_set(v_checkpoint,'{plan,0,max_attempts}','2'::jsonb,true);
  v_checkpoint:=jsonb_set(v_checkpoint,'{attempts}',
    coalesce(v_checkpoint->'attempts','{}'::jsonb)||jsonb_build_object(v_step_id,2),true);
  v_checkpoint:=jsonb_set(v_checkpoint,'{recovery}',
    coalesce(v_checkpoint->'recovery','{}'::jsonb)||jsonb_build_object(
      'status','waiting_for_async_executor',
      'reason','a6_same_job_reclaimed_after_interruption',
      'job_id',p_job_id,
      'previous_attempt',1,
      'next_attempt',2,
      'new_job_created',false,
      'at',v_now
    ),true);

  perform set_config('aria_internal.a6_requeue_job_id',p_job_id,true);
  update aria_internal.execution_jobs
     set status='queued',completed_at=null,claimed_at=null,started_at=null,
         lease_owner=null,lease_until=null,exit_code=null,stdout='',stderr='',
         result='{}'::jsonb,recovery_count=1,
         metadata=metadata||jsonb_build_object(
           'mission_wonder_2_a6_attempt',2,
           'mission_wonder_2_a6_recovery_reason','a6_same_job_idempotent_recovery'
         ),
         updated_at=v_now
   where job_id=p_job_id and status in ('timeout','cancelled','queued');
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'A6_SAME_JOB_REQUEUE_FAILED'; end if;

  update aria_internal.mission_state
     set checkpoint=v_checkpoint,status='waiting',lease_owner=null,lease_until=null,
         current_step=0,completed_steps=0,
         next_action='resume_a6_same_execution_job_attempt_2',
         updated_at=v_now
   where mission_id=p_mission_id;

  insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  values (p_job_id,s.allowed_device_id,'job.recovered_a6_same_job',jsonb_build_object(
    'run_id',p_run_id,'scope_id',p_scope_id,'mission_id',p_mission_id,
    'previous_attempt',1,'next_attempt',2,'same_job_id',true,
    'new_job_created',false,'fencing_required',true,'recovery_count',1
  ));
  insert into aria_internal.mission_events(mission_id,event_type,payload)
  values (p_mission_id,'mission_resumed',jsonb_build_object(
    'reason','mission_wonder_2_a6_same_job_recovery',
    'run_id',p_run_id,'scope_id',p_scope_id,'job_id',p_job_id,
    'previous_attempt',1,'next_attempt',2,'new_job_created',false
  ));
  return true;
end;
$function$;

create or replace function aria_internal.aria_m22_a6_reconcile_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r record;
  m aria_internal.mission_state;
  completed_count integer:=0;
  recovered_count integer:=0;
  blocked_count integer:=0;
begin
  for r in
    select sc.run_id,sc.scope_id,sc.mission_id,sc.job_id,sc.status,j.status as job_status
      from aria_internal.mission_wonder_2_a6_scopes sc
      join aria_internal.mission_wonder_2_a6_runs ru on ru.run_id=sc.run_id
      left join aria_internal.execution_jobs j on j.job_id=sc.job_id
     where ru.status='running' and sc.status in ('bound','claimed')
     order by sc.ordinal
  loop
    select * into m from aria_internal.mission_state where mission_id=r.mission_id;
    if not found then continue; end if;
    if m.status='succeeded' then
      if aria_internal.aria_m22_a6_complete_scope_v1(r.run_id,r.scope_id,r.mission_id,r.job_id) then
        completed_count:=completed_count+1;
      end if;
    elsif r.job_status in ('queued','timeout','cancelled')
       and aria_internal.aria_m22_a6_recover_running_job_v1(r.run_id,r.scope_id,r.mission_id,r.job_id) then
      recovered_count:=recovered_count+1;
    elsif m.status in ('failed','blocked','cancelled','timeout')
       or r.job_status in ('failed','timeout','cancelled') then
      update aria_internal.mission_wonder_2_a6_runs
         set status='blocked',completed_at=clock_timestamp(),updated_at=clock_timestamp()
       where run_id=r.run_id and status='running';
      update aria_internal.mission_wonder_2_a6_scopes
         set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),updated_at=clock_timestamp()
       where run_id=r.run_id and status in ('armed','claimed','bound');
      insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
      values (r.run_id,'fault_observed',jsonb_build_object(
        'event','mission_terminal_failure',
        'mission_id',r.mission_id,
        'mission_status',m.status,
        'job_status',r.job_status,
        'automatic_retry',false
      ));
      blocked_count:=blocked_count+1;
    end if;
  end loop;
  if not exists(select 1 from aria_internal.mission_wonder_2_a6_runs where status='running') then
    perform aria_internal.aria_m22_a6_set_dispatcher_active_v1(false);
  end if;
  return jsonb_build_object('completed',completed_count,'recovered',recovered_count,'blocked',blocked_count);
end;
$function$;

-- Fencing-aware authorization status for the Windows worker. Old attempts see
-- a changed lease_owner and must abort rather than publish stale results.
create or replace function public.execution_job_authorization_status_gateway(
  p_job_id text,p_device_id text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  v_mission_id text;
  v_mission_status text;
  v_job_status text;
  v_lease_owner text;
  v_lease_until timestamptz;
  v_attempt integer:=1;
  v_a6 boolean:=false;
  v_authorized boolean:=false;
begin
  select j.mission_id,j.status,j.lease_owner,j.lease_until,
         coalesce(nullif(j.metadata->>'mission_wonder_2_a6_attempt','')::integer,1)
    into v_mission_id,v_job_status,v_lease_owner,v_lease_until,v_attempt
    from aria_internal.execution_jobs j
   where j.job_id=p_job_id and j.device_id=p_device_id;
  if not found then
    return jsonb_build_object('error','job_not_owned_or_missing','authorized',false);
  end if;

  select exists(select 1 from aria_internal.mission_wonder_2_a6_scopes s
    where s.job_id=p_job_id and s.allowed_device_id=p_device_id) into v_a6;

  select m.status into v_mission_status
    from aria_internal.mission_state m
   where m.mission_id=v_mission_id
   for update;

  if v_a6 then
    v_authorized := v_job_status='running'
      and v_lease_owner is not null and v_lease_until>clock_timestamp()
      and aria_internal.aria_m22_a6_frozen_job_authorized_v1(p_job_id,p_device_id,'running');
  else
    v_authorized := v_job_status='running'
      and v_lease_owner is not null and v_lease_until>clock_timestamp()
      and aria_internal.mission_job_authorization_allowed(v_mission_id,p_job_id);
  end if;

  return jsonb_build_object(
    'job_id',p_job_id,'status',v_job_status,
    'mission_status',coalesce(v_mission_status,'missing'),
    'authorized',v_authorized,
    'lease_owner',v_lease_owner,
    'lease_until',v_lease_until,
    'attempt',v_attempt
  );
end;
$function$;

-- Keep the two-argument start function for internal compatibility, but revoke
-- direct API execution. The physical gateway now uses the fenced three-argument form.
create or replace function public.start_execution_job_gateway(
  p_job_id text,p_device_id text,p_lease_owner text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  v_mission_id text;
  v_mission_status text;
  v_job_lease_owner text;
  v_job_lease_until timestamptz;
  v_a6 boolean:=false;
  v_authorized boolean:=false;
  r jsonb;
begin
  select j.mission_id,j.lease_owner,j.lease_until
    into v_mission_id,v_job_lease_owner,v_job_lease_until
    from aria_internal.execution_jobs j
   where j.job_id=p_job_id and j.device_id=p_device_id and j.status='claimed';
  if not found then return null; end if;

  select exists(select 1 from aria_internal.mission_wonder_2_a6_scopes s
    where s.job_id=p_job_id and s.allowed_device_id=p_device_id) into v_a6;

  if v_job_lease_owner is null or v_job_lease_until<=clock_timestamp()
     or (v_a6 and p_lease_owner is distinct from v_job_lease_owner)
     or (p_lease_owner is not null and p_lease_owner is distinct from v_job_lease_owner) then
    return null;
  end if;

  select m.status into v_mission_status
    from aria_internal.mission_state m
   where m.mission_id=v_mission_id
   for update;

  if v_a6 then
    v_authorized:=aria_internal.aria_m22_a6_frozen_job_authorized_v1(p_job_id,p_device_id,'claimed');
  else
    v_authorized:=FOUND and aria_internal.mission_job_authorization_allowed(v_mission_id,p_job_id);
  end if;

  if not coalesce(v_authorized,false) then
    update aria_internal.execution_jobs
       set status='cancelled',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
           lease_owner=null,lease_until=null,claimed_at=null,exit_code=null,
           stderr=concat_ws(E'\n',nullif(stderr,''),'fail_closed:mission_not_authorized_at_start')
     where job_id=p_job_id and device_id=p_device_id and status='claimed'
     returning to_jsonb(execution_jobs.*) into r;
    insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    values(p_job_id,p_device_id,'job.blocked_mission_not_authorized',
      jsonb_build_object('mission_id',v_mission_id,'mission_status',v_mission_status,'phase','start','at',clock_timestamp()));
    return null;
  end if;

  update aria_internal.execution_jobs
     set status='running',started_at=clock_timestamp(),updated_at=clock_timestamp()
   where job_id=p_job_id and device_id=p_device_id and status='claimed'
     and ((p_lease_owner is not null and lease_owner=p_lease_owner)
       or (p_lease_owner is null and not v_a6))
   returning to_jsonb(execution_jobs.*) into r;
  return r;
end;
$function$;

-- Add the lease fence to the completion transaction. A stale device process may
-- still have network access after a recovery; it cannot commit against a new lease.
create or replace function public.complete_execution_job_gateway(
  p_job_id text,p_device_id text,p_status text,p_exit_code integer,
  p_stdout text,p_stderr text,p_result jsonb,p_lease_owner text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r jsonb;
  v_mission_id text;
  v_mission_status text;
  v_job_status text;
  v_current_lease_owner text;
  v_lease_until timestamptz;
  v_current_attempt integer:=1;
  v_submitted_attempt integer:=1;
  v_is_a5 boolean:=false;
  v_is_a6 boolean:=false;
  v_a6_cancel_during_recovery boolean:=false;
  v_authorized boolean:=false;
begin
  select j.mission_id into v_mission_id
    from aria_internal.execution_jobs j
   where j.job_id=p_job_id and j.device_id=p_device_id;
  if not found then return null; end if;

  select m.status into v_mission_status
    from aria_internal.mission_state m
   where m.mission_id=v_mission_id for update;
  if not found then return null; end if;

  select j.status,j.lease_owner,j.lease_until,
         coalesce(nullif(j.metadata->>'mission_wonder_2_a6_attempt','')::integer,1)
    into v_job_status,v_current_lease_owner,v_lease_until,v_current_attempt
    from aria_internal.execution_jobs j
   where j.job_id=p_job_id and j.device_id=p_device_id
   for update;
  if not found then return null; end if;
  if v_job_status not in ('running','claimed') then return null; end if;

  if v_current_lease_owner is null or v_lease_until<=clock_timestamp()
     or (exists(select 1 from aria_internal.mission_wonder_2_a6_scopes s
                 where s.job_id=p_job_id and s.allowed_device_id=p_device_id)
         and p_lease_owner is distinct from v_current_lease_owner)
     or (p_lease_owner is not null and p_lease_owner is distinct from v_current_lease_owner) then
    insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
    values(p_job_id,p_device_id,'job.stale_lease_result_rejected',
      jsonb_build_object('mission_id',v_mission_id,'submitted_lease_owner_present',p_lease_owner is not null,
        'current_attempt',v_current_attempt,'at',clock_timestamp()));
    return null;
  end if;

  select exists(
    select 1 from aria_internal.mission_wonder_2_a5_scopes s
     where s.scope_id='mission_wonder_2_a5_authorized_once'
       and s.mission_id=v_mission_id and s.job_id=p_job_id
       and s.recovery_used=true and s.status='recovered'
  ) into v_is_a5;

  select exists(
    select 1 from aria_internal.mission_wonder_2_a6_scopes s
     where s.mission_id=v_mission_id and s.job_id=p_job_id
       and s.allowed_device_id=p_device_id
  ) into v_is_a6;

  if v_is_a5 then
    v_submitted_attempt:=coalesce(nullif(p_result->'metadata'->>'mission_wonder_2_a5_attempt','')::integer,1);
    if v_submitted_attempt<>coalesce(nullif((select metadata->>'mission_wonder_2_a5_attempt'
       from aria_internal.execution_jobs where job_id=p_job_id),'')::integer,1) then
      insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
      values(p_job_id,p_device_id,'job.a5_stale_attempt_rejected',
        jsonb_build_object('submitted_attempt',v_submitted_attempt,'at',clock_timestamp()));
      return null;
    end if;
  end if;

  if v_is_a6 then
    v_submitted_attempt:=coalesce(nullif(p_result->'metadata'->>'mission_wonder_2_a6_attempt','')::integer,1);
    if v_submitted_attempt<>v_current_attempt then
      insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
      values(p_job_id,p_device_id,'job.a6_stale_attempt_rejected',
        jsonb_build_object('submitted_attempt',v_submitted_attempt,'current_attempt',v_current_attempt,'at',clock_timestamp()));
      return null;
    end if;

    select exists(select 1 from aria_internal.mission_wonder_2_a6_recovery_gates g
       join aria_internal.mission_wonder_2_a6_scopes s on s.run_id=g.run_id
      where s.job_id=p_job_id and g.run_id=s.run_id) and p_status='cancelled'
      into v_a6_cancel_during_recovery;

    v_authorized := v_a6_cancel_during_recovery
      or aria_internal.aria_m22_a6_frozen_job_authorized_v1(p_job_id,p_device_id,'running');
  else
    v_authorized := aria_internal.mission_job_authorization_allowed(v_mission_id,p_job_id);
  end if;

  if not coalesce(v_authorized,false) then
    update aria_internal.execution_jobs
       set status='cancelled',completed_at=clock_timestamp(),updated_at=clock_timestamp(),
           lease_owner=null,lease_until=null,claimed_at=null,exit_code=null,
           stderr=concat_ws(E'\n',nullif(stderr,''),'fail_closed:mission_not_authorized_at_completion'),
           result=coalesce(p_result,'{}'::jsonb)
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
     set status=p_status,exit_code=p_exit_code,stdout=p_stdout,stderr=p_stderr,result=coalesce(p_result,'{}'::jsonb),
         completed_at=clock_timestamp(),updated_at=clock_timestamp(),
         lease_owner=null,lease_until=null
   where job_id=p_job_id and device_id=p_device_id and status in ('running','claimed')
   returning to_jsonb(execution_jobs.*),mission_id into r,v_mission_id;
  if r is null then return null; end if;

  insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  values(p_job_id,p_device_id,'job.'||p_status,
    jsonb_build_object('exit_code',p_exit_code,'duration_ms',coalesce((p_result->>'duration_ms')::numeric,null),
      'mission_id',v_mission_id,'a6_attempt',v_current_attempt));
  if p_status in ('succeeded','failed','timeout') then
    perform aria_internal.schedule_mission_runner_after_execution_job(v_mission_id,p_status,p_job_id,p_device_id);
  end if;
  return r;
end;
$function$;

do $gateway_privileges$
begin
  if to_regprocedure('public.start_execution_job_gateway(text,text)') is not null then
    execute 'revoke all on function public.start_execution_job_gateway(text,text) from public,anon,authenticated';
  end if;
  if to_regprocedure('public.complete_execution_job_gateway(text,text,text,integer,text,text,jsonb)') is not null then
    execute 'revoke all on function public.complete_execution_job_gateway(text,text,text,integer,text,text,jsonb) from public,anon,authenticated';
  end if;
  execute 'revoke all on function public.start_execution_job_gateway(text,text,text) from public,anon,authenticated';
  execute 'revoke all on function public.complete_execution_job_gateway(text,text,text,integer,text,text,jsonb,text) from public,anon,authenticated';
end;
$gateway_privileges$;
grant execute on function public.start_execution_job_gateway(text,text,text) to postgres,service_role;
grant execute on function public.complete_execution_job_gateway(text,text,text,integer,text,text,jsonb,text) to postgres,service_role;
revoke all on function aria_internal.aria_m22_a6_recover_running_job_v1(text,text,text,text) from public,anon,authenticated;
grant execute on function aria_internal.aria_m22_a6_recover_running_job_v1(text,text,text,text) to postgres;

-- Final reconciliation accepts only the one explicitly bounded idempotent retry
-- and heartbeat/sampler gaps that recovered before max_recovery_ms.
do $finish_policy_patch$
declare
  v_definition text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'aria_internal.aria_m22_a6_finish_run_if_due_v1()'::regprocedure
  ) into v_definition;

  v_old := $old$max_recovery_count=0 and heartbeat_sample_count>=1368 and$old$;
  v_new := $new$max_recovery_count<=r.max_recovery_attempts and heartbeat_sample_count>=1368 and$new$;
  if position(v_new in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'A6_FINISH_RECOVERY_COUNT_ANCHOR_MISSING'; end if;
    v_definition := replace(v_definition,v_old,v_new);
  end if;

  v_old := $old$max_heartbeat_age_ms<=r.max_normal_heartbeat_gap_ms and
       max_sample_gap_ms<=r.max_normal_heartbeat_gap_ms and$old$;
  v_new := $new$max_heartbeat_age_ms<=r.max_recovery_ms and
       max_sample_gap_ms<=r.max_recovery_ms and$new$;
  if position(v_new in v_definition)=0 then
    if position(v_old in v_definition)=0 then raise exception 'A6_FINISH_RECOVERY_WINDOW_ANCHOR_MISSING'; end if;
    v_definition := replace(v_definition,v_old,v_new);
  end if;

  execute v_definition;
end;
$finish_policy_patch$;

do $permissions$
begin
  revoke all on function aria_internal.aria_m22_a6_sample_runtime_v1() from public,anon,authenticated;
  revoke all on function aria_internal.aria_m22_a6_reconcile_v1() from public,anon,authenticated;
  grant execute on function aria_internal.aria_m22_a6_sample_runtime_v1() to postgres;
  grant execute on function aria_internal.aria_m22_a6_reconcile_v1() to postgres;
  if exists(select 1 from cron.job where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute' and active) then
    raise exception 'A6_CRON_MUST_REMAIN_INACTIVE_DURING_DURABLE_RECOVERY_MIGRATION';
  end if;
  if exists(select 1 from cron.job where jobid in (48,49,50) and active) then
    raise exception 'A6_LEGACY_CRONS_MUST_REMAIN_DISABLED';
  end if;
end;
$permissions$;

commit;
