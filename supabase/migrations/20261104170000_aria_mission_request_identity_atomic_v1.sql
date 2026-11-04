-- Mission Wonder 2 — Step 4 / A4
-- Enforce a single canonical mission for each authenticated PWA request.
-- Existing production data was audited read-only before introducing this index:
-- no duplicated non-empty (user_id, request_id) pairs were found.
--
-- This migration does not create/requeue missions, jobs or leases and does not
-- change MISSION_EXECUTION_PAUSED. It only serializes concurrent intake retries.

begin;

create unique index if not exists mission_state_user_request_identity_uidx
  on aria_internal.mission_state (
    (metadata ->> 'user_id'),
    (metadata ->> 'request_id')
  )
  where nullif(metadata ->> 'user_id', '') is not null
    and nullif(metadata ->> 'request_id', '') is not null;

create or replace function aria_internal.aria_mission_create(p_mission jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_internal'
as $function$
declare
  r jsonb;
  existing aria_internal.mission_state;
  g aria_internal.autonomy_goals;
  v_mission_id text := coalesce(nullif(p_mission ->> 'mission_id', ''), 'mission_' || gen_random_uuid()::text);
  v_goal_id text := nullif(p_mission -> 'metadata' ->> 'goal_id', '');
  v_dynamic boolean := coalesce((p_mission -> 'metadata' ->> 'dynamic_goal')::boolean, false);
  v_source text := coalesce(p_mission -> 'metadata' ->> 'source', '');
  v_replan boolean := coalesce((p_mission -> 'metadata' ->> 'replan_required')::boolean, false)
    or coalesce((p_mission -> 'metadata' ->> 'resume_blocked_goal')::boolean, false)
    or coalesce((p_mission -> 'checkpoint' -> 'recovery' ->> 'replan_required')::boolean, false);
  v_objective_id text;
  v_request_id text := nullif(btrim(p_mission -> 'metadata' ->> 'request_id'), '');
  v_user_id text := nullif(btrim(p_mission -> 'metadata' ->> 'user_id'), '');
  v_project_id text := nullif(btrim(p_mission -> 'metadata' ->> 'project_id'), '');
begin
  -- Serialize same-owner retries before reading or inserting. The unique index
  -- below is the database-level backstop if a future caller omits this lock.
  if v_request_id is not null and v_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_user_id || ':' || v_request_id, 0));

    select *
      into existing
      from aria_internal.mission_state
     where metadata ->> 'user_id' = v_user_id
       and metadata ->> 'request_id' = v_request_id
     order by created_at desc, mission_id desc
     limit 1;

    if found then
      if btrim(coalesce(existing.goal, '')) is distinct from btrim(coalesce(p_mission ->> 'goal', ''))
        or nullif(btrim(existing.metadata ->> 'project_id'), '') is distinct from v_project_id
        or (
          nullif(existing.metadata ->> 'owner_user_id', '') is not null
          and existing.metadata ->> 'owner_user_id' <> v_user_id
        )
      then
        raise exception 'mission_request_idempotency_conflict'
          using errcode = '23505';
      end if;

      return to_jsonb(existing);
    end if;
  end if;

  if v_goal_id is not null then
    select * into g
      from aria_internal.autonomy_goals
     where goal_id = v_goal_id;

    if found then
      if g.objective_verification_status = 'DUPLICATE_HISTORICAL' then
        raise exception 'goal_is_historical_duplicate';
      end if;
      if g.status = 'completed' or g.objective_verification_status = 'CONFIRMED' then
        raise exception 'goal_already_confirmed';
      end if;
      if g.status = 'blocked' and not v_replan then
        raise exception 'blocked_goal_requires_explicit_replan';
      end if;
      if g.source_type = 'vision' then
        v_objective_id := nullif(g.metadata ->> 'vision_objective_id', '');
        if v_objective_id is null then
          raise exception 'vision_goal_missing_objective_identity';
        end if;
        if aria_internal.canonical_vision_goal_id(v_objective_id) <> v_goal_id then
          raise exception 'vision_goal_not_canonical';
        end if;
      end if;

      select * into existing
        from aria_internal.mission_state
       where metadata ->> 'goal_id' = v_goal_id
         and status in ('queued', 'planning', 'running', 'waiting', 'paused')
       order by created_at desc, mission_id desc
       limit 1;

      if found then
        return to_jsonb(existing);
      end if;
    end if;
  end if;

  if v_dynamic or v_source like 'autonomy_supervisor_v10%' then
    if exists (
      select 1
        from aria_internal.mission_state
       where status in ('queued', 'planning', 'running', 'waiting', 'paused')
    ) then
      raise exception 'autonomy_global_inflight_limit';
    end if;
  end if;

  begin
    insert into aria_internal.mission_state (
      mission_id, status, goal, current_step, completed_steps, checkpoint, metadata
    ) values (
      v_mission_id,
      'queued',
      coalesce(p_mission ->> 'goal', ''),
      coalesce((p_mission ->> 'current_step')::int, 0),
      coalesce((p_mission ->> 'completed_steps')::int, 0),
      coalesce(p_mission -> 'checkpoint', '{}'::jsonb),
      coalesce(p_mission -> 'metadata', '{}'::jsonb)
    )
    returning to_jsonb(mission_state.*) into r;

    if v_goal_id is not null then
      update aria_internal.autonomy_goals
         set last_mission_id = v_mission_id,
             status = case when status = 'blocked' and v_replan then 'queued' else 'queued' end,
             next_run_at = clock_timestamp(),
             updated_at = clock_timestamp()
       where goal_id = v_goal_id
         and status <> 'completed'
         and objective_verification_status <> 'CONFIRMED';
    end if;

    return r;
  exception when unique_violation then
    -- A concurrent identical request may have committed between a caller's
    -- preflight read and this insert. Reconcile it to the single canonical row.
    if v_request_id is not null and v_user_id is not null then
      select * into existing
        from aria_internal.mission_state
       where metadata ->> 'user_id' = v_user_id
         and metadata ->> 'request_id' = v_request_id
       order by created_at desc, mission_id desc
       limit 1;

      if found then
        if btrim(coalesce(existing.goal, '')) is distinct from btrim(coalesce(p_mission ->> 'goal', ''))
          or nullif(btrim(existing.metadata ->> 'project_id'), '') is distinct from v_project_id
          or (
            nullif(existing.metadata ->> 'owner_user_id', '') is not null
            and existing.metadata ->> 'owner_user_id' <> v_user_id
          )
        then
          raise exception 'mission_request_idempotency_conflict';
        end if;
        return to_jsonb(existing);
      end if;
    end if;

    if v_goal_id is not null then
      select * into existing
        from aria_internal.mission_state
       where metadata ->> 'goal_id' = v_goal_id
         and status in ('queued', 'planning', 'running', 'waiting', 'paused')
       order by created_at desc, mission_id desc
       limit 1;

      if found then
        return to_jsonb(existing);
      end if;
    end if;

    raise;
  end;
end;
$function$;

commit;
