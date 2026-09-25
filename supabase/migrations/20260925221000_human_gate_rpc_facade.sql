-- Human Gate RPC facade for Supabase JS schema-cache compatibility.
create or replace function public.mission_human_gate_decide(
  p_mission_id text,
  p_decision text,
  p_approver_id text,
  p_action_hash text default null,
  p_note text default null
)
returns jsonb
language sql
security definer
set search_path to pg_catalog, aria_internal
as $$
  select aria_internal.mission_human_gate_decide(p_mission_id,p_decision,p_approver_id,p_action_hash,p_note);
$$;

revoke all on function public.mission_human_gate_decide(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.mission_human_gate_decide(text,text,text,text,text) to service_role;

create or replace function public.human_gate_authorize_execution(
  p_mission_id text,
  p_step_id text,
  p_action_hash text,
  p_approval_token text
)
returns boolean
language sql
security definer
set search_path to pg_catalog, aria_internal
as $$
  select aria_internal.human_gate_authorize_execution(p_mission_id,p_step_id,p_action_hash,p_approval_token);
$$;

revoke all on function public.human_gate_authorize_execution(text,text,text,text) from public, anon, authenticated;
grant execute on function public.human_gate_authorize_execution(text,text,text,text) to service_role;
