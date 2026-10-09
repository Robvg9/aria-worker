-- Reduce Meditation IA overview latency under large mission histories.
-- Scope the dashboard count/query path to the authenticated owner and aggregate
-- state counts in one pass instead of issuing ten sequential exact-count scans.

create index if not exists mission_state_user_updated_idx
  on aria_internal.mission_state ((metadata ->> 'user_id'), updated_at desc)
  include (status);

create index if not exists mission_state_owner_user_updated_idx
  on aria_internal.mission_state ((metadata ->> 'owner_user_id'), updated_at desc)
  include (status);

create index if not exists mission_state_meditation_session_updated_idx
  on aria_internal.mission_state ((metadata ->> 'meditation_session_id'), updated_at desc)
  include (status);

create or replace function aria_internal.aria_meditation_mission_status_counts_v1(
  p_user_id uuid,
  p_session_id text default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, aria_internal
as $function$
  with owned as materialized (
    select coalesce(m.status, 'unknown') as status
      from aria_internal.mission_state m
     where p_user_id is not null
       and (
         m.metadata ->> 'user_id' = p_user_id::text
         or m.metadata ->> 'owner_user_id' = p_user_id::text
         or (
           nullif(btrim(p_session_id), '') is not null
           and m.metadata ->> 'meditation_session_id' = btrim(p_session_id)
         )
       )
  ),
  counts as (
    select status, count(*)::bigint as total
      from owned
     group by status
  )
  select jsonb_build_object(
    'total', (select count(*)::bigint from owned),
    'statuses', coalesce(
      (select jsonb_object_agg(status, total) from counts),
      '{}'::jsonb
    )
  );
$function$;

revoke all on function aria_internal.aria_meditation_mission_status_counts_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function aria_internal.aria_meditation_mission_status_counts_v1(uuid, text)
  to service_role;
