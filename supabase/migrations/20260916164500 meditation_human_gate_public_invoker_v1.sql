create or replace function public.aria_meditation_approve_human_gate(p_mission_id text, p_resolution jsonb default '{}'::jsonb)
returns jsonb
language sql
security invoker
set search_path = pg_catalog, public, aria_internal
as $$
  select aria_internal.aria_meditation_approve_human_gate(p_mission_id, p_resolution);
$$;
revoke execute on function public.aria_meditation_approve_human_gate(text,jsonb) from public, anon;
grant execute on function public.aria_meditation_approve_human_gate(text,jsonb) to authenticated;
comment on function public.aria_meditation_approve_human_gate(text,jsonb) is 'Authenticated PostgREST facade for the secured internal Meditation IA Human Gate approval wrapper.';
