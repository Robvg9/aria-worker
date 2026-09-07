-- Universal Execution hardening: fence all mission mutations/events to the current lease owner.
-- This closes cross-worker mutation races while preserving existing legacy wrappers.

create or replace function aria_internal.aria_mission_renew_lease(
  p_mission_id text,
  p_worker_id text,
  p_lease_for interval default '00:05:00'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_internal
as $$
declare r aria_internal.mission_state;
begin
  if coalesce(btrim(p_mission_id), '') = '' then raise exception 'mission_id_required'; end if;
  if coalesce(btrim(p_worker_id), '') = '' then raise exception 'worker_id_required'; end if;
  update aria_internal.mission_state
     set lease_until = clock_timestamp() + p_lease_for,
         updated_at = clock_timestamp()
   where mission_id = p_mission_id
     and lease_owner = p_worker_id
     and lease_until is not null
     and lease_until > clock_timestamp()
  returning * into r;
  if not found then return null; end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.aria_mission_update_lease(
  p_mission_id text,
  p_worker_id text,
  p_mission jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_internal
as $$
declare r aria_internal.mission_state;
begin
  if coalesce(btrim(p_mission_id), '') = '' then raise exception 'mission_id_required'; end if;
  if coalesce(btrim(p_worker_id), '') = '' then raise exception 'worker_id_required'; end if;
  update aria_internal.mission_state
     set goal = coalesce(p_mission->>'goal', goal),
         status = coalesce(p_mission->>'status', status),
         current_step = coalesce((p_mission->>'current_step')::integer, current_step),
         total_steps = case when p_mission ? 'total_steps' then case when p_mission->>'total_steps' is null then null else (p_mission->>'total_steps')::integer end else total_steps end,
         completed_steps = coalesce((p_mission->>'completed_steps')::integer, completed_steps),
         attempt_count = coalesce((p_mission->>'attempt_count')::integer, attempt_count),
         current_agent_id = case when p_mission ? 'current_agent_id' then p_mission->>'current_agent_id' else current_agent_id end,
         current_workspace = case when p_mission ? 'current_workspace' then p_mission->>'current_workspace' else current_workspace end,
         last_command = case when p_mission ? 'last_command' then p_mission->>'last_command' else last_command end,
         last_exit_code = case when p_mission ? 'last_exit_code' then case when p_mission->>'last_exit_code' is null then null else (p_mission->>'last_exit_code')::integer end else last_exit_code end,
         last_stdout = case when p_mission ? 'last_stdout' then p_mission->>'last_stdout' else last_stdout end,
         last_stderr = case when p_mission ? 'last_stderr' then p_mission->>'last_stderr' else last_stderr end,
         next_action = case when p_mission ? 'next_action' then p_mission->>'next_action' else next_action end,
         checkpoint = coalesce(p_mission->'checkpoint', checkpoint),
         metadata = coalesce(p_mission->'metadata', metadata),
         finished_at = case when p_mission ? 'finished_at' then case when p_mission->>'finished_at' is null then null else (p_mission->>'finished_at')::timestamptz end else finished_at end,
         lease_owner = case when p_mission ? 'lease_owner' then p_mission->>'lease_owner' else lease_owner end,
         lease_until = case when p_mission ? 'lease_until' then case when p_mission->>'lease_until' is null then null else (p_mission->>'lease_until')::timestamptz end else lease_until end,
         updated_at = clock_timestamp()
   where mission_id = p_mission_id
     and lease_owner = p_worker_id
     and lease_until is not null
     and lease_until > clock_timestamp()
  returning * into r;
  if not found then return null; end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.aria_mission_append_event_lease(
  p_mission_id text,
  p_worker_id text,
  p_event jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_internal
as $$
declare r aria_internal.mission_events;
begin
  if coalesce(btrim(p_mission_id), '') = '' then raise exception 'mission_id_required'; end if;
  if coalesce(btrim(p_worker_id), '') = '' then raise exception 'worker_id_required'; end if;
  if not exists (
    select 1 from aria_internal.mission_state
     where mission_id = p_mission_id
       and lease_owner = p_worker_id
       and lease_until is not null
       and lease_until > clock_timestamp()
  ) then raise exception 'mission_lease_required'; end if;
  insert into aria_internal.mission_events (mission_id, step_index, event_type, payload)
  values (
    p_mission_id,
    case when p_event ? 'step_index' and p_event->>'step_index' is not null then (p_event->>'step_index')::integer else null end,
    coalesce(p_event->>'event_type','event'),
    coalesce(p_event->'payload','{}'::jsonb)
  ) returning * into r;
  return to_jsonb(r);
end;
$$;

revoke all on function aria_internal.aria_mission_renew_lease(text,text,interval) from public;
revoke all on function public.aria_mission_update_lease(text,text,jsonb) from anon, authenticated;
revoke all on function public.aria_mission_append_event_lease(text,text,jsonb) from anon, authenticated;
