-- Deterministic PostgreSQL integration for the A6 device-claim lane.
-- All fixture writes are enclosed in one transaction and rolled back.
-- No gateway endpoint, LIVE secret, real device, cron, or mission runner is invoked.

begin;

do $a6_claim_test$
declare
  v_run_id text := 'm22-a6-deadbeef0123';
  v_scope_id text := 'mission_wonder_2_a6_m22-a6-deadbeef0123_01';
  v_mission_id text := 'mission_m22_a6_deadbeef0123_01';
  v_job_id text := 'uo_mission_m22_a6_deadbeef0123_a1_0123456789abcdef';
  v_device_id text := 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089';
  v_wrong_device_id text := 'windows-a6-negative-test-device';
  v_owner_id text := 'a6-postgres-fixture-owner';
  v_request_id text := 'm22-a6-deadbeef0123.1';
  v_human_gate_ref text := 'a6-human-gate-1762869600.123';
  v_step_id text := 'a6_continuity_marker_01';
  v_artifact_path text := 'C:\Windows\Temp\ARIA-MW2-A6\m22-a6-deadbeef0123\mission-01\proof-01.txt';
  v_command text := '$ErrorActionPreference = ''Stop''; $artifact = ''C:\Windows\Temp\ARIA-MW2-A6\m22-a6-deadbeef0123\mission-01\proof-01.txt''; $marker = ''ARIA_MW2_A6_CONTINUITY_V1|m22-a6-deadbeef0123|01''; Write-Output ''A6_ARTIFACT_VERIFIED;mode=created''';
  v_goal text := 'Mission Wonder 2 A6 bounded continuity marker m22-a6-deadbeef0123 sequence 01';
  v_baseline jsonb;
  v_step jsonb;
  v_metadata jsonb;
  v_claim jsonb;
  v_event jsonb;
  v_sample jsonb;
  v_recovered boolean;
  v_reconcile jsonb;
  v_old_lease_owner text;
  v_claim_2 jsonb;
  v_stale_complete jsonb;
  v_legacy_start jsonb;
  v_legacy_complete jsonb;
  v_count integer;
begin
  -- The fixture must begin under the same frozen/disabled baseline as LIVE.
  v_baseline := aria_internal.aria_m22_a6_ambient_snapshot_v1();
  if (v_baseline->>'missionExecutionPaused')::boolean is distinct from true then
    raise exception 'A6_TEST_GLOBAL_FREEZE_NOT_PRESERVED';
  end if;
  if (v_baseline->>'cron48Active')::boolean
     or (v_baseline->>'cron49Active')::boolean
     or (v_baseline->>'cron50Active')::boolean then
    raise exception 'A6_TEST_LEGACY_CRON_ACTIVE';
  end if;
  if exists (
    select 1 from cron.job
     where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute' and active
  ) then
    raise exception 'A6_TEST_DEDICATED_CRON_MUST_STAY_OFF';
  end if;

  -- Fresh, unique allowlisted device. No other Windows executor is introduced.
  insert into aria_internal.device_registry(
    device_id,agent_type,status,token_hash,capabilities,last_seen_at
  ) values (
    v_device_id,'windows-local','online','a6-postgres-fixture-token-hash',
    '["shell.execute"]'::jsonb,clock_timestamp()
  );

  insert into aria_internal.mission_wonder_2_a6_runs(
    run_id,scope_id,owner_user_id,parent_request_id,allowed_device_id,status,
    window_hours,max_missions,max_jobs,max_attempts,heartbeat_interval_ms,
    max_normal_heartbeat_gap_ms,max_recovery_ms,max_p95_latency_ms,max_total_cost_usd,
    minimum_mission_span_ms,max_mission_intermission_ms,human_gate_ref,
    ambient_baseline,started_at,expires_at
  ) values (
    v_run_id,'mission_wonder_2_a6_run_'||v_run_id,v_owner_id,'a6-claim-test-parent',
    v_device_id,'running',24,5,5,1,30000,90000,120000,90000,0,
    64800000,25200000,v_human_gate_ref,v_baseline,
    clock_timestamp()-interval '1 minute',clock_timestamp()+interval '24 hours'
  );

  insert into aria_internal.mission_wonder_2_a6_scopes(
    scope_id,run_id,mission_id,job_id,owner_user_id,request_id,goal_hash,
    allowed_device_id,operation,command,artifact_path,ordinal,
    scheduled_offset_hours,scheduled_at,status,expires_at
  ) values (
    v_scope_id,v_run_id,v_mission_id,v_job_id,v_owner_id,v_request_id,repeat('a',64),
    v_device_id,'shell.execute',v_command,v_artifact_path,1,1,
    clock_timestamp()-interval '1 minute','bound',clock_timestamp()+interval '24 hours'
  );

  v_step := jsonb_build_object(
    'id',v_step_id,
    'operation','shell.execute',
    'executor_type','device',
    'risk','WRITE',
    'target',jsonb_build_object('type','device','device_id',v_device_id),
    'input',jsonb_build_object('command',v_command,'cwd','C:\Windows\Temp'),
    'policy',jsonb_build_object(
      'read_only',false,
      'mission_wonder_2_a6_continuity',true,
      'allowed_artifact_path',v_artifact_path,
      'idempotent_artifact',true,
      'max_artifacts',1,
      'network_access',false,
      'external_mutations',false
    ),
    'authorization',jsonb_build_object(
      'status','approved','risk_class','WRITE','evidence_ref',v_human_gate_ref
    ),
    'timeout_ms',60000,
    'retryable',false,
    'max_attempts',1,
    'depends_on','[]'::jsonb,
    'verify',jsonb_build_object(
      'expected_exit_code',0,
      'stdout_contains','A6_ARTIFACT_VERIFIED;mode='
    )
  );

  v_metadata := jsonb_build_object(
    'mission_wonder_2_a6_run_id',v_run_id,
    'mission_wonder_2_a6_run_scope_id','mission_wonder_2_a6_run_'||v_run_id,
    'mission_wonder_2_a6_scope_id',v_scope_id,
    'mission_wonder_2_a6_goal_hash',repeat('a',64),
    'mission_wonder_2_a6_allowed_device_id',v_device_id,
    'mission_wonder_2_a6_ordinal',1,
    'mission_wonder_2_a6_continuity',true,
    'mission_wonder_2_a6_human_gate_ref',v_human_gate_ref,
    'user_id',v_owner_id,
    'owner_user_id',v_owner_id,
    'request_id',v_request_id,
    'source_application','aria-app-v1',
    'goal_source','user',
    'execution_lane','user'
  );

  insert into aria_internal.mission_state(
    mission_id,goal,status,checkpoint,current_step,completed_steps,total_steps,
    metadata,updated_at
  ) values (
    v_mission_id,v_goal,'waiting',
    jsonb_build_object(
      'plan',jsonb_build_array(v_step),
      'pending_jobs',jsonb_build_object(
        v_step_id,jsonb_build_object('job_id',v_job_id,'attempt',1)
      )
    ),
    0,0,1,v_metadata,clock_timestamp()
  );

  insert into aria_internal.execution_jobs(
    job_id,mission_id,device_id,operation,command,cwd,timeout_ms,policy,status,metadata
  ) values (
    v_job_id,v_mission_id,v_device_id,'shell.execute',v_command,'C:\Windows\Temp',60000,
    jsonb_build_object(
      'mission_wonder_2_a6_continuity',true,
      'allowed_artifact_path',v_artifact_path,
      'idempotent_artifact',true,
      'max_artifacts',1,
      'network_access',false,
      'external_mutations',false
    ),
    'queued',jsonb_build_object('idempotency_key',v_job_id)
  );

  -- A heartbeat older than 90s enters RECOVERING but remains recoverable until
  -- the same heartbeat stream returns within the configured 120s deadline.
  update aria_internal.device_registry
     set last_seen_at=clock_timestamp()-interval '95 seconds'
   where device_id=v_device_id;
  v_sample:=aria_internal.aria_m22_a6_sample_runtime_v1();
  if v_sample->>'status' is distinct from 'recovering'
     or not exists(select 1 from aria_internal.mission_wonder_2_a6_recovery_gates where run_id=v_run_id) then
    raise exception 'A6_TEST_95S_HEARTBEAT_DID_NOT_ENTER_RECOVERING';
  end if;
  if aria_internal.aria_m22_a6_frozen_job_authorized_v1(v_job_id,v_device_id,'queued') then
    raise exception 'A6_TEST_CLAIM_ALLOWED_DURING_RECOVERY_GATE';
  end if;
  if aria_internal.aria_m22_a6_claim_frozen_job_v1(v_device_id) is not null then
    raise exception 'A6_TEST_JOB_CLAIMED_DURING_RECOVERY_GATE';
  end if;

  update aria_internal.device_registry
     set last_seen_at=clock_timestamp()-interval '5 seconds'
   where device_id=v_device_id;
  v_sample:=aria_internal.aria_m22_a6_sample_runtime_v1();
  if v_sample->>'status' is distinct from 'sampled'
     or exists(select 1 from aria_internal.mission_wonder_2_a6_recovery_gates where run_id=v_run_id) then
    raise exception 'A6_TEST_HEARTBEAT_RECOVERY_WITHIN_120S_NOT_RECOGNIZED';
  end if;

  -- Negative case 1: wrong device cannot see or claim the frozen A6 job.
  if aria_internal.aria_m22_a6_has_claimable_job_v1(v_wrong_device_id) then
    raise exception 'A6_TEST_WRONG_DEVICE_SEES_CLAIMABLE_JOB';
  end if;
  if aria_internal.aria_m22_a6_claim_frozen_job_v1(v_wrong_device_id) is not null then
    raise exception 'A6_TEST_WRONG_DEVICE_CLAIMED_JOB';
  end if;

  -- Negative case 2: a mismatched Human Gate reference closes the claim path.
  update aria_internal.mission_state
     set metadata=metadata||jsonb_build_object(
       'mission_wonder_2_a6_human_gate_ref','a6-human-gate-1762869600.999'
     )
   where mission_id=v_mission_id;
  if aria_internal.aria_m22_a6_frozen_job_authorized_v1(v_job_id,v_device_id,'queued') then
    raise exception 'A6_TEST_MISMATCHED_HUMAN_GATE_AUTHORIZED';
  end if;
  if aria_internal.aria_m22_a6_has_claimable_job_v1(v_device_id) then
    raise exception 'A6_TEST_MISMATCHED_HUMAN_GATE_VISIBLE_TO_CLAIM';
  end if;

  -- Negative case 3: revoked scope cannot be claimed.
  update aria_internal.mission_state set metadata=v_metadata where mission_id=v_mission_id;
  update aria_internal.mission_wonder_2_a6_scopes set status='revoked' where scope_id=v_scope_id;
  if aria_internal.aria_m22_a6_has_claimable_job_v1(v_device_id) then
    raise exception 'A6_TEST_REVOKED_SCOPE_VISIBLE_TO_CLAIM';
  end if;
  update aria_internal.mission_wonder_2_a6_scopes set status='bound' where scope_id=v_scope_id;

  -- Positive case: exact allowlisted A6 job is authorized through the freeze.
  if not aria_internal.aria_m22_a6_frozen_job_authorized_v1(v_job_id,v_device_id,'queued') then
    raise exception 'A6_TEST_VALID_FROZEN_JOB_NOT_AUTHORIZED';
  end if;
  if not aria_internal.aria_m22_a6_has_claimable_job_v1(v_device_id) then
    raise exception 'A6_TEST_VALID_FROZEN_JOB_NOT_VISIBLE_TO_CLAIM';
  end if;

  v_claim := aria_internal.aria_m22_a6_claim_frozen_job_v1(v_device_id);
  if v_claim is null or v_claim->>'job_id' is distinct from v_job_id
     or v_claim->>'status' is distinct from 'claimed' then
    raise exception 'A6_TEST_FROZEN_CLAIM_DID_NOT_RETURN_EXACT_JOB';
  end if;

  if not aria_internal.aria_m22_a6_frozen_job_authorized_v1(v_job_id,v_device_id,'claimed') then
    raise exception 'A6_TEST_CLAIMED_JOB_NOT_AUTHORIZED_FOR_START';
  end if;
  if aria_internal.aria_m22_a6_frozen_job_authorized_v1(v_job_id,v_device_id,'queued') then
    raise exception 'A6_TEST_QUEUED_STATUS_REMAINS_AUTHORIZED_AFTER_CLAIM';
  end if;
  if aria_internal.aria_m22_a6_has_claimable_job_v1(v_device_id) then
    raise exception 'A6_TEST_CLAIMED_JOB_STILL_APPEARS_QUEUED';
  end if;
  if aria_internal.aria_m22_a6_claim_frozen_job_v1(v_device_id) is not null then
    raise exception 'A6_TEST_DUPLICATE_CLAIM_RETURNED_A_JOB';
  end if;

  select count(*) into v_count
    from aria_internal.execution_job_events
   where job_id=v_job_id and device_id=v_device_id
     and event_type='job.claimed_a6_continuity'
     and payload->>'global_execution_freeze_preserved'='true'
     and payload->>'attempt'='1'
     and payload->>'run_id'=v_run_id;
  if v_count<>1 then
    raise exception 'A6_TEST_CLAIM_EVENT_MISSING_OR_DUPLICATED';
  end if;

  select count(*) into v_count
    from aria_internal.execution_jobs
   where job_id=v_job_id and status='claimed'
     and claimed_at is not null and lease_owner is not null
     and lease_until>clock_timestamp()
     and lease_until<=clock_timestamp()+interval '2 minutes'
     and completed_at is null;
  if v_count<>1 then
    raise exception 'A6_TEST_CLAIM_LEASE_INVALID';
  end if;

  -- Simulate a worker that started and then lost its lease. Recovery must reuse
  -- the same job row, increment the attempt, issue a fresh lease, and fence the
  -- previous worker's late completion.
  v_old_lease_owner:=v_claim->>'lease_owner';
  update aria_internal.execution_jobs
     set status='running',started_at=clock_timestamp(),
         lease_until=clock_timestamp()-interval '1 second',
         updated_at=clock_timestamp()
   where job_id=v_job_id and status='claimed';

  -- The A6 minute dispatcher owns reconciliation while the global watchdog
  -- cron remains disabled. An expired RUNNING lease must be detected directly.
  v_reconcile:=aria_internal.aria_m22_a6_reconcile_v1();
  if coalesce((v_reconcile->>'recovered')::integer,0)<>1 then
    raise exception 'A6_TEST_RECONCILE_DID_NOT_RECOVER_EXPIRED_RUNNING_LEASE';
  end if;
  v_recovered:=true;
  if v_recovered is distinct from true then
    raise exception 'A6_TEST_SAME_JOB_RECOVERY_REJECTED';
  end if;
  if not exists(
    select 1 from aria_internal.execution_jobs
     where job_id=v_job_id and status='queued' and recovery_count=1
       and completed_at is null and lease_owner is null and lease_until is null
       and metadata->>'mission_wonder_2_a6_attempt'='2'
  ) then raise exception 'A6_TEST_SAME_JOB_NOT_REQUEUED_AS_ATTEMPT_2'; end if;
  if not exists(
    select 1 from aria_internal.mission_state
     where mission_id=v_mission_id
       and checkpoint->'pending_jobs'->v_step_id->>'attempt'='2'
       and checkpoint->'plan'->0->>'max_attempts'='2'
  ) then raise exception 'A6_TEST_CHECKPOINT_NOT_ADVANCED_TO_ATTEMPT_2'; end if;

  v_claim_2:=aria_internal.aria_m22_a6_claim_frozen_job_v1(v_device_id);
  if v_claim_2 is null or v_claim_2->>'job_id' is distinct from v_job_id
     or v_claim_2->>'status' is distinct from 'claimed'
     or coalesce(v_claim_2->>'lease_owner','')='' 
     or v_claim_2->>'lease_owner'=v_old_lease_owner then
    raise exception 'A6_TEST_SECOND_CLAIM_DID_NOT_FENCE_OLD_LEASE';
  end if;
  if not aria_internal.aria_m22_a6_frozen_job_authorized_v1(v_job_id,v_device_id,'claimed') then
    raise exception 'A6_TEST_ATTEMPT_2_NOT_AUTHORIZED';
  end if;

  -- Old gateway binaries may still use the 2-/7-argument RPC overloads during
  -- a rolling deploy. Both must reject A6 without a lease token, while remaining
  -- available for legacy non-A6 execution lanes.
  v_legacy_start:=public.start_execution_job_gateway(v_job_id,v_device_id);
  if v_legacy_start is not null then
    raise exception 'A6_TEST_LEGACY_START_RPC_BYPASSED_FENCE';
  end if;
  v_legacy_complete:=public.complete_execution_job_gateway(
    v_job_id,v_device_id,'succeeded',0,'A6_ARTIFACT_VERIFIED;mode=identical','',
    jsonb_build_object('status','succeeded','exit_code',0,'stdout','A6_ARTIFACT_VERIFIED;mode=identical')
  );
  if v_legacy_complete is not null then
    raise exception 'A6_TEST_LEGACY_COMPLETE_RPC_BYPASSED_FENCE';
  end if;
  select count(*) into v_count from aria_internal.execution_job_events
   where job_id=v_job_id and event_type='job.legacy_start_rpc_rejected';
  if v_count<>1 then raise exception 'A6_TEST_LEGACY_START_RPC_REJECTION_MISSING'; end if;
  select count(*) into v_count from aria_internal.execution_job_events
   where job_id=v_job_id and event_type='job.legacy_completion_rpc_rejected';
  if v_count<>1 then raise exception 'A6_TEST_LEGACY_COMPLETE_RPC_REJECTION_MISSING'; end if;

  v_stale_complete:=public.complete_execution_job_gateway(
    v_job_id,v_device_id,'succeeded',0,'A6_ARTIFACT_VERIFIED;mode=identical','',
    jsonb_build_object('status','succeeded','exit_code',0,'stdout','A6_ARTIFACT_VERIFIED;mode=identical',
      'metadata',jsonb_build_object('mission_wonder_2_a6_attempt',1,'lease_owner',v_old_lease_owner)),
    v_old_lease_owner
  );
  if v_stale_complete is not null then
    raise exception 'A6_TEST_STALE_ATTEMPT_COMPLETED_WITH_OLD_LEASE';
  end if;
  select count(*) into v_count
    from aria_internal.execution_job_events
   where job_id=v_job_id and event_type='job.stale_lease_result_rejected';
  if v_count<>1 then raise exception 'A6_TEST_STALE_LEASE_REJECTION_EVENT_MISSING'; end if;

  -- A recovered device must still be blocked when the observed heartbeat-to-heartbeat
  -- gap itself exceeds the 120s recovery ceiling, even if the latest heartbeat is fresh.
  update aria_internal.device_registry
     set last_seen_at=(
       select device_last_seen_at+interval '121 seconds'
         from aria_internal.mission_wonder_2_a6_telemetry
        where run_id=v_run_id and event_type='heartbeat_sample'
        order by sampled_at desc limit 1
     )
   where device_id=v_device_id;
  v_sample:=aria_internal.aria_m22_a6_sample_runtime_v1();
  if v_sample->>'status' is distinct from 'blocked'
     or v_sample->>'reason' is distinct from 'heartbeat_observed_gap_exceeded' then
    raise exception 'A6_TEST_OBSERVED_HEARTBEAT_GAP_OVER_120S_NOT_BLOCKED';
  end if;
  if not exists(
    select 1 from aria_internal.mission_wonder_2_a6_telemetry
     where run_id=v_run_id and event_type='fault_observed'
       and payload->>'event'='heartbeat_observed_gap_exceeded'
       and (payload->>'heartbeatObservedGapMs')::bigint>120000
  ) then
    raise exception 'A6_TEST_OBSERVED_HEARTBEAT_GAP_EVIDENCE_MISSING';
  end if;

  -- The A6 fixture does not alter ambient non-A6 work or any cron state.
  if aria_internal.aria_m22_a6_ambient_snapshot_v1() is distinct from v_baseline then
    raise exception 'A6_TEST_AMBIENT_STATE_CHANGED';
  end if;
  if exists (
    select 1 from cron.job
     where jobid in (48,49,50) and active
  ) then
    raise exception 'A6_TEST_LEGACY_CRON_WAS_ENABLED';
  end if;
  if exists (
    select 1 from cron.job
     where jobname='aria-mission-wonder-2-a6-dispatcher-every-minute' and active
  ) then
    raise exception 'A6_TEST_DEDICATED_CRON_WAS_ENABLED';
  end if;

  raise notice 'A6_FROZEN_CLAIM_POSTGRES=PASS';
  raise notice 'A6_HEARTBEAT_RECOVERY_GATE=PASS';
  raise notice 'A6_SAME_JOB_IDEMPOTENT_RECOVERY=PASS';
  raise notice 'A6_EXPIRED_RUNNING_LEASE_RECONCILED_WITHOUT_GLOBAL_WATCHDOG=PASS';
  raise notice 'A6_STALE_LEASE_FENCING=PASS';
  raise notice 'A6_LEGACY_RPC_FENCING=PASS';
  raise notice 'A6_FROZEN_CLAIM_NEGATIVE_CASES=PASS';
  raise notice 'A6_FROZEN_CLAIM_IDEMPOTENCY=PASS';
  raise notice 'A6_GLOBAL_FREEZE_PRESERVED=true';
end;
$a6_claim_test$;

-- Always discard the one-shot run, scope, mission, job, device, lease and event.
rollback;
