-- Mission Wonder 2 / Step 6 A6: isolated five-mission 24-hour continuity run.
-- Contract only: creates tables/functions and an INACTIVE A6-only cron (#51).
-- It does not create run rows, scopes, missions, jobs, leases, or alter the global freeze.
begin;

create table if not exists aria_internal.mission_wonder_2_a6_runs (
  run_id text primary key check (run_id ~ '^m22-a6-[a-f0-9]{12}$'),
  scope_id text not null unique,
  owner_user_id text not null,
  parent_request_id text not null,
  allowed_device_id text not null
    check (allowed_device_id = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'),
  status text not null default 'armed'
    check (status in ('armed','running','completed','blocked','revoked')),
  window_hours smallint not null default 24 check (window_hours = 24),
  max_missions smallint not null default 5 check (max_missions = 5),
  max_jobs smallint not null default 5 check (max_jobs = 5),
  max_attempts smallint not null default 1 check (max_attempts = 1),
  heartbeat_interval_ms integer not null check (heartbeat_interval_ms between 1000 and 180000),
  max_normal_heartbeat_gap_ms integer not null,
  max_recovery_ms integer not null default 120000 check (max_recovery_ms = 120000),
  max_p95_latency_ms integer not null default 90000 check (max_p95_latency_ms = 90000),
  max_total_cost_usd numeric(12,6) not null default 0 check (max_total_cost_usd = 0),
  ambient_baseline jsonb not null,
  ambient_final jsonb,
  human_gate_ref text not null check (human_gate_ref ~ '^a6-human-gate-[0-9]{10,20}\.[0-9]{1,3}$'),
  started_at timestamptz,
  expires_at timestamptz not null,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (max_normal_heartbeat_gap_ms >= heartbeat_interval_ms
     and max_normal_heartbeat_gap_ms <= heartbeat_interval_ms * 3),
  check ((status = 'armed' and started_at is null)
      or (status <> 'armed' and started_at is not null))
);

create table if not exists aria_internal.mission_wonder_2_a6_scopes (
  scope_id text primary key,
  run_id text not null references aria_internal.mission_wonder_2_a6_runs(run_id) on delete restrict,
  mission_id text not null unique,
  job_id text not null unique,
  owner_user_id text not null,
  request_id text not null unique,
  goal_hash text not null check (goal_hash ~ '^[a-f0-9]{64}$'),
  allowed_device_id text not null
    check (allowed_device_id = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'),
  operation text not null check (operation = 'shell.execute'),
  command text not null check (length(command) between 100 and 12000),
  artifact_path text not null,
  ordinal smallint not null check (ordinal between 1 and 5),
  scheduled_offset_hours smallint not null,
  scheduled_at timestamptz,
  status text not null default 'armed'
    check (status in ('armed','claimed','bound','completed','revoked')),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  bound_at timestamptz,
  completed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (run_id, ordinal),
  check (scheduled_offset_hours = case ordinal
    when 1 then 1 when 2 then 6 when 3 then 12 when 4 then 18 when 5 then 23 end),
  check (job_id ~ '^uo_[a-zA-Z0-9_-]+_a1_[a-f0-9]{16}$'),
  check (artifact_path ~ '^C:\\Windows\\Temp\\ARIA-MW2-A6\\m22-a6-[a-f0-9]{12}\\mission-0[1-5]\\proof-0[1-5]\.txt$')
);

create index if not exists mission_wonder_2_a6_due_idx
  on aria_internal.mission_wonder_2_a6_scopes(status, scheduled_at)
  where status in ('armed','claimed');

create table if not exists aria_internal.mission_wonder_2_a6_telemetry (
  sample_id bigint generated always as identity primary key,
  run_id text not null references aria_internal.mission_wonder_2_a6_runs(run_id) on delete restrict,
  sampled_at timestamptz not null default clock_timestamp(),
  event_type text not null check (event_type in ('heartbeat_sample','fault_observed','dispatcher_event','final_reconciliation')),
  device_last_seen_at timestamptz,
  device_status text,
  heartbeat_age_ms bigint,
  payload jsonb not null default '{}'::jsonb,
  unique (run_id, sampled_at, event_type)
);

alter table aria_internal.mission_wonder_2_a6_runs enable row level security;
alter table aria_internal.mission_wonder_2_a6_scopes enable row level security;
alter table aria_internal.mission_wonder_2_a6_telemetry enable row level security;
revoke all on aria_internal.mission_wonder_2_a6_runs from public, anon, authenticated;
revoke all on aria_internal.mission_wonder_2_a6_scopes from public, anon, authenticated;
revoke all on aria_internal.mission_wonder_2_a6_telemetry from public, anon, authenticated;
grant select, insert, update on aria_internal.mission_wonder_2_a6_runs to service_role;
grant select, insert, update on aria_internal.mission_wonder_2_a6_scopes to service_role;
grant select, insert on aria_internal.mission_wonder_2_a6_telemetry to service_role;
grant usage, select on sequence aria_internal.mission_wonder_2_a6_telemetry_sample_id_seq to service_role;


create or replace function aria_internal.aria_m22_a6_ambient_snapshot_v1()
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  legacy_count integer;
  legacy_fingerprint text;
  active_job_count integer;
  active_job_fingerprint text;
begin
  select count(*)::integer,
         md5(coalesce(string_agg(
           concat_ws('|',m.mission_id,m.status,coalesce(m.updated_at::text,''),
             coalesce(m.next_action,''),coalesce(m.lease_owner,''),coalesce(m.lease_until::text,'')),
           E'\n' order by m.mission_id
         ),''))
    into legacy_count,legacy_fingerprint
    from aria_internal.mission_state m
   where m.status not in ('succeeded','failed','blocked','cancelled','timeout')
     and not exists (select 1 from aria_internal.mission_wonder_2_a6_scopes a where a.mission_id=m.mission_id);

  select count(*)::integer,
         md5(coalesce(string_agg(
           concat_ws('|',j.job_id,j.mission_id,j.device_id,j.status,coalesce(j.updated_at::text,''),
             coalesce(j.lease_owner,''),coalesce(j.lease_until::text,'')),
           E'\n' order by j.job_id
         ),''))
    into active_job_count,active_job_fingerprint
    from aria_internal.execution_jobs j
   where j.status in ('queued','claimed','running')
     and not exists (select 1 from aria_internal.mission_wonder_2_a6_scopes a where a.job_id=j.job_id);

  return jsonb_build_object(
    'legacyNonterminalMissionCount',legacy_count,
    'legacyNonterminalMissionFingerprint',legacy_fingerprint,
    'nonA6ActiveJobCount',active_job_count,
    'nonA6ActiveJobFingerprint',active_job_fingerprint,
    'cron48Active',coalesce((select active from cron.job where jobid=48),false),
    'cron49Active',coalesce((select active from cron.job where jobid=49),false),
    'cron50Active',coalesce((select active from cron.job where jobid=50),false),
    'missionExecutionPaused',true
  );
end;
$function$;

create or replace function aria_internal.aria_m22_a6_arm_run_v1(
  p_run_id text,
  p_owner_user_id text,
  p_parent_request_id text,
  p_human_gate_ref text,
  p_heartbeat_interval_ms integer,
  p_max_normal_heartbeat_gap_ms integer,
  p_scopes jsonb
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  item jsonb;
  ordinal integer;
  expected_offset integer;
  expected_mission text;
  expected_scope text;
  expected_request text;
  expected_path text;
  run_row aria_internal.mission_wonder_2_a6_runs;
  inserted_count integer := 0;
  ambient jsonb;
begin
  if coalesce(p_run_id,'') !~ '^m22-a6-[a-f0-9]{12}$'
     or nullif(btrim(p_owner_user_id),'') is null
     or nullif(btrim(p_parent_request_id),'') is null
     or length(p_parent_request_id)>200
     or coalesce(p_human_gate_ref,'') !~ '^a6-human-gate-[0-9]{10,20}\.[0-9]{1,3}$'
     or p_heartbeat_interval_ms not between 1000 and 180000
     or p_max_normal_heartbeat_gap_ms < p_heartbeat_interval_ms
     or p_max_normal_heartbeat_gap_ms > p_heartbeat_interval_ms*3
     or jsonb_typeof(p_scopes) is distinct from 'array'
     or jsonb_array_length(p_scopes) <> 5 then
    raise exception 'a6_run_spec_invalid';
  end if;

  if exists(select 1 from aria_internal.mission_wonder_2_a6_runs where status='running') then
    raise exception 'a6_another_run_is_active';
  end if;
  ambient := aria_internal.aria_m22_a6_ambient_snapshot_v1();
  if (ambient->>'cron48Active')::boolean or (ambient->>'cron49Active')::boolean or
     (ambient->>'cron50Active')::boolean or (ambient->>'nonA6ActiveJobCount')::integer<>0 then
    raise exception 'a6_ambient_baseline_not_safe';
  end if;

  insert into aria_internal.mission_wonder_2_a6_runs (
    run_id,scope_id,owner_user_id,parent_request_id,allowed_device_id,status,
    window_hours,max_missions,max_jobs,max_attempts,heartbeat_interval_ms,
    max_normal_heartbeat_gap_ms,max_recovery_ms,max_p95_latency_ms,
    max_total_cost_usd,human_gate_ref,ambient_baseline,expires_at
  ) values (
    p_run_id,
    'mission_wonder_2_a6_run_'||p_run_id,
    btrim(p_owner_user_id),
    btrim(p_parent_request_id),
    'windows-fe722cc6681e4f9c9cc35f5ebbb0a089',
    'armed',24,5,5,1,p_heartbeat_interval_ms,
    p_max_normal_heartbeat_gap_ms,120000,90000,0,p_human_gate_ref,ambient,
    clock_timestamp()+interval '25 hours'
  ) returning * into run_row;

  for item in select value from jsonb_array_elements(p_scopes) loop
    ordinal := (item->>'ordinal')::integer;
    expected_offset := case ordinal when 1 then 1 when 2 then 6 when 3 then 12 when 4 then 18 when 5 then 23 else null end;
    expected_mission := 'mission_'||replace(p_run_id,'-','_')||'_'||lpad(ordinal::text,2,'0');
    expected_scope := 'mission_wonder_2_a6_'||p_run_id||'_'||lpad(ordinal::text,2,'0');
    expected_request := p_run_id||'.'||ordinal::text;
    expected_path := 'C:\Windows\Temp\ARIA-MW2-A6\'||p_run_id||'\mission-'||lpad(ordinal::text,2,'0')||'\proof-'||lpad(ordinal::text,2,'0')||'.txt';

    if ordinal not between 1 and 5
       or item->>'mission_id' is distinct from expected_mission
       or item->>'scope_id' is distinct from expected_scope
       or item->>'request_id' is distinct from expected_request
       or item->>'allowed_device_id' is distinct from 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
       or item->>'operation' is distinct from 'shell.execute'
       or item->>'scheduled_offset_hours' is distinct from expected_offset::text
       or item->>'artifact_path' is distinct from expected_path
       or coalesce(item->>'goal_hash','') !~ '^[a-f0-9]{64}$'
       or coalesce(item->>'job_id','') !~ '^uo_[a-zA-Z0-9_-]+_a1_[a-f0-9]{16}$'
       or length(coalesce(item->>'command','')) not between 100 and 12000
       or position(expected_path in coalesce(item->>'command',''))=0
       or position('A6_ARTIFACT_VERIFIED' in coalesce(item->>'command',''))=0
       or position('ARIA_MW2_A6_CONTINUITY_V1|'||p_run_id||'|'||lpad(ordinal::text,2,'0') in coalesce(item->>'command',''))=0 then
      raise exception 'a6_scope_spec_invalid_ordinal_%', ordinal;
    end if;

    insert into aria_internal.mission_wonder_2_a6_scopes (
      scope_id,run_id,mission_id,job_id,owner_user_id,request_id,goal_hash,
      allowed_device_id,operation,command,artifact_path,ordinal,
      scheduled_offset_hours,status,expires_at
    ) values (
      expected_scope,p_run_id,expected_mission,item->>'job_id',btrim(p_owner_user_id),
      expected_request,item->>'goal_hash','windows-fe722cc6681e4f9c9cc35f5ebbb0a089',
      'shell.execute',item->>'command',expected_path,ordinal,expected_offset,'armed',
      clock_timestamp()+interval '25 hours'
    );
    inserted_count := inserted_count+1;
  end loop;

  if inserted_count <> 5 then raise exception 'a6_scope_count_not_five'; end if;
  return jsonb_build_object(
    'status','armed','run_id',run_row.run_id,'scope_id',run_row.scope_id,
    'scope_count',inserted_count,'max_missions',5,'max_jobs',5,
    'window_hours',24,'human_gate_ref',run_row.human_gate_ref
  );
end;
$function$;

create or replace function aria_internal.aria_m22_a6_start_run_v1(
  p_run_id text,
  p_human_gate_ref text
) returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r aria_internal.mission_wonder_2_a6_runs;
  eligible_count integer;
  cron_job_id bigint;
  started timestamptz := clock_timestamp();
begin
  select * into r from aria_internal.mission_wonder_2_a6_runs
   where run_id=p_run_id for update;
  if not found or r.status<>'armed' or r.human_gate_ref is distinct from p_human_gate_ref
     or r.expires_at<=started then
    raise exception 'a6_run_not_armed_or_human_gate_mismatch';
  end if;
  if (select count(*) from aria_internal.mission_wonder_2_a6_scopes where run_id=p_run_id and status='armed')<>5 then
    raise exception 'a6_run_must_have_exactly_five_armed_scopes';
  end if;
  if r.ambient_baseline is distinct from aria_internal.aria_m22_a6_ambient_snapshot_v1() then
    raise exception 'a6_ambient_baseline_changed_before_start';
  end if;
  if exists(select 1 from aria_internal.mission_wonder_2_a6_runs where status='running' and run_id<>p_run_id) then
    raise exception 'a6_another_run_is_active';
  end if;

  select count(*) into eligible_count
    from aria_internal.device_registry d
   where d.device_id=r.allowed_device_id
     and d.agent_type='windows-local' and d.status='online'
     and d.token_hash is not null
     and d.capabilities @> '["shell.execute"]'::jsonb
     and d.last_seen_at>started-interval '180 seconds'
     and not exists (
       select 1 from aria_internal.device_registry other
        where other.device_id<>d.device_id and other.agent_type='windows-local'
          and other.status='online' and other.token_hash is not null
          and other.capabilities @> '["shell.execute"]'::jsonb
          and other.last_seen_at>started-interval '180 seconds'
     );
  if eligible_count<>1 then raise exception 'a6_allowlisted_device_not_uniquely_online_and_fresh'; end if;

  select jobid into cron_job_id from cron.job
   where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute' and active=false;
  if cron_job_id is null then raise exception 'a6_dedicated_cron_missing_or_already_active'; end if;

  update aria_internal.mission_wonder_2_a6_runs
     set status='running',started_at=started,expires_at=started+interval '25 hours',updated_at=started
   where run_id=p_run_id;
  update aria_internal.mission_wonder_2_a6_scopes
     set scheduled_at=started+(scheduled_offset_hours*interval '1 hour'),
         expires_at=started+interval '25 hours',updated_at=started
   where run_id=p_run_id and status='armed';
  update cron.job set active=true where jobid=cron_job_id;

  return jsonb_build_object(
    'status','running','run_id',p_run_id,'started_at',started,
    'window_ends_at',started+interval '24 hours',
    'expires_at',started+interval '25 hours',
    'first_mission_due_at',started+interval '1 hour',
    'cron_job_id',cron_job_id
  );
end;
$function$;

create or replace function aria_internal.aria_m22_a6_claim_due_scope_v1()
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  s aria_internal.mission_wonder_2_a6_scopes;
  r aria_internal.mission_wonder_2_a6_runs;
begin
  perform aria_internal.aria_m22_a6_finish_run_if_due_v1();

  select sc.* into s
    from aria_internal.mission_wonder_2_a6_scopes sc
    join aria_internal.mission_wonder_2_a6_runs ru on ru.run_id=sc.run_id
   where ru.status='running' and ru.started_at is not null
     and clock_timestamp()<ru.started_at+interval '24 hours'
     and ru.expires_at>clock_timestamp()
     and sc.status in ('armed','claimed')
     and sc.scheduled_at<=clock_timestamp()
     and sc.expires_at>clock_timestamp()
   order by sc.scheduled_at,sc.ordinal
   for update of sc skip locked
   limit 1;
  if not found then return null; end if;

  if s.status='armed' then
    update aria_internal.mission_wonder_2_a6_scopes
       set status='claimed',claimed_at=clock_timestamp(),updated_at=clock_timestamp()
     where scope_id=s.scope_id returning * into s;
  end if;

  select * into r from aria_internal.mission_wonder_2_a6_runs where run_id=s.run_id;
  return jsonb_build_object('run',to_jsonb(r),'scope',to_jsonb(s));
end;
$function$;

create or replace function aria_internal.aria_m22_a6_bind_scope_v1(
  p_run_id text,p_scope_id text,p_mission_id text,p_user_id text,
  p_request_id text,p_goal_hash text
) returns boolean
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  s aria_internal.mission_wonder_2_a6_scopes;
  r aria_internal.mission_wonder_2_a6_runs;
  m aria_internal.mission_state;
  expected_goal text;
  n integer;
begin
  select * into s from aria_internal.mission_wonder_2_a6_scopes
   where run_id=p_run_id and scope_id=p_scope_id for update;
  if not found then return false; end if;
  select * into r from aria_internal.mission_wonder_2_a6_runs
   where run_id=p_run_id;
  if not found or r.status<>'running' or r.expires_at<=clock_timestamp() then return false; end if;
  expected_goal := 'Mission Wonder 2 A6 bounded continuity marker '||p_run_id||
    ' sequence '||lpad(s.ordinal::text,2,'0');
  select * into m from aria_internal.mission_state where mission_id=p_mission_id;
  if not found then return false; end if;
  if p_mission_id<>s.mission_id or p_user_id<>s.owner_user_id
     or p_request_id<>s.request_id or p_goal_hash<>s.goal_hash
     or m.goal<>expected_goal
     or m.metadata->>'mission_wonder_2_a6_run_id'<>p_run_id
     or m.metadata->>'mission_wonder_2_a6_run_scope_id'<>r.scope_id
     or m.metadata->>'mission_wonder_2_a6_scope_id'<>s.scope_id
     or m.metadata->>'mission_wonder_2_a6_goal_hash'<>s.goal_hash
     or m.metadata->>'mission_wonder_2_a6_allowed_device_id'<>s.allowed_device_id
     or nullif(m.metadata->>'mission_wonder_2_a6_ordinal','')::integer<>s.ordinal
     or m.metadata->>'mission_wonder_2_a6_continuity'<>'true'
     or m.metadata->>'user_id'<>s.owner_user_id
     or m.metadata->>'request_id'<>s.request_id
     or m.metadata->>'source_application'<>'aria-app-v1'
     or m.metadata->>'goal_source'<>'user'
     or m.metadata->>'execution_lane'<>'user'
     or nullif(coalesce(m.metadata->>'project_id',''),'') is not null then
    return false;
  end if;

  update aria_internal.mission_wonder_2_a6_scopes
     set status='bound',bound_at=coalesce(bound_at,clock_timestamp()),updated_at=clock_timestamp()
   where scope_id=s.scope_id and status in ('claimed','bound') and expires_at>clock_timestamp();
  get diagnostics n=row_count;
  return n=1 or exists(select 1 from aria_internal.mission_wonder_2_a6_scopes
    where scope_id=s.scope_id and status='bound');
end;
$function$;

create or replace function aria_internal.aria_m22_a6_frozen_job_authorized_v1(
  p_job_id text,p_device_id text,p_required_status text
) returns boolean
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  s aria_internal.mission_wonder_2_a6_scopes;
  r aria_internal.mission_wonder_2_a6_runs;
  m aria_internal.mission_state;
  j aria_internal.execution_jobs;
  step jsonb;
  pending jsonb;
  eligible_count integer;
begin
  if coalesce(p_job_id,'')='' or p_device_id<>'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
     or p_required_status not in ('queued','claimed','running') then return false; end if;
  select * into s from aria_internal.mission_wonder_2_a6_scopes
   where job_id=p_job_id and allowed_device_id=p_device_id;
  if not found or s.status<>'bound' or s.expires_at<=clock_timestamp() then return false; end if;
  select * into r from aria_internal.mission_wonder_2_a6_runs
   where run_id=s.run_id;
  if not found or r.status<>'running' or r.expires_at<=clock_timestamp()
     or r.allowed_device_id<>p_device_id then return false; end if;
  select * into m from aria_internal.mission_state where mission_id=s.mission_id;
  if not found or m.status not in ('waiting','running')
     or m.current_step<>0 or m.completed_steps<>0 or m.total_steps<>1 then return false; end if;
  if m.metadata->>'mission_wonder_2_a6_run_id'<>r.run_id
     or m.metadata->>'mission_wonder_2_a6_run_scope_id'<>r.scope_id
     or m.metadata->>'mission_wonder_2_a6_scope_id'<>s.scope_id
     or m.metadata->>'mission_wonder_2_a6_goal_hash'<>s.goal_hash
     or m.metadata->>'mission_wonder_2_a6_allowed_device_id'<>p_device_id
     or nullif(m.metadata->>'mission_wonder_2_a6_ordinal','')::integer<>s.ordinal
     or m.metadata->>'mission_wonder_2_a6_continuity'<>'true'
     or m.metadata->>'user_id'<>s.owner_user_id
     or m.metadata->>'request_id'<>s.request_id
     or m.metadata->>'source_application'<>'aria-app-v1'
     or m.metadata->>'goal_source'<>'user'
     or m.metadata->>'execution_lane'<>'user'
     or nullif(coalesce(m.metadata->>'project_id',''),'') is not null then return false; end if;

  if jsonb_typeof(m.checkpoint->'plan') is distinct from 'array'
     or jsonb_array_length(m.checkpoint->'plan')<>1 then return false; end if;
  step:=m.checkpoint->'plan'->0;
  if (step->>'id') is distinct from ('a6_continuity_marker_'||lpad(s.ordinal::text,2,'0'))
     or step->>'operation'<>'shell.execute'
     or step->>'executor_type'<>'device'
     or step->>'risk'<>'WRITE'
     or step->'target'->>'type'<>'device'
     or step->'target'->>'device_id'<>p_device_id
     or step->'input'->>'command'<>s.command
     or step->'input'->>'cwd'<>'C:\Windows\Temp'
     or coalesce(step->>'timeout_ms','')<>'60000'
     or coalesce(step->>'retryable','true')<>'false'
     or coalesce(step->>'max_attempts','')<>'1'
     or step->'policy'->>'mission_wonder_2_a6_continuity'<>'true'
     or step->'policy'->>'allowed_artifact_path'<>s.artifact_path
     or step->'policy'->>'idempotent_artifact'<>'true'
     or step->'policy'->>'max_artifacts'<>'1'
     or step->'policy'->>'network_access'<>'false'
     or step->'policy'->>'external_mutations'<>'false'
     or step->'authorization'->>'status'<>'approved'
     or step->'authorization'->>'risk_class'<>'WRITE'
     or step->'authorization'->>'evidence_ref'<>'mission-wonder-2-step6-a6-v1-owner-authorization'
     or step->'verify'->>'expected_exit_code'<>'0'
     or step->'verify'->>'stdout_contains' is distinct from ('A6_ARTIFACT_VERIFIED;sequence='||lpad(s.ordinal::text,2,'0')) then return false; end if;

  -- The pending job is stored under the exact fixed step ID.
  pending:=m.checkpoint->'pending_jobs'->(step->>'id');
  if coalesce(pending->>'job_id','')<>p_job_id
     or coalesce(pending->>'attempt','')<>'1' then return false; end if;

  select * into j from aria_internal.execution_jobs
   where job_id=p_job_id and mission_id=s.mission_id and device_id=p_device_id
     and operation='shell.execute' and command=s.command and cwd='C:\Windows\Temp'
     and timeout_ms=60000
     and policy @> '{"mission_wonder_2_a6_continuity":true,"idempotent_artifact":true,"max_artifacts":1,"network_access":false,"external_mutations":false}'::jsonb
     and metadata->>'idempotency_key'=p_job_id;
  if not found or j.status<>p_required_status or j.completed_at is not null then return false; end if;
  if p_required_status='queued' and
     (j.claimed_at is not null or j.lease_owner is not null or j.lease_until is not null) then return false; end if;
  if p_required_status in ('claimed','running') and
     (j.lease_owner is null or j.lease_until is null or j.lease_until<=clock_timestamp()) then return false; end if;
  if (select count(*) from aria_internal.execution_jobs where mission_id=s.mission_id)<>1 then return false; end if;

  select count(*) into eligible_count from aria_internal.device_registry d
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
  return eligible_count=1;
end;
$function$;

create or replace function aria_internal.aria_m22_a6_has_claimable_job_v1(p_device_id text)
returns boolean
language sql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
  select exists(
    select 1 from aria_internal.execution_jobs j
     where j.device_id=p_device_id and j.status='queued'
       and aria_internal.aria_m22_a6_frozen_job_authorized_v1(j.job_id,p_device_id,'queued')
  );
$function$;

create or replace function aria_internal.aria_m22_a6_claim_frozen_job_v1(p_device_id text)
returns jsonb
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  j aria_internal.execution_jobs;
  n integer;
begin
  if p_device_id<>'windows-fe722cc6681e4f9c9cc35f5ebbb0a089' then return null; end if;
  select e.* into j
    from aria_internal.execution_jobs e
    join aria_internal.mission_wonder_2_a6_scopes s on s.job_id=e.job_id
   where e.device_id=p_device_id and e.status='queued'
     and aria_internal.aria_m22_a6_frozen_job_authorized_v1(e.job_id,p_device_id,'queued')
   order by s.scheduled_at,s.ordinal
   for update of e skip locked
   limit 1;
  if not found then return null; end if;

  update aria_internal.execution_jobs
     set status='claimed',claimed_at=clock_timestamp(),
         lease_owner=md5(p_device_id||':'||clock_timestamp()::text||':'||random()::text),
         lease_until=clock_timestamp()+interval '2 minutes',
         updated_at=clock_timestamp()
   where job_id=j.job_id and device_id=p_device_id and status='queued'
     and completed_at is null;
  get diagnostics n=row_count;
  if n<>1 then return null; end if;

  select * into j from aria_internal.execution_jobs where job_id=j.job_id;
  insert into aria_internal.execution_job_events(job_id,device_id,event_type,payload)
  values (j.job_id,p_device_id,'job.claimed_a6_continuity',
    jsonb_build_object('mission_id',j.mission_id,'job_id',j.job_id,
      'run_id',(select run_id from aria_internal.mission_wonder_2_a6_scopes where job_id=j.job_id),
      'attempt',1,'ordinal',(select ordinal from aria_internal.mission_wonder_2_a6_scopes where job_id=j.job_id),
      'global_execution_freeze_preserved',true));
  return to_jsonb(j);
end;
$function$;

create or replace function aria_internal.aria_m22_a6_complete_scope_v1(
  p_run_id text,p_scope_id text,p_mission_id text,p_job_id text
) returns boolean
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  s aria_internal.mission_wonder_2_a6_scopes;
  m aria_internal.mission_state;
  j aria_internal.execution_jobs;
  n integer;
begin
  select * into s from aria_internal.mission_wonder_2_a6_scopes
   where run_id=p_run_id and scope_id=p_scope_id and mission_id=p_mission_id and job_id=p_job_id
   for update;
  if not found or s.status not in ('bound','completed') then return false; end if;
  select * into m from aria_internal.mission_state where mission_id=p_mission_id;
  if not found then return false; end if;
  select * into j from aria_internal.execution_jobs where job_id=p_job_id and mission_id=p_mission_id;
  if not found then return false; end if;

  if m.status<>'succeeded' or m.completed_steps<>1 or m.total_steps<>1
     or m.lease_owner is not null or m.lease_until is not null
     or j.status<>'succeeded' or j.exit_code<>0 or j.completed_at is null
     or j.lease_owner is not null or j.lease_until is not null
     or j.device_id<>s.allowed_device_id or j.operation<>'shell.execute'
     or j.command<>s.command or j.timeout_ms<>60000
     or j.metadata->>'idempotency_key'<>p_job_id
     or j.stdout !~ ('^A6_ARTIFACT_VERIFIED;mode=(created|identical);sequence='||lpad(s.ordinal::text,2,'0')||';sha256=[a-f0-9]{64};artifact=')
     or right(coalesce(j.stdout,''),length(s.artifact_path))<>s.artifact_path
     or (select count(*) from aria_internal.execution_jobs where mission_id=p_mission_id)<>1
     or (select count(*) from aria_internal.execution_job_events where job_id=p_job_id and event_type='job.succeeded')<>1
     or (select count(*) from aria_internal.mission_events where mission_id=p_mission_id and event_type='mission_verified')<>1 then
    return false;
  end if;

  update aria_internal.mission_wonder_2_a6_scopes
     set status='completed',completed_at=coalesce(completed_at,clock_timestamp()),updated_at=clock_timestamp()
   where scope_id=p_scope_id and status='bound';
  get diagnostics n=row_count;
  return n=1 or exists(select 1 from aria_internal.mission_wonder_2_a6_scopes where scope_id=p_scope_id and status='completed');
end;
$function$;

create or replace function aria_internal.aria_m22_a6_finish_run_if_due_v1()
returns integer
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r record;
  n integer := 0;
  completed_count integer;
  active_count integer;
begin
  for r in
    select * from aria_internal.mission_wonder_2_a6_runs
     where status='running' and started_at is not null
       and clock_timestamp()>=started_at+interval '24 hours'
     for update
  loop
    select count(*) into completed_count
      from aria_internal.mission_wonder_2_a6_scopes
     where run_id=r.run_id and status='completed';
    select count(*) into active_count
      from aria_internal.execution_jobs j
      join aria_internal.mission_wonder_2_a6_scopes s on s.job_id=j.job_id
     where s.run_id=r.run_id and j.status in ('queued','claimed','running');
    if completed_count=5 and active_count=0 then
      update aria_internal.mission_wonder_2_a6_runs
         set status='completed',completed_at=clock_timestamp(),updated_at=clock_timestamp()
       where run_id=r.run_id and status='running';
    else
      update aria_internal.mission_wonder_2_a6_runs
         set status='blocked',completed_at=clock_timestamp(),updated_at=clock_timestamp()
       where run_id=r.run_id and status='running';
    end if;
    n:=n+1;
  end loop;
  if not exists(select 1 from aria_internal.mission_wonder_2_a6_runs where status='running') then
    update cron.job set active=false
     where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute';
  end if;
  return n;
end;
$function$;

create or replace function aria_internal.aria_m22_a6_revoke_run_v1(p_run_id text)
returns boolean
language plpgsql security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare n integer;
begin
  if exists (
    select 1 from aria_internal.execution_jobs j
    join aria_internal.mission_wonder_2_a6_scopes s on s.job_id=j.job_id
    where s.run_id=p_run_id and j.status in ('queued','claimed','running')
  ) then return false; end if;

  update aria_internal.mission_wonder_2_a6_scopes
     set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),updated_at=clock_timestamp()
   where run_id=p_run_id and status in ('armed','claimed','bound');
  update aria_internal.mission_wonder_2_a6_runs
     set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),updated_at=clock_timestamp()
   where run_id=p_run_id and status in ('armed','running','blocked');
  get diagnostics n=row_count;
  if not exists(select 1 from aria_internal.mission_wonder_2_a6_runs where status='running') then
    update cron.job set active=false
     where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute';
  end if;
  return n=1 or exists(select 1 from aria_internal.mission_wonder_2_a6_runs where run_id=p_run_id and status='revoked');
end;
$function$;

-- Preserve the existing A4/A5 frozen-job exceptions; add only the exact A6 run scope.
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

  if p_mission_id ~ '^mission_m22_a6_[a-f0-9]{12}_0[1-5]
    select j.device_id,j.status into v_device_id,v_job_status
      from aria_internal.execution_jobs j where j.job_id=p_job_id and j.mission_id=p_mission_id;
    if not found then return false; end if;
    return aria_internal.aria_m22_a6_frozen_job_authorized_v1(p_job_id,v_device_id,v_job_status);
  end if;

  if v_status='running' then return true; end if;
  if v_status not in ('paused','waiting') then return false; end if;
  if coalesce(v_checkpoint->'recovery'->>'status','')<>'waiting_for_async_executor' then return false; end if;
  v_pending_jobs:=v_checkpoint->'pending_jobs';
  if jsonb_typeof(v_pending_jobs) is distinct from 'object' then return false; end if;
  return exists(select 1 from jsonb_each(v_pending_jobs) as pending(step_id,job) where pending.job->>'job_id'=p_job_id);
end;
$function$;

revoke all on function aria_internal.aria_m22_a6_arm_run_v1(text,text,text,text,integer,integer,jsonb) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_start_run_v1(text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_claim_due_scope_v1() from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_bind_scope_v1(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_has_claimable_job_v1(text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_claim_frozen_job_v1(text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_complete_scope_v1(text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_finish_run_if_due_v1() from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_revoke_run_v1(text) from public,anon,authenticated;

grant execute on function aria_internal.aria_m22_a6_arm_run_v1(text,text,text,text,integer,integer,jsonb) to service_role;
grant execute on function aria_internal.aria_m22_a6_start_run_v1(text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_claim_due_scope_v1() to service_role;
grant execute on function aria_internal.aria_m22_a6_bind_scope_v1(text,text,text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_has_claimable_job_v1(text) to service_role;
grant execute on function aria_internal.aria_m22_a6_claim_frozen_job_v1(text) to service_role;
grant execute on function aria_internal.aria_m22_a6_complete_scope_v1(text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_finish_run_if_due_v1() to service_role;
grant execute on function aria_internal.aria_m22_a6_revoke_run_v1(text) to service_role;

-- Dedicated scheduler #51 exists but stays INACTIVE until the separately approved start_run RPC.
do $block$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute';
  if v_job_id is null then
    v_job_id := cron.schedule(
      'aria-mission-wonder-2-a6-dispatcher-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-wonder-2-a6-dispatch-v1',
          headers := jsonb_build_object(
            'x-aria-autonomy-token',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1),
            'Content-Type','application/json'
          ),
          body := '{"action":"dispatch_due"}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  end if;
  update cron.job set active=false where jobid=v_job_id;
end;
$block$;

commit;
 then
    select j.device_id,j.status into v_device_id,v_job_status
      from aria_internal.execution_jobs j where j.job_id=p_job_id and j.mission_id=p_mission_id;
    if not found then return false; end if;
    return aria_internal.aria_m22_a6_frozen_job_authorized_v1(p_job_id,v_device_id,v_job_status);
  end if;

  if v_status='running' then return true; end if;
  if v_status not in ('paused','waiting') then return false; end if;
  if coalesce(v_checkpoint->'recovery'->>'status','')<>'waiting_for_async_executor' then return false; end if;
  v_pending_jobs:=v_checkpoint->'pending_jobs';
  if jsonb_typeof(v_pending_jobs) is distinct from 'object' then return false; end if;
  return exists(select 1 from jsonb_each(v_pending_jobs) as pending(step_id,job) where pending.job->>'job_id'=p_job_id);
end;
$function$;

revoke all on function aria_internal.aria_m22_a6_arm_run_v1(text,text,text,text,integer,integer,jsonb) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_start_run_v1(text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_claim_due_scope_v1() from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_bind_scope_v1(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_has_claimable_job_v1(text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_claim_frozen_job_v1(text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_complete_scope_v1(text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_finish_run_if_due_v1() from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_revoke_run_v1(text) from public,anon,authenticated;

grant execute on function aria_internal.aria_m22_a6_arm_run_v1(text,text,text,text,integer,integer,jsonb) to service_role;
grant execute on function aria_internal.aria_m22_a6_start_run_v1(text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_claim_due_scope_v1() to service_role;
grant execute on function aria_internal.aria_m22_a6_bind_scope_v1(text,text,text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_has_claimable_job_v1(text) to service_role;
grant execute on function aria_internal.aria_m22_a6_claim_frozen_job_v1(text) to service_role;
grant execute on function aria_internal.aria_m22_a6_complete_scope_v1(text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_finish_run_if_due_v1() to service_role;
grant execute on function aria_internal.aria_m22_a6_revoke_run_v1(text) to service_role;

-- Dedicated scheduler #51 exists but stays INACTIVE until the separately approved start_run RPC.
do $block$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute';
  if v_job_id is null then
    v_job_id := cron.schedule(
      'aria-mission-wonder-2-a6-dispatcher-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-wonder-2-a6-dispatch-v1',
          headers := jsonb_build_object(
            'x-aria-autonomy-token',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1),
            'Content-Type','application/json'
          ),
          body := '{"action":"dispatch_due"}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  end if;
  update cron.job set active=false where jobid=v_job_id;
end;
$block$;

commit;
 then
    select j.device_id,j.status into v_device_id,v_job_status
      from aria_internal.execution_jobs j where j.job_id=p_job_id and j.mission_id=p_mission_id;
    if not found then return false; end if;
    return aria_internal.aria_m22_a6_frozen_job_authorized_v1(p_job_id,v_device_id,v_job_status);
  end if;

  if v_status='running' then return true; end if;
  if v_status not in ('paused','waiting') then return false; end if;
  if coalesce(v_checkpoint->'recovery'->>'status','')<>'waiting_for_async_executor' then return false; end if;
  v_pending_jobs:=v_checkpoint->'pending_jobs';
  if jsonb_typeof(v_pending_jobs) is distinct from 'object' then return false; end if;
  return exists(select 1 from jsonb_each(v_pending_jobs) as pending(step_id,job) where pending.job->>'job_id'=p_job_id);
end;
$function$;

revoke all on function aria_internal.aria_m22_a6_arm_run_v1(text,text,text,text,integer,integer,jsonb) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_start_run_v1(text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_claim_due_scope_v1() from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_bind_scope_v1(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_has_claimable_job_v1(text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_claim_frozen_job_v1(text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_complete_scope_v1(text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_finish_run_if_due_v1() from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_revoke_run_v1(text) from public,anon,authenticated;

grant execute on function aria_internal.aria_m22_a6_arm_run_v1(text,text,text,text,integer,integer,jsonb) to service_role;
grant execute on function aria_internal.aria_m22_a6_start_run_v1(text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_claim_due_scope_v1() to service_role;
grant execute on function aria_internal.aria_m22_a6_bind_scope_v1(text,text,text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_has_claimable_job_v1(text) to service_role;
grant execute on function aria_internal.aria_m22_a6_claim_frozen_job_v1(text) to service_role;
grant execute on function aria_internal.aria_m22_a6_complete_scope_v1(text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_finish_run_if_due_v1() to service_role;
grant execute on function aria_internal.aria_m22_a6_revoke_run_v1(text) to service_role;

-- Dedicated scheduler #51 exists but stays INACTIVE until the separately approved start_run RPC.
do $block$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute';
  if v_job_id is null then
    v_job_id := cron.schedule(
      'aria-mission-wonder-2-a6-dispatcher-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-wonder-2-a6-dispatch-v1',
          headers := jsonb_build_object(
            'x-aria-autonomy-token',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1),
            'Content-Type','application/json'
          ),
          body := '{"action":"dispatch_due"}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  end if;
  update cron.job set active=false where jobid=v_job_id;
end;
$block$;

commit;
 then
    select j.device_id,j.status into v_device_id,v_job_status
      from aria_internal.execution_jobs j where j.job_id=p_job_id and j.mission_id=p_mission_id;
    if not found then return false; end if;
    return aria_internal.aria_m22_a6_frozen_job_authorized_v1(p_job_id,v_device_id,v_job_status);
  end if;

  if v_status='running' then return true; end if;
  if v_status not in ('paused','waiting') then return false; end if;
  if coalesce(v_checkpoint->'recovery'->>'status','')<>'waiting_for_async_executor' then return false; end if;
  v_pending_jobs:=v_checkpoint->'pending_jobs';
  if jsonb_typeof(v_pending_jobs) is distinct from 'object' then return false; end if;
  return exists(select 1 from jsonb_each(v_pending_jobs) as pending(step_id,job) where pending.job->>'job_id'=p_job_id);
end;
$function$;

revoke all on function aria_internal.aria_m22_a6_arm_run_v1(text,text,text,text,integer,integer,jsonb) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_start_run_v1(text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_claim_due_scope_v1() from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_bind_scope_v1(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_has_claimable_job_v1(text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_claim_frozen_job_v1(text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_complete_scope_v1(text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_finish_run_if_due_v1() from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a6_revoke_run_v1(text) from public,anon,authenticated;

grant execute on function aria_internal.aria_m22_a6_arm_run_v1(text,text,text,text,integer,integer,jsonb) to service_role;
grant execute on function aria_internal.aria_m22_a6_start_run_v1(text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_claim_due_scope_v1() to service_role;
grant execute on function aria_internal.aria_m22_a6_bind_scope_v1(text,text,text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_frozen_job_authorized_v1(text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_has_claimable_job_v1(text) to service_role;
grant execute on function aria_internal.aria_m22_a6_claim_frozen_job_v1(text) to service_role;
grant execute on function aria_internal.aria_m22_a6_complete_scope_v1(text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a6_finish_run_if_due_v1() to service_role;
grant execute on function aria_internal.aria_m22_a6_revoke_run_v1(text) to service_role;

-- Dedicated scheduler #51 exists but stays INACTIVE until the separately approved start_run RPC.
do $block$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute';
  if v_job_id is null then
    v_job_id := cron.schedule(
      'aria-mission-wonder-2-a6-dispatcher-every-minute',
      '* * * * *',
      $job$
        select net.http_post(
          url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-wonder-2-a6-dispatch-v1',
          headers := jsonb_build_object(
            'x-aria-autonomy-token',(select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token' limit 1),
            'Content-Type','application/json'
          ),
          body := '{"action":"dispatch_due"}'::jsonb,
          timeout_milliseconds := 60000
        );
      $job$
    );
  end if;
  update cron.job set active=false where jobid=v_job_id;
end;
$block$;

commit;
