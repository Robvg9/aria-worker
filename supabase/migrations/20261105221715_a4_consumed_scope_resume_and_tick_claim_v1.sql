-- Mission Wonder 2 / Step 4 A4: safe continuation after the one-shot dispatch
-- was consumed but the workflow stopped before its runtime tick.
-- This migration does NOT create missions, scopes, jobs or leases.
-- It preserves the exact existing grant_ref and permits exactly one scope-window
-- renewal plus exactly one atomic tick claim. A second tick claim is always refused.

begin;

create or replace function aria_internal.aria_m22_a4_resume_consumed_scope_v1(
  p_mission_id text,
  p_scope_id text,
  p_user_id text,
  p_request_id text,
  p_goal_hash text,
  p_grant_ref text
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
  v_new_expiry timestamptz;
  v_verify jsonb;
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

  select * into v_mission
    from aria_internal.mission_state
   where mission_id=btrim(p_mission_id)
   for update;
  if not found then
    return jsonb_build_object('action','rejected','reason','mission_not_found');
  end if;
  if v_mission.status <> 'queued' then
    return jsonb_build_object('action','rejected','reason','mission_status_not_queued','mission_status',v_mission.status);
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
  if v_scope.status <> 'bound' then
    return jsonb_build_object('action','rejected','reason','scope_not_bound','scope_status',v_scope.status);
  end if;

  if coalesce(v_mission.metadata->>'mission_wonder_2_a4_scope_id','')<>btrim(p_scope_id)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_goal_hash','')<>btrim(p_goal_hash)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_readonly','')<>'true'
     or coalesce(v_mission.metadata->>'request_id','')<>btrim(p_request_id)
     or coalesce(v_mission.metadata->>'user_id','')<>btrim(p_user_id)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_allowed_device_id','')<>v_scope.allowed_device_id then
    return jsonb_build_object('action','rejected','reason','mission_identity_mismatch');
  end if;

  v_dispatch := coalesce(v_mission.metadata->'a4_recovery_dispatch_v1','{}'::jsonb);
  if coalesce(v_dispatch->>'granted','false')<>'true'
     or coalesce(v_dispatch->>'consumed','false')<>'true'
     or coalesce(v_dispatch->>'grant_ref','')<>btrim(p_grant_ref) then
    return jsonb_build_object('action','rejected','reason','consumed_reservation_mismatch');
  end if;
  if coalesce(v_dispatch->>'tick_claimed','false')='true' then
    return jsonb_build_object('action','rejected','reason','tick_already_claimed');
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

  if v_scope.expires_at > clock_timestamp() then
    return jsonb_build_object(
      'action','already_fresh',
      'mission_id',v_mission.mission_id,
      'scope_id',v_scope.scope_id,
      'expires_at',v_scope.expires_at,
      'dispatch_grant_ref',btrim(p_grant_ref),
      'dispatch_token_reused',true,
      'agent_eligible_count',v_eligible_count
    );
  end if;

  if coalesce(v_dispatch->>'scope_resume_count','0') <> '0' then
    return jsonb_build_object('action','rejected','reason','scope_resume_already_used');
  end if;

  update aria_internal.mission_wonder_2_a4_scopes
     set expires_at=clock_timestamp()+interval '45 minutes',
         updated_at=clock_timestamp()
   where scope_id=v_scope.scope_id
     and mission_id=v_mission.mission_id
     and status='bound'
     and expires_at <= clock_timestamp();
  get diagnostics v_updated=row_count;
  if v_updated <> 1 then
    return jsonb_build_object('action','rejected','reason','scope_resume_race');
  end if;

  update aria_internal.mission_state
     set metadata=jsonb_set(
           metadata,
           '{a4_recovery_dispatch_v1}',
           coalesce(metadata->'a4_recovery_dispatch_v1','{}'::jsonb)
             || jsonb_build_object(
               'scope_resume_count',1,
               'scope_resumed_at',clock_timestamp()::text,
               'scope_resume_grant_ref',btrim(p_grant_ref)
             ),
           true
         ),
         updated_at=clock_timestamp()
   where mission_id=v_mission.mission_id
     and metadata->'a4_recovery_dispatch_v1'->>'granted'='true'
     and metadata->'a4_recovery_dispatch_v1'->>'consumed'='true'
     and metadata->'a4_recovery_dispatch_v1'->>'grant_ref'=btrim(p_grant_ref)
     and coalesce(metadata->'a4_recovery_dispatch_v1'->>'scope_resume_count','0')='0';
  get diagnostics v_updated=row_count;
  if v_updated <> 1 then
    raise exception 'aria_m22_a4_scope_resume_marker_not_persisted (transaction rolled back)';
  end if;

  select metadata->'a4_recovery_dispatch_v1' into v_verify
    from aria_internal.mission_state
   where mission_id=v_mission.mission_id;
  if coalesce(v_verify->>'scope_resume_count','0')<>'1'
     or coalesce(v_verify->>'scope_resume_grant_ref','')<>btrim(p_grant_ref)
     or coalesce(v_verify->>'consumed','false')<>'true'
     or coalesce(v_verify->>'grant_ref','')<>btrim(p_grant_ref) then
    raise exception 'aria_m22_a4_scope_resume_persistence_failed (transaction rolled back)';
  end if;

  select expires_at into v_new_expiry
    from aria_internal.mission_wonder_2_a4_scopes
   where scope_id=v_scope.scope_id;

  insert into aria_internal.mission_events(mission_id,event_type,payload)
  values (
    v_mission.mission_id,
    'mission_resumed',
    jsonb_build_object(
      'reason','mission_wonder_2_a4_consumed_scope_resume_v1',
      'operator','explicit_human_authorized_recovery',
      'scope_id_prefix',left(v_scope.scope_id,12),
      'readonly_marker',true,
      'existing_grant_ref_preserved',true,
      'dispatch_token_reused',true,
      'single_scope_resume',true,
      'agent_eligible_count',v_eligible_count
    )
  );

  return jsonb_build_object(
    'action','scope_resumed',
    'mission_id',v_mission.mission_id,
    'scope_id',v_scope.scope_id,
    'scope_status','bound',
    'expires_at',v_new_expiry,
    'dispatch_grant_ref',btrim(p_grant_ref),
    'scope_resume_count',1,
    'dispatch_token_reused',true,
    'agent_eligible_count',v_eligible_count
  );
end;
$function$;

create or replace function aria_internal.aria_m22_a4_claim_recovery_tick_v1(
  p_mission_id text,
  p_scope_id text,
  p_grant_ref text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare
  v_mission aria_internal.mission_state;
  v_scope aria_internal.mission_wonder_2_a4_scopes;
  v_eligible_count integer := 0;
  v_jobs integer := 0;
  v_updated integer := 0;
  v_dispatch jsonb;
  v_tick_ref text;
begin
  if coalesce(btrim(p_mission_id),'') <> 'mission_a4_authorized_once' then
    return jsonb_build_object('action','rejected','reason','mission_id_not_locked');
  end if;
  if coalesce(btrim(p_scope_id),'')='' or btrim(p_scope_id) !~ '^[A-Za-z0-9_-]{8,120}$' then
    return jsonb_build_object('action','rejected','reason','invalid_scope_id');
  end if;
  if coalesce(btrim(p_grant_ref),'')='' or length(btrim(p_grant_ref)) > 120
     or btrim(p_grant_ref) !~ '^[A-Za-z0-9_.:\\/-]{4,120}$' then
    return jsonb_build_object('action','rejected','reason','invalid_grant_ref');
  end if;

  select * into v_mission
    from aria_internal.mission_state
   where mission_id=btrim(p_mission_id)
   for update;
  if not found then
    return jsonb_build_object('action','rejected','reason','mission_not_found');
  end if;
  if v_mission.status <> 'queued' then
    return jsonb_build_object('action','rejected','reason','mission_status_not_queued','mission_status',v_mission.status);
  end if;

  select * into v_scope
    from aria_internal.mission_wonder_2_a4_scopes
   where scope_id=btrim(p_scope_id)
     and mission_id=btrim(p_mission_id)
     and scope_key='mission-wonder-2-step4-a4:single-authorized-execution'
   for update;
  if not found or v_scope.status <> 'bound' or v_scope.expires_at <= clock_timestamp() then
    return jsonb_build_object('action','rejected','reason','scope_not_bound_fresh');
  end if;

  v_dispatch := coalesce(v_mission.metadata->'a4_recovery_dispatch_v1','{}'::jsonb);
  if coalesce(v_dispatch->>'granted','false')<>'true'
     or coalesce(v_dispatch->>'consumed','false')<>'true'
     or coalesce(v_dispatch->>'grant_ref','')<>btrim(p_grant_ref) then
    return jsonb_build_object('action','rejected','reason','consumed_reservation_mismatch');
  end if;
  if coalesce(v_dispatch->>'scope_resume_count','0')<>'1'
     or coalesce(v_dispatch->>'scope_resume_grant_ref','')<>btrim(p_grant_ref) then
    return jsonb_build_object('action','rejected','reason','scope_resume_not_recorded');
  end if;
  if coalesce(v_dispatch->>'tick_claimed','false')='true' then
    return jsonb_build_object('action','rejected','reason','tick_already_claimed');
  end if;

  if coalesce(v_mission.metadata->>'mission_wonder_2_a4_scope_id','')<>btrim(p_scope_id)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_goal_hash','')<>v_scope.goal_hash
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_readonly','')<>'true'
     or coalesce(v_mission.metadata->>'request_id','')<>v_scope.request_id
     or coalesce(v_mission.metadata->>'user_id','')<>v_scope.owner_user_id
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_allowed_device_id','')<>v_scope.allowed_device_id then
    return jsonb_build_object('action','rejected','reason','mission_identity_mismatch');
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

  v_tick_ref := btrim(p_grant_ref) || ':tick';
  update aria_internal.mission_state
     set metadata=jsonb_set(
           metadata,
           '{a4_recovery_dispatch_v1}',
           coalesce(metadata->'a4_recovery_dispatch_v1','{}'::jsonb)
             || jsonb_build_object(
               'tick_claimed',true,
               'tick_claimed_at',clock_timestamp()::text,
               'tick_claim_ref',v_tick_ref
             ),
           true
         ),
         updated_at=clock_timestamp()
   where mission_id=v_mission.mission_id
     and metadata->'a4_recovery_dispatch_v1'->>'granted'='true'
     and metadata->'a4_recovery_dispatch_v1'->>'consumed'='true'
     and metadata->'a4_recovery_dispatch_v1'->>'grant_ref'=btrim(p_grant_ref)
     and coalesce(metadata->'a4_recovery_dispatch_v1'->>'scope_resume_count','0')='1'
     and coalesce(metadata->'a4_recovery_dispatch_v1'->>'tick_claimed','false')<>'true';
  get diagnostics v_updated=row_count;
  if v_updated <> 1 then
    return jsonb_build_object('action','rejected','reason','tick_already_claimed_or_raced');
  end if;

  select metadata->'a4_recovery_dispatch_v1' into v_dispatch
    from aria_internal.mission_state
   where mission_id=v_mission.mission_id;
  if coalesce(v_dispatch->>'tick_claimed','false')<>'true'
     or coalesce(v_dispatch->>'tick_claim_ref','')<>v_tick_ref
     or coalesce(v_dispatch->>'grant_ref','')<>btrim(p_grant_ref)
     or coalesce(v_dispatch->>'consumed','false')<>'true' then
    raise exception 'aria_m22_a4_tick_claim_persistence_failed (transaction rolled back)';
  end if;

  return jsonb_build_object(
    'action','tick_claimed',
    'mission_id',v_mission.mission_id,
    'tick_claim_ref',v_tick_ref,
    'dispatch_grant_ref',btrim(p_grant_ref),
    'dispatch_persisted',true,
    'agent_eligible_count',v_eligible_count
  );
end;
$function$;

revoke all on function aria_internal.aria_m22_a4_resume_consumed_scope_v1(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a4_claim_recovery_tick_v1(text,text,text) from public,anon,authenticated;
grant execute on function aria_internal.aria_m22_a4_resume_consumed_scope_v1(text,text,text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a4_claim_recovery_tick_v1(text,text,text) to service_role;

commit;
