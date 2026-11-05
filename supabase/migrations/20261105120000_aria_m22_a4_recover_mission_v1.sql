-- Mission Wonder 2 / Step 4 A4: controlled, idempotent recovery for ONE already-created
-- mission whose one-shot attempt stalled before the runner could complete it, and whose
-- scope was revoked by the E2E cleanup while the mission row itself is preserved as
-- evidence. This function only ever:
--   * restores the ONE named scope row from 'revoked' back to 'bound' with a bounded
--     fresh expiry so the canonical runtime can process the SAME mission_id again,
--   * stamps the explicit execution_lane provenance expected beside the A4 identity
--     metadata,
--   * appends exactly one audit event when this recovery performs any mutation.
-- It NEVER creates missions, scopes, jobs or leases, never invokes the runner, never
-- claims anything by itself, and never touches any other mission or scope row.
-- Designed for execution only behind a future explicit human authorization; creating
-- this function performs no state change on production rows.
begin;

create or replace function aria_internal.aria_m22_a4_recover_mission_v1(
  p_mission_id text,
  p_scope_id text,
  p_user_id text,
  p_request_id text,
  p_goal_hash text
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
begin
  -- Fail closed: every identity field must match the persisted rows exactly before
  -- any mutation. Rejections perform no writes.
  if coalesce(btrim(p_mission_id),'')='' or coalesce(btrim(p_scope_id),'')=''
     or coalesce(btrim(p_user_id),'')='' or coalesce(btrim(p_request_id),'')=''
     or coalesce(btrim(p_goal_hash),'')='' or btrim(p_goal_hash) !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('action','rejected','reason','invalid_arguments');
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

  select * into v_scope from aria_internal.mission_wonder_2_a4_scopes
   where scope_id=btrim(p_scope_id)
     and mission_id=btrim(p_mission_id)
     and owner_user_id=btrim(p_user_id)
     and request_id=btrim(p_request_id)
     and goal_hash=btrim(p_goal_hash);
  if not found then
    return jsonb_build_object('action','rejected','reason','scope_identity_mismatch');
  end if;
  if v_scope.status='completed' then
    return jsonb_build_object('action','noop','reason','scope_completed');
  end if;
  if v_scope.status not in ('revoked','bound') then
    return jsonb_build_object('action','rejected','reason','scope_status_not_recoverable','scope_status',v_scope.status);
  end if;

  -- The mission metadata must carry the full A4 identity chain, including the exact
  -- authorized device of the scope row.
  if coalesce(v_mission.metadata->>'mission_wonder_2_a4_scope_id','')<>btrim(p_scope_id)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_goal_hash','')<>btrim(p_goal_hash)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_readonly','')<>'true'
     or coalesce(v_mission.metadata->>'request_id','')<>btrim(p_request_id)
     or coalesce(v_mission.metadata->>'user_id','')<>btrim(p_user_id)
     or coalesce(v_mission.metadata->>'mission_wonder_2_a4_allowed_device_id','')<>v_scope.allowed_device_id then
    return jsonb_build_object('action','rejected','reason','mission_identity_mismatch');
  end if;

  -- Idempotent fast path: nothing left to do.
  if v_scope.status='bound'
     and coalesce(v_mission.metadata->>'execution_lane','')='user' then
    return jsonb_build_object(
      'action','already_recovered',
      'mission_id',v_mission.mission_id,
      'scope_id_prefix',left(v_scope.scope_id,12),
      'scope_status','bound',
      'execution_lane','user'
    );
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

  -- Single audit event whenever this recovery mutated any row.
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
        'note','Single identity-verified recovery of the stalled A4 attempt; no new mission, scope, job or lease was created.'
      )
    );
  end if;

  return jsonb_build_object(
    'action','recovered',
    'mission_id',v_mission.mission_id,
    'scope_id_prefix',left(v_scope.scope_id,12),
    'scope_status','bound',
    'execution_lane','user',
    'scope_rearmed',(v_rearmed=1),
    'lane_stamped',(v_stamped=1)
  );
end;
$function$;

revoke all on function aria_internal.aria_m22_a4_recover_mission_v1(text,text,text,text,text) from public,anon,authenticated;
grant execute on function aria_internal.aria_m22_a4_recover_mission_v1(text,text,text,text,text) to service_role;

commit;
