create or replace function public.aria_validate_learning_preflight(p_goal text, p_plan jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, aria_internal
as $fn$
  select aria_internal.validate_learning_preflight(p_goal, p_plan);
$fn$;

create or replace function public.aria_verify_learning_application(
  p_goal text,
  p_steps jsonb,
  p_results jsonb,
  p_applied_memory_ids jsonb
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, aria_internal
as $fn$
  select aria_internal.verify_learning_application(
    p_goal,
    p_steps,
    p_results,
    p_applied_memory_ids
  );
$fn$;

revoke all on function public.aria_validate_learning_preflight(text, jsonb) from public, anon, authenticated;
revoke all on function public.aria_verify_learning_application(text, jsonb, jsonb, jsonb) from public, anon, authenticated;

grant execute on function public.aria_validate_learning_preflight(text, jsonb) to service_role;
grant execute on function public.aria_verify_learning_application(text, jsonb, jsonb, jsonb) to service_role;
