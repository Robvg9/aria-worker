-- Prevent a caller from silently moving an existing project conversation across project boundaries.
create or replace function public.aria_app_persist_message(
  p_user_id uuid,
  p_conversation_id uuid,
  p_role text,
  p_content text,
  p_parts jsonb,
  p_trace_id text,
  p_visual_state text default null::text,
  p_provider_id text default null::text,
  p_model_id text default null::text,
  p_title text default 'Nueva conversación'::text,
  p_project_id text default null::text,
  p_project_name text default null::text,
  p_project_icon text default null::text,
  p_project_context text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_app
as $function$
declare
  existing_owner uuid;
  target_conversation_id uuid := p_conversation_id;
  project_existing_id uuid;
  existing_project_id text;
  message_id uuid;
  message_created timestamptz;
  clean_title text := left(coalesce(nullif(pg_catalog.btrim(p_title), ''), 'Nueva conversación'), 160);
  clean_project_id text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_project_id, ''))), '');
begin
  if p_user_id is null or target_conversation_id is null then
    raise exception 'conversation_persist_arguments_invalid';
  end if;
  if p_role not in ('user','assistant','system') then
    raise exception 'invalid_message_role';
  end if;

  select c.owner_user_id, pg_catalog.lower(coalesce(c.metadata->>'project_id',''))
    into existing_owner, existing_project_id
    from aria_app.conversations c
   where c.conversation_id = target_conversation_id;

  if existing_owner is not null and existing_owner <> p_user_id then
    raise exception 'conversation_owner_mismatch';
  end if;

  if clean_project_id is not null and existing_owner is not null
     and existing_project_id <> '' and existing_project_id <> clean_project_id then
    raise exception 'conversation_project_mismatch';
  end if;

  if existing_owner is null and clean_project_id is not null then
    select c.conversation_id
      into project_existing_id
      from aria_app.conversations c
     where c.owner_user_id = p_user_id
       and pg_catalog.lower(coalesce(c.metadata->>'project_id','')) = clean_project_id
     order by c.updated_at desc
     limit 1;
    if project_existing_id is not null then
      target_conversation_id := project_existing_id;
      existing_owner := p_user_id;
    end if;
  end if;

  if existing_owner is null then
    insert into aria_app.conversations(conversation_id, owner_user_id, title, metadata)
    values (
      target_conversation_id, p_user_id, clean_title,
      case when clean_project_id is null then '{}'::jsonb
      else pg_catalog.jsonb_build_object(
        'project_id', clean_project_id,
        'project_name', left(coalesce(nullif(pg_catalog.btrim(p_project_name), ''), 'Proyecto'),160),
        'project_icon', p_project_icon,
        'project_context', p_project_context
      ) end
    );
  elsif clean_project_id is not null then
    update aria_app.conversations
    set metadata = coalesce(metadata, '{}'::jsonb) ||
      pg_catalog.jsonb_build_object(
        'project_id', clean_project_id,
        'project_name', left(coalesce(nullif(pg_catalog.btrim(p_project_name), ''), 'Proyecto'),160),
        'project_icon', p_project_icon,
        'project_context', p_project_context
      ),
      updated_at = pg_catalog.now()
    where conversation_id = target_conversation_id and owner_user_id = p_user_id;
  end if;

  if not exists (
    select 1 from aria_app.conversations
    where conversation_id = target_conversation_id and owner_user_id = p_user_id
  ) then
    raise exception 'conversation_not_owned';
  end if;

  insert into aria_app.messages(
    conversation_id, owner_user_id, role, content, parts, trace_id,
    visual_state, provider_id, model_id
  )
  values (
    target_conversation_id, p_user_id, p_role, p_content,
    coalesce(p_parts, '[]'::jsonb), p_trace_id,
    p_visual_state, p_provider_id, p_model_id
  )
  returning aria_app.messages.message_id, aria_app.messages.created_at
    into message_id, message_created;

  update aria_app.conversations
  set updated_at = pg_catalog.now(), last_message_at = message_created
  where conversation_id = target_conversation_id and owner_user_id = p_user_id;

  return pg_catalog.jsonb_build_object(
    'conversation_id', target_conversation_id,
    'message_id', message_id,
    'created_at', message_created
  );
end;
$function$;

revoke all on function public.aria_app_persist_message(uuid,uuid,text,text,jsonb,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.aria_app_persist_message(uuid,uuid,text,text,jsonb,text,text,text,text,text,text,text,text,text) to service_role;
