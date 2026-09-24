-- Canonical atomic conversation persistence for ARIA app chat.
create or replace function public.aria_app_persist_message(
  p_user_id uuid,
  p_conversation_id uuid,
  p_role text,
  p_content text,
  p_parts jsonb,
  p_trace_id text,
  p_visual_state text default null,
  p_provider_id text default null,
  p_model_id text default null,
  p_title text default 'Nueva conversación',
  p_project_id text default null,
  p_project_name text default null,
  p_project_icon text default null,
  p_project_context text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'aria_app'
as $function$
declare
  existing_owner uuid;
  message_id uuid;
  message_created timestamptz;
  clean_title text := left(coalesce(nullif(pg_catalog.btrim(p_title), ''), 'Nueva conversación'), 160);
  clean_project_id text := nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_project_id, ''))), '');
begin
  if p_user_id is null or p_conversation_id is null then
    raise exception 'conversation_persist_arguments_invalid';
  end if;
  if p_role not in ('user','assistant','system') then
    raise exception 'invalid_message_role';
  end if;

  select owner_user_id
    into existing_owner
    from aria_app.conversations
   where conversation_id = p_conversation_id;

  if existing_owner is not null and existing_owner <> p_user_id then
    raise exception 'conversation_owner_mismatch';
  end if;

  if existing_owner is null then
    insert into aria_app.conversations(conversation_id, owner_user_id, title, metadata)
    values (
      p_conversation_id,
      p_user_id,
      clean_title,
      case when clean_project_id is null then '{}'::jsonb
           else pg_catalog.jsonb_build_object(
             'project_id', clean_project_id,
             'project_name', left(coalesce(nullif(pg_catalog.btrim(p_project_name), ''), 'Proyecto'),160),
             'project_icon', p_project_icon,
             'project_context', p_project_context
           )
      end
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
     where conversation_id = p_conversation_id
       and owner_user_id = p_user_id;
  end if;

  if not exists (
    select 1
      from aria_app.conversations
     where conversation_id = p_conversation_id
       and owner_user_id = p_user_id
  ) then
    raise exception 'conversation_not_owned';
  end if;

  insert into aria_app.messages(
    conversation_id, owner_user_id, role, content, parts, trace_id,
    visual_state, provider_id, model_id
  )
  values (
    p_conversation_id, p_user_id, p_role, p_content,
    coalesce(p_parts, '[]'::jsonb), p_trace_id,
    p_visual_state, p_provider_id, p_model_id
  )
  returning aria_app.messages.message_id, aria_app.messages.created_at
    into message_id, message_created;

  update aria_app.conversations
     set updated_at = pg_catalog.now(),
         last_message_at = message_created
   where conversation_id = p_conversation_id
     and owner_user_id = p_user_id;

  return pg_catalog.jsonb_build_object(
    'message_id', message_id,
    'created_at', message_created
  );
end;
$function$;

revoke all on function public.aria_app_persist_message(
  uuid,uuid,text,text,jsonb,text,text,text,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.aria_app_persist_message(
  uuid,uuid,text,text,jsonb,text,text,text,text,text,text,text,text,text
) to service_role;
