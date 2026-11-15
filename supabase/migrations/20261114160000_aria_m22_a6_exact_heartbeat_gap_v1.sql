begin;

-- Keep the exact device heartbeat intervals for the active A6 run. A minute
-- sampler cannot reconstruct intermediate heartbeats from last_seen_at alone.
create table if not exists aria_internal.mission_wonder_2_a6_heartbeat_events (
  heartbeat_event_id bigint generated always as identity primary key,
  run_id text not null references aria_internal.mission_wonder_2_a6_runs(run_id) on delete cascade,
  device_id text not null,
  received_at timestamptz not null,
  previous_received_at timestamptz,
  observed_gap_ms bigint not null default 0 check (observed_gap_ms >= 0),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists mission_wonder_2_a6_heartbeat_events_run_time_idx
  on aria_internal.mission_wonder_2_a6_heartbeat_events(run_id,received_at desc);

revoke all on table aria_internal.mission_wonder_2_a6_heartbeat_events
  from public,anon,authenticated,service_role;

comment on table aria_internal.mission_wonder_2_a6_heartbeat_events is
  'Exact gateway-observed heartbeat intervals for active Mission Wonder 2 A6 runs; private audit evidence.';

create or replace function public.heartbeat_device_gateway(
  p_device_id text,
  p_capabilities jsonb,
  p_agent_type text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  r jsonb;
  previous_seen_at timestamptz;
  received_at timestamptz;
  observed_gap_ms bigint := 0;
  active_run_id text;
begin
  select last_seen_at into previous_seen_at
    from aria_internal.device_registry
   where device_id=p_device_id
     and status <> 'disabled'
   for update;
  if not found then return null; end if;

  received_at := clock_timestamp();
  if previous_seen_at is not null then
    observed_gap_ms := greatest(
      0,
      (extract(epoch from (received_at-previous_seen_at))*1000)::bigint
    );
  end if;

  update aria_internal.device_registry
     set status='online',
         capabilities=coalesce(p_capabilities,capabilities),
         metadata=jsonb_build_object('agent_type',coalesce(p_agent_type,agent_type)),
         last_seen_at=received_at,
         updated_at=received_at
   where device_id=p_device_id
     and status <> 'disabled'
  returning to_jsonb(device_registry.*) into r;
  if r is null then return null; end if;

  select run_id into active_run_id
    from aria_internal.mission_wonder_2_a6_runs
   where allowed_device_id=p_device_id
     and status='running'
   order by started_at desc
   limit 1;

  if active_run_id is not null then
    insert into aria_internal.mission_wonder_2_a6_heartbeat_events(
      run_id,device_id,received_at,previous_received_at,observed_gap_ms
    ) values (
      active_run_id,p_device_id,received_at,previous_seen_at,observed_gap_ms
    );
  end if;

  return r;
end;
$function$;

revoke all on function public.heartbeat_device_gateway(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.heartbeat_device_gateway(text,jsonb,text) to postgres,service_role;

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

  -- Use per-heartbeat events written transactionally by the gateway.
  -- Comparing only sampled last_seen_at values can skip an intermediate heartbeat
  -- and inflate the apparent device gap by one or more sampler intervals.
  select coalesce(max(observed_gap_ms),0)
    into observed_heartbeat_gap_ms
    from aria_internal.mission_wonder_2_a6_heartbeat_events
   where run_id=r.run_id
     and received_at>coalesce(previous_sample,r.started_at)
     and previous_received_at>=r.started_at;

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
      suspect_since := coalesce(d.last_seen_at,previous_device_seen,previous_sample,r.started_at,now_at);
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
  elsif observed_heartbeat_gap_ms>r.max_normal_heartbeat_gap_ms then
    -- The true heartbeat gap exceeded the normal 90s target but recovered
    -- before the 120s ceiling. Record that recovery without failing the run.
    insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
    values (r.run_id,'recovery_observed',jsonb_build_object(
      'reason','heartbeat_gap_recovered_within_window',
      'heartbeat_observed_gap_ms',observed_heartbeat_gap_ms,
      'max_normal_heartbeat_gap_ms',r.max_normal_heartbeat_gap_ms,
      'max_recovery_ms',r.max_recovery_ms,
      'device_healthy',true
    ));
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

commit;
