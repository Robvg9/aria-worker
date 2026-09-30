-- Bound the global chat lookup to one recent non-project conversation.
-- The previous list RPC returned the user's entire conversation history,
-- which could exceed the Edge Function latency budget as history grew.
create or replace function public.aria_app_get_global_conversation(
  p_user_id uuid
)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog', 'aria_app'
as $function$
  select coalesce(
    (
      select pg_catalog.to_jsonb(c)
      from aria_app.conversations c
      where c.owner_user_id = p_user_id
        and not (coalesce(c.metadata, '{}'::jsonb) ? 'project_id')
      order by c.updated_at desc
      limit 1
    ),
    null::jsonb
  );
$function$;

revoke all on function public.aria_app_get_global_conversation(uuid)
  from public, anon, authenticated;

grant execute on function public.aria_app_get_global_conversation(uuid)
  to service_role;
