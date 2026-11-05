-- Mission Wonder 2 / Step 4 A4: controlled, idempotent recovery for ONE already-created
-- mission whose one-shot attempt stalled before the runner could complete it, and whose
-- scope was revoked by the E2E cleanup while the mission row itself is preserved as
-- evidence. Hardened per independent PR review:
--   * LOCKED to mission_id 'mission_a4_authorized_once' (any other id is rejected
--     before any row is read or written),
--   * every identity argument is strictly regex-validated before any SQL runs,
--   * the exact scope_key 'mission-wonder-2-step4-a4:single-authorized-execution' is
--     verified before any scope mutation,
--   * physical agent eligibility (authenticated, online, heartbeat < 180 s,
--     shell.execute capability, exact allowed device, exactly one candidate) is
--     enforced SERVER-SIDE before the scope is re-armed,
--   * the ONE runtime-tick dispatch is governed by a transactional, persisted,
--     idempotent reservation in the mission row (a4_recovery_dispatch_v1): the
--     recovery grants it at most once and a separate claim flips it to consumed
--     exactly once; a claimed/consumed reservation can never dispatch another tick.
-- The functions NEVER create missions, scopes, jobs or leases, never invoke the
-- runner, and never touch any other mission or scope row. This migration performs no
-- state change on production rows by itself; execution only ever happens behind the
-- explicit human authorization encoded in the human-gated workflow.
begin;

-- ---------------------------------------------------------------------------
-- Function 1: recovery = identity-verified re-arm + single reservation grant.
-- Returns jsonb with action in:
--   recovered | already_recovered | noop | rejected(anych reason)
-- ---------------------------------------------------------------------------
create or replace function aria_internal.aria_m22_a4_recover_mission_v1(
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
  v_rearmed integer := 0;
  v_stamped integer := 0;
  v_eligible_count integer := 0;
  v_dispatch jsonb;
  v_grant_rows integer := 0;
  v_reservation_pregenerated boolean := false;
  v_persist_verified boolean := false;
begin
  -- Hard lock: this recovery mechanism exists for exactly one mission id. Any other
  -- value is rejected before any database work happens.
  if coalesce(btrim(p_mission_id),'') <> 'mission_a4_authorized_once' then
    return jsonb_build_object('action','rejected','reason','mission_id_not_locked');
  end if;

  -- Strict argument validation before any SQL against business tables.
  if coalesce(btrim(p_grant_ref),'')='' or length(btrim(p_grant_ref)) > 120
     or btrim(p_grant_ref) !~ '^[A-Za-z0-9_.:\/-]{4,120}$' then
    return jsonb_build_object('action','rejected','reason','invalid_grant_ref');
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

  select * into v_mission from aria_internal.mission_state
   where mission_id=btrim(p_mission_id);
  if not found then
    return jsonb_build_object('action','rejected','reason','mission_not_found');
  end if;
  if v_mission.status in ('succeeded','failed','blocked','cancelled','timeout') then
    return jsonb_build_object('action','noop','reason','mission_terminal','mission_status',v_mission.status);
  end if;
  if v_mission.status <> 'queued' then
    return jsonb_build_object('action','rejected','reason','mission_status_not_queued','mission_status',v_mission.status);
  end if;

  -- Scope identity join pins mission, owner, request, goal hash AND the exact
  -- scope_key, so no other scope can ever be re-armed through this function.
  select * into v_scope from aria_internal.mission_wonder_2_a4_scopes
   where scope_id=btrim(p_scope_id)
     and mission_id=btrim(p_mission_id)
     and owner_user_id=btrim(p_user_id)
     and request_id=btrim(p_request_id)
     and goal_hash=btrim(p_goal_hash)
     and scope_key='mission-wonder-2-step4-a4:single-authorized-execution';
  if not found then
    return jsonb_build_object('action','rejected','reason','scope_identity_mismatch');
  end if;
  if v_scope.status='completed' then
    return jsonb_build_object('action','noop','reason','scope_completed');
  end if;
  if v_scope.status not in ('revoked','bound') then
    return jsonb_build_object('action','rejected','reason','scope_status_not_recoverable','scope_status',v_scope.status);
  end if;

  -- Mission metadata must carry the full A4 identity chain, including the exact
  -- authorized device of the scope row.
  if coalesce(v_mission.metadata->>'mission_wonder_2_a4_scope_id','')<>btrim(p_scope_id)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_goal_hash','')<>btrim(p_goal_hash)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_readonly','')<>'true'
     or coalesce(v_mission.metadata->>'request_id','')<>btrim(p_request_id)
     or coalesce(v_mission.metadata->>'user_id','')<>btrim(p_user_id)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_allowed_device_id','')<>v_scope.allowed_device_id then
    return jsonb_build_object('action','rejected','reason','mission_identity_mismatch');
  end if;

  -- SERVER-SIDE physical agent eligibility gate: the allowed device must be the ONE
  -- eligible candidate in the registry at this instant. Without it the scope is
  -- never re-armed.
  select count(*) into v_eligible_count
    from aria_internal.device_registry d
   where d.device_id = v_scope.allowed_device_id
     and d.agent_type = 'windows-local'
     and d.status = 'online'
     and d.token_hash is not null
     and d.capabilities @> '["shell.execute"]'::jsonb
     and d.last_seen_at > clock_timestamp() - interval '180 seconds'
     and not exists (
       select 1 from aria_internal.device_registry other
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

  -- Step 1: re-arm the revoked scope exactly once, with a bounded fresh window.
  if v_scope.status='revoked' then
    update aria_internal.mission_wonder_2_a4_scopes
       set status='bound',
           expires_at=clock_timestamp()+interval '45 minutes',
           bound_at=coalesce(bound_at,clock_timestamp()),
           updated_at=clock_timestamp()
     where scope_id=v_scope.scope_id
       and status='revoked';
    get diagnostics v_rearmed=row_count;
    if v_rearmed<>1 then
      return jsonb_build_object('action','rejected','reason','scope_rearm_race');
    end if;
  end if;

  -- Step 2: stamp the explicit admission lane onto the mission metadata, once.
  update aria_internal.mission_state
     set metadata=jsonb_set(metadata,'{execution_lane}',to_jsonb('user'::text),true),
         updated_at=clock_timestamp()
   where mission_id=v_mission.mission_id
     and coalesce(metadata->>'execution_lane','')<>'user';
  get diagnostics v_stamped=row_count;

  -- Step 3: grant the ONE dispatch reservation with ONE atomic update. The parent
  -- object is built EXPLICITLY (preserving any pre-existing content) and written as
  -- a single top-level jsonb_set; this never relies on jsonb_set creating nested
  -- intermediates, whose silent no-op on a missing parent would falsely report a
  -- grant. Persistence is then DEMONSTRATED by re-reading the metadata inside this
  -- same transaction; any inconsistency raises and the whole call rolls back,
  -- including the scope re-arm performed above.
  v_dispatch := coalesce(v_mission.metadata->'a4_recovery_dispatch_v1', '{}'::jsonb);
  if coalesce(v_dispatch->>'granted','false') = 'true' then
    -- A reservation already exists (granted, possibly consumed). Never overwrite it:
    -- a second recovery must not generate another grant_ref nor resurrect a token.
    v_reservation_pregenerated := true;
  else
    update aria_internal.mission_state
       set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',
             coalesce(metadata->'a4_recovery_dispatch_v1','{}'::jsonb) || jsonb_build_object(
               'granted', true,
               'granted_at', clock_timestamp()::text,
               'grant_ref', btrim(p_grant_ref)
             ), true),
           updated_at=clock_timestamp()
     where mission_id=v_mission.mission_id;
    get diagnostics v_grant_rows=row_count;
    if v_grant_rows<>1 then
      raise exception 'aria_m22_a4_dispatch_grant_not_applied';
    end if;
    -- Re-read the persisted metadata inside this transaction before trusting it.
    select metadata->'a4_recovery_dispatch_v1' into v_dispatch
      from aria_internal.mission_state
     where mission_id=v_mission.mission_id;
    if coalesce(v_dispatch->>'granted','false')<>'true'
       or coalesce(v_dispatch->>'grant_ref','')<>btrim(p_grant_ref)
       or coalesce(v_dispatch->>'granted_at','')='' then
      raise exception
        'aria_m22_a4_dispatch_persist_failed (whole call rolled back, including the scope re-arm)';
    end if;
    v_persist_verified := true;
  end if;

  -- Single audit event whenever this recovery mutated a row.
  if v_rearmed=1 or v_stamped=1 then
    insert into aria_internal.mission_events(mission_id, event_type, payload)
    values (
      v_mission.mission_id,
      'mission_resumed',
      jsonb_build_object(
        'reason', case when v_rearmed=1 then 'mission_wonder_2_a4_recovery_rearm_v1'
                       else 'mission_wonder_2_a4_recovery_lane_stamp_v1' end,
        'operator','explicit_human_authorized_recovery',
        'scope_id_prefix', left(v_scope.scope_id,12),
        'readonly_marker', true,
        'execution_lane','user',
        'scope_rearmed', (v_rearmed=1),
        'lane_stamped', (v_stamped=1),
        'agent_eligible_count', v_eligible_count,
        'note','Single identity-verified recovery of the stalled A4 attempt; no new mission, scope, job or lease was created.'
      )
    );
  end if;

  return jsonb_build_object(
    'action','recovered',
    'mission_id',v_mission.mission_id,
    'scope_id_prefix',left(v_scope.scope_id,12),
    'scope_status', case when v_rearmed=1 then 'bound' else v_scope.status end,
    'execution_lane','user',
    'scope_rearmed',(v_rearmed=1),
    'lane_stamped',(v_stamped=1),
    'dispatch_reservation_granted', v_persist_verified,
    'dispatch_reservation_preexisting', v_reservation_pregenerated,
    'dispatch_reservation_persisted', coalesce(v_dispatch->>'granted','false')='true',
    'dispatch_grant_ref', coalesce(v_dispatch->>'grant_ref',''),
    'agent_eligible_count', v_eligible_count
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Function 2: the ONLY dispatch gate. One row-level token, flipped consumed
-- exactly once. Only 'token_claimed' may ever precede a runtime tick; every
-- other outcome must abort without dispatching. Also enforces server-side
-- agent eligibility again, directly before the claim, so an agent that went
-- offline between grant and claim cannot get the token.
-- ---------------------------------------------------------------------------
create or replace function aria_internal.aria_m22_a4_claim_recovery_dispatch_token_v1(
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
  v_claimed integer := 0;
  v_eligible_count integer := 0;
  v_dispatch jsonb;
  v_check_status text;
begin
  if coalesce(btrim(p_mission_id),'') <> 'mission_a4_authorized_once' then
    return jsonb_build_object('action','rejected','reason','mission_id_not_locked');
  end if;
  if coalesce(btrim(p_scope_id),'')='' or btrim(p_scope_id) !~ '^[A-Za-z0-9_-]{8,120}$' then
    return jsonb_build_object('action','rejected','reason','invalid_scope_id');
  end if;
  if coalesce(btrim(p_grant_ref),'')='' or length(btrim(p_grant_ref)) > 120
     or btrim(p_grant_ref) !~ '^[A-Za-z0-9_.:\/-]{4,120}$' then
    return jsonb_build_object('action','rejected','reason','invalid_grant_ref');
  end if;

  select * into v_mission from aria_internal.mission_state
   where mission_id=btrim(p_mission_id);
  if not found then
    return jsonb_build_object('action','rejected','reason','mission_not_found');
  end if;
  if v_mission.status <> 'queued' then
    return jsonb_build_object('action','rejected','reason','mission_status_not_queued','mission_status',v_mission.status);
  end if;

  select * into v_scope from aria_internal.mission_wonder_2_a4_scopes
   where scope_id=btrim(p_scope_id)
     and mission_id=btrim(p_mission_id)
     and scope_key='mission-wonder-2-step4-a4:single-authorized-execution';
  if not found then
    return jsonb_build_object('action','rejected','reason','scope_identity_mismatch');
  end if;
  if v_scope.status <> 'bound' or v_scope.expires_at <= clock_timestamp() then
    return jsonb_build_object('action','rejected','reason','scope_not_bound_fresh','scope_status',v_scope.status);
  end if;

  -- Reservation must exist and not be consumed yet; grant_ref must match exactly.
  if coalesce(v_mission.metadata->'a4_recovery_dispatch_v1'->>'granted','false')<>'true' then
    return jsonb_build_object('action','rejected','reason','dispatch_not_granted');
  end if;
  if v_mission.metadata->'a4_recovery_dispatch_v1'->>'consumed'='true' then
    return jsonb_build_object('action','rejected','reason','dispatch_already_consumed');
  end if;
  if coalesce(v_mission.metadata->'a4_recovery_dispatch_v1'->>'grant_ref','')
     <> btrim(p_grant_ref) then
    return jsonb_build_object('action','rejected','reason','dispatch_grant_ref_mismatch');
  end if;

  -- Server-side physical eligibility re-check directly before handing the token.
  select count(*) into v_eligible_count
    from aria_internal.device_registry d
   where d.device_id = v_scope.allowed_device_id
     and d.agent_type = 'windows-local'
     and d.status = 'online'
     and d.token_hash is not null
     and d.capabilities @> '["shell.execute"]'::jsonb
     and d.last_seen_at > clock_timestamp() - interval '180 seconds'
     and not exists (
       select 1 from aria_internal.device_registry other
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

  -- Atomic single-token flip: mark the reservation consumed FIRST, then the caller
  -- may dispatch exactly one tick. The parent object is also rebuilt explicitly
  -- (preserving granted fields) and the persistence is re-read inside this
  -- transaction; inconsistency raises and the call rolls back leaving the token
  -- UNCONSUMED (a retry remains possible; a double tick remains impossible since
  -- no script dispatches without the claimed server state). A concurrent second
  -- caller loses the row-count race and is rejected. If the caller crashes after
  -- this commit before dispatching, the tick is simply lost (fail-safe: no double
  -- tick) and the recovery stalls for a human decision, which is the safe direction.
  update aria_internal.mission_state
     set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',
           coalesce(metadata->'a4_recovery_dispatch_v1','{}'::jsonb) || jsonb_build_object(
             'consumed', true,
             'consumed_at', clock_timestamp()::text
           ), true),
         updated_at=clock_timestamp()
   where mission_id=v_mission.mission_id
     and coalesce(metadata->'a4_recovery_dispatch_v1'->>'consumed','false') <> 'true';
  get diagnostics v_claimed=row_count;
  if v_claimed<>1 then
    return jsonb_build_object('action','rejected','reason','dispatch_already_consumed');
  end if;
  -- Re-read the persisted reservation before handing over the token.
  select metadata->'a4_recovery_dispatch_v1', status into v_dispatch, v_check_status
    from aria_internal.mission_state where mission_id=v_mission.mission_id;
  if coalesce(v_dispatch->>'consumed','false')<>'true'
     or coalesce(v_dispatch->>'consumed_at','')=''
     or coalesce(v_dispatch->>'granted','false')<>'true'
     or coalesce(v_dispatch->>'grant_ref','')<>btrim(p_grant_ref)
     or v_check_status<>'queued' then
    raise exception
      'aria_m22_a4_claim_persist_failed (whole call rolled back; token remains unclaimed)';
  end if;

  return jsonb_build_object(
    'action','token_claimed',
    'mission_id',v_mission.mission_id,
    'grant_ref',btrim(p_grant_ref),
    'dispatch_persisted', coalesce(v_dispatch->>'consumed','false')='true',
    'agent_eligible_count',v_eligible_count
  );
end;
$function$;

revoke all on function aria_internal.aria_m22_a4_recover_mission_v1(text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a4_claim_recovery_dispatch_token_v1(text,text,text) from public,anon,authenticated;
grant execute on function aria_internal.aria_m22_a4_recover_mission_v1(text,text,text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a4_claim_recovery_dispatch_token_v1(text,text,text) to service_role;

commit;
