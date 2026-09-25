-- Authenticated human approval facade for generic action-scoped Human Gate.
create or replace function public.mission_human_gate_decide_authenticated(
  p_mission_id text,
  p_decision text,
  p_action_hash text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, aria_internal
as $$
declare
  caller_id uuid;
  owner_id text;
begin
  caller_id := auth.uid();
  if caller_id is null then
    raise exception 'authentication_required';
  end if;

  select coalesce(metadata->>'user_id', metadata->>'owner_user_id')
    into owner_id
    from aria_internal.mission_state
   where mission_id=p_mission_id;

  if owner_id is null or owner_id <> caller_id::text then
    raise exception 'mission_not_owned_by_user';
  end if;

  return aria_internal.mission_human_gate_decide(
    p_mission_id,
    p_decision,
    caller_id::text,
    p_action_hash,
    p_note
  );
end;
$$;

revoke all on function public.mission_human_gate_decide_authenticated(text,text,text,text) from public, anon;
grant execute on function public.mission_human_gate_decide_authenticated(text,text,text,text) to authenticated;
