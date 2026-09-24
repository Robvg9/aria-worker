-- Fix project-scoped conversations through a canonical security-definer RPC.
-- The RPC avoids fragile PostgREST JSONB-path filtering and guarantees one project chat per owner.

create unique index if not exists conversations_owner_project_uidx
on aria_app.conversations (
  owner_user_id,
  lower((metadata->>'project_id'))
)
where metadata ? 'project_id';

create or replace function public.aria_app_get_or_create_project_conversation(
  p_user_id uuid,
  p_project_id text,
  p_project_name text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_app'
as $function$
declare
  row_data jsonb;
  new_id uuid;
  clean_project_id text := lower(pg_catalog.btrim(coalesce(p_project_id,'')));
  clean_project_name text := left(coalesce(nullif(pg_catalog.btrim(p_project_name),''),'Proyecto'),160);
begin
  if p_user_id is null or clean_project_id = '' then
    raise exception 'project_conversation_arguments_invalid';
  end if;

  select pg_catalog.to_jsonb(c)
    into row_data
  from aria_app.conversations c
  where c.owner_user_id = p_user_id
    and lower(coalesce(c.metadata->>'project_id','')) = clean_project_id
  order by c.updated_at desc
  limit 1;

  if row_data is null then
    new_id := pg_catalog.gen_random_uuid();

    insert into aria_app.conversations(
      conversation_id,
      owner_user_id,
      title,
      metadata
    )
    values(
      new_id,
      p_user_id,
      clean_project_name || ' · Chat',
      pg_catalog.jsonb_build_object(
        'project_id', clean_project_id,
        'project_name', clean_project_name
      )
    )
    on conflict (owner_user_id, lower((metadata->>'project_id')))
    where metadata ? 'project_id'
    do nothing;

    select pg_catalog.to_jsonb(c)
      into row_data
    from aria_app.conversations c
    where c.owner_user_id = p_user_id
      and lower(coalesce(c.metadata->>'project_id','')) = clean_project_id
    order by c.updated_at desc
    limit 1;
  end if;

  return row_data;
end;
$function$;

revoke all on function public.aria_app_get_or_create_project_conversation(uuid,text,text) from public;
revoke all on function public.aria_app_get_or_create_project_conversation(uuid,text,text) from anon;
revoke all on function public.aria_app_get_or_create_project_conversation(uuid,text,text) from authenticated;
grant execute on function public.aria_app_get_or_create_project_conversation(uuid,text,text) to service_role;
