-- Mission Wonder 2 / Step 4 A4: one bounded scope-window renewal for the
-- already-authorized, already-claimed tick after the observed downstream 401.
-- This replaces the first handoff-retry RPC with the same identity and replay
-- fences, adding at most one 45-minute continuation when the existing bound
-- scope expired less than two hours ago. The original grant and tick claim are
-- reused; no new tick, mission, scope, dispatch grant, job or lease is created.

begin;

create or replace function aria_internal.aria_m22_a4_claim_runner_handoff_retry_v1(
  p_mission_id text,
  p_scope_id text,
  p_user_id text,
  p_request_id text,
  p_goal_hash text,
  p_grant_ref text,
  p_failed_run_id text,
  p_runner_http_status integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare
  v_mission aria_internal.mission_state;
  v_scope aria_internal.mission_wonder_2_a4_scopes;
  v_dispatch jsonb;
  v_eligible_count integer := 0;
  v_jobs integer := 0;
  v_updated integer := 0;
  v_retry_ref text;
  v_scope_renewed boolean := false;
  v_old_scope_expiry timestamptz;
  v_new_scope_expiry timestamptz;
begin
  if coalesce(btrim(p_mission_id),'') <> 'mission_a4_authorized_once' then
    return jsonb_build_object('action','rejected','reason','mission_id_not_locked');
  end if;
  if coalesce(btrim(p_scope_id),'')='' or btrim(p_scope_id) !~ '^[A-Za-z0-9_-]{8,120}$' then
    return jsonb_build_object('action','rejected','reason','invalid_scope_id');
  end if;
  if coalesce(btrim(p_user_id),'')='' or btrim(p_user_id) !~ '^[a-f0-9-]{10,80}$' then
    return jsonb_build_object('action','rejected','reason','invalid_user_id');
  end if;
  if coalesce(btrim(p_request_id),'')='' or btrim(p_request_id) !~ '^[a-f0-9-]{10,80}$' then
    return jsonb_build_object('action','rejected','reason','invalid_request_id');
  end if;
  if coalesce(btrim(p_goal_hash),'')='' or btrim(p_goal_hash) !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('action','rejected','reason','invalid_goal_hash');
  end if;
  if coalesce(btrim(p_grant_ref),'')='' or length(btrim(p_grant_ref)) > 120
     or btrim(p_grant_ref) !~ '^[A-Za-z0-9_.:\\/-]{4,120}$' then
    return jsonb_build_object('action','rejected','reason','invalid_grant_ref');
  end if;

  -- Pin this exceptional continuation to the observed failed handoff only.
  if coalesce(btrim(p_failed_run_id),'') <> '42131077740' or p_runner_http_status IS DISTINCT FROM 401 then
    return jsonb_build_object('action','rejected','reason','failed_handoff_evidence_mismatch');
  end if;

  select * into v_mission
    from aria_internal.mission_state
   where mission_id=btrim(p_mission_id)
   for update;
  if not found then
    return jsonb_build_object('action','rejected','reason','mission_not_found');
  end if;
  if v_mission.status <> 'queued' or v_mission.current_step <> 0 or v_mission.completed_steps <> 0 then
    return jsonb_build_object('action','rejected','reason','mission_state_not_pristine','mission_status',v_mission.status);
  end if;
  if coalesce(v_mission.metadata->>'execution_lane','') <> 'user'
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_readonly','') <> 'true'
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_scope_id','') <> btrim(p_scope_id)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_goal_hash','') <> btrim(p_goal_hash)
     or coalesce(v_mission.metadata->>'request_id','') <> btrim(p_request_id)
     or coalesce(v_mission.metadata->>'user_id','') <> btrim(p_user_id)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_allowed_device_id','') = '' then
    return jsonb_build_object('action','rejected','reason','mission_identity_mismatch');
  end if;

  select * into v_scope
    from aria_internal.mission_wonder_2_a4_scopes
   where scope_id=btrim(p_scope_id)
     and mission_id=btrim(p_mission_id)
     and owner_user_id=btrim(p_user_id)
     and request_id=btrim(p_request_id)
     and goal_hash=btrim(p_goal_hash)
     and scope_key='mission-wonder-2-step4-a4:single-authorized-execution'
   for update;
  if not found then
    return jsonb_build_object('action','rejected','reason','scope_identity_mismatch');
  end if;
  if coalesce(v_mission.metadata->>'mission_wonder_2_a4_allowed_device_id','') <> v_scope.allowed_device_id then
    return jsonb_build_object('action','rejected','reason','mission_identity_mismatch');
  end if;
  if v_scope.status <> 'bound' then
    return jsonb_build_object('action','rejected','reason','scope_not_bound','scope_status',v_scope.status);
  end if;

  v_dispatch := coalesce(v_mission.metadata->'a4_recovery_dispatch_v1','{}'::jsonb);
  if coalesce(v_dispatch->>'granted','false') <> 'true'
     or coalesce(v_dispatch->>'consumed','false') <> 'true'
     or coalesce(v_dispatch->>'grant_ref','') <> btrim(p_grant_ref)
     or coalesce(v_dispatch->>'tick_claimed','false') <> 'true'
     or coalesce(v_dispatch->>'tick_claim_ref','') <> btrim(p_grant_ref) || ':tick'
     or coalesce(v_dispatch->>'scope_resume_count','0') <> '1'
     or coalesce(v_dispatch->>'scope_resume_grant_ref','') <> btrim(p_grant_ref) then
    return jsonb_build_object('action','rejected','reason','original_tick_claim_mismatch');
  end if;

  if coalesce(v_dispatch->>'runner_handoff_retry_count','0') <> '0' then
    return jsonb_build_object('action','rejected','reason','runner_handoff_retry_already_used');
  end if;
  if coalesce(v_dispatch->>'runner_handoff_scope_resume_count','0') <> '0' then
    return jsonb_build_object('action','rejected','reason','runner_handoff_scope_resume_already_used');
  end if;

  if v_mission.lease_owner is not null and v_mission.lease_until > clock_timestamp() then
    return jsonb_build_object('action','rejected','reason','mission_lease_already_active');
  end if;

  select count(*) into v_jobs
    from aria_internal.execution_jobs
   where mission_id=v_mission.mission_id;
  if v_jobs <> 0 then
    return jsonb_build_object('action','rejected','reason','execution_job_already_exists','job_count',v_jobs);
  end if;

  select count(*) into v_eligible_count
    from aria_internal.device_registry d
   where d.device_id=v_scope.allowed_device_id
     and d.agent_type='windows-local'
     and d.status='online'
     and d.token_hash is not null
     and d.capabilities @> '["shell.execute"]'::jsonb
     and d.last_seen_at > clock_timestamp() - interval '180 seconds'
     and not exists (
       select 1
         from aria_internal.device_registry other
        where other.device_id <> d.device_id
          and other.agent_type='windows-local'
          and other.status='online'
          and other.token_hash is not null
          and other.capabilities @> '["shell.execute"]'::jsonb
          and other.last_seen_at > clock_timestamp() - interval '180 seconds'
     );
  if v_eligible_count <> 1 then
    return jsonb_build_object('action','rejected','reason','agent_not_eligible','eligible_count',v_eligible_count);
  end if;

  v_old_scope_expiry := v_scope.expires_at;
  if v_scope.expires_at <= clock_timestamp() then
    if v_scope.expires_at <= clock_timestamp() - interval '2 hours' then
      return jsonb_build_object('action','rejected','reason','scope_expired_outside_continuation_window');
    end if;

    update aria_internal.mission_wonder_2_a4_scopes
       set expires_at=clock_timestamp()+interval '45 minutes',
           updated_at=clock_timestamp()
     where scope_id=v_scope.scope_id
       and mission_id=v_mission.mission_id
       and status='bound'
       and expires_at=v_old_scope_expiry
       and expires_at<=clock_timestamp();
    get diagnostics v_updated=row_count;
    if v_updated <> 1 then
      raise exception 'aria_m22_a4_handoff_scope_resume_race (transaction rolled back)';
    end if;
    v_scope_renewed := true;
    select expires_at into v_new_scope_expiry
      from aria_internal.mission_wonder_2_a4_scopes
     where scope_id=v_scope.scope_id;
  else
    v_new_scope_expiry := v_scope.expires_at;
  end if;

  v_retry_ref := btrim(p_grant_ref) || ':runner-handoff-retry';
  v_dispatch := v_dispatch || jsonb_build_object(
    'runner_handoff_retry_count',1,
    'runner_handoff_retry_ref',v_retry_ref,
    'runner_handoff_retry_at',clock_timestamp()::text,
    'runner_handoff_retry_source_run',btrim(p_failed_run_id),
    'runner_handoff_retry_source_status',p_runner_http_status
  );
  if v_scope_renewed then
    v_dispatch := v_dispatch || jsonb_build_object(
      'runner_handoff_scope_resume_count',1,
      'runner_handoff_scope_resumed_at',clock_timestamp()::text,
      'runner_handoff_scope_resume_source_run',btrim(p_failed_run_id),
      'runner_handoff_scope_previous_expires_at',v_old_scope_expiry::text
    );
  end if;

  update aria_internal.mission_state
     set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',v_dispatch,true),
         updated_at=clock_timestamp()
   where mission_id=v_mission.mission_id
     and coalesce(metadata->'a4_recovery_dispatch_v1'->>'runner_handoff_retry_count','0')='0'
     and metadata->'a4_recovery_dispatch_v1'->>'tick_claimed'='true'
     and metadata->'a4_recovery_dispatch_v1'->>'tick_claim_ref'=btrim(p_grant_ref) || ':tick';
  get diagnostics v_updated=row_count;
  if v_updated <> 1 then
    raise exception 'aria_m22_a4_runner_handoff_retry_race (transaction rolled back)';
  end if;

  insert into aria_internal.mission_events(mission_id,event_type,payload)
  values (
    v_mission.mission_id,
    'mission_resumed',
    jsonb_build_object(
      'reason','mission_wonder_2_a4_runner_handoff_retry_v1',
      'operator','explicit_human_authorized_recovery',
      'source_run_id',btrim(p_failed_run_id),
      'source_runner_http_status',p_runner_http_status,
      'existing_tick_claim_reused',true,
      'new_tick_claim_created',false,
      'new_dispatch_token_created',false,
      'scope_window_renewed',v_scope_renewed,
      'scope_id_prefix',left(v_scope.scope_id,12),
      'scope_expires_at',v_new_scope_expiry,
      'agent_eligible_count',v_eligible_count
    )
  );

  return jsonb_build_object(
    'action','runner_handoff_retry_claimed',
    'mission_id',v_mission.mission_id,
    'scope_id',v_scope.scope_id,
    'handoff_retry_ref',v_retry_ref,
    'existing_tick_claim_reused',true,
    'new_tick_claim_created',false,
    'scope_window_renewed',v_scope_renewed,
    'scope_expires_at',v_new_scope_expiry,
    'agent_eligible_count',v_eligible_count
  );
end;
$function$;

revoke all on function aria_internal.aria_m22_a4_claim_runner_handoff_retry_v1(text,text,text,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function aria_internal.aria_m22_a4_claim_runner_handoff_retry_v1(text,text,text,text,text,text,text,integer) to service_role;

commit;
