create or replace function aria_internal.aria_meditation_approve_human_gate(
  p_mission_id text,
  p_user_id uuid,
  p_resolution jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_internal
as $$
declare
  r aria_internal.mission_state;
  owner_id text;
begin
  if coalesce(btrim(p_mission_id), '') = '' then
    raise exception 'mission_id_required';
  end if;

  select * into r
  from aria_internal.mission_state
  where mission_id = p_mission_id
  for update;

  if not found then
    raise exception 'mission_not_found';
  end if;

  owner_id := coalesce(r.metadata ->> 'user_id', r.metadata ->> 'owner_user_id');
  if owner_id is not null and owner_id <> p_user_id::text then
    raise exception 'mission_not_owned_by_user';
  end if;

  if coalesce(r.checkpoint -> 'recovery' ->> 'status', '') not in ('waiting_for_human_gate', 'human_gate_pending') then
    raise exception 'human_gate_not_pending';
  end if;

  return aria_internal.aria_mission_resolve_human_gate(
    p_mission_id,
    coalesce(p_resolution, '{}'::jsonb) || jsonb_build_object(
      'resolved_by_user_id', p_user_id::text,
      'resolution_source', 'aria-app'
    )
  );
end;
$$;

comment on function aria_internal.aria_meditation_approve_human_gate(text, uuid, jsonb) is
  'Meditation IA v1: approve a pending Human Gate only when the mission belongs to the authenticated ARIA user.';
