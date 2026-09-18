-- Post-audit hardening: human-readable Meditation IA notifications.
-- Mission identifiers remain in metadata for traceability, never in human-facing title/message.
create or replace function aria_internal.meditation_notification_mission_label(p_mission_id text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, aria_internal
as $$
declare
  v_goal text;
  v_metadata jsonb;
  v_label text;
begin
  select ms.goal, coalesce(ms.metadata, '{}'::jsonb)
    into v_goal, v_metadata
  from aria_internal.mission_state ms
  where ms.mission_id = p_mission_id;

  v_label := coalesce(
    nullif(trim(v_metadata->>'display_name'), ''),
    nullif(trim(v_metadata->>'mission_name'), ''),
    nullif(trim(v_metadata->>'title'), ''),
    nullif(trim(v_metadata->>'summary'), ''),
    nullif(trim(v_goal), '')
  );

  if v_label is null then
    return 'esta misión';
  end if;

  v_label := regexp_replace(v_label, '\\s+', ' ', 'g');
  v_label := regexp_replace(v_label, '\\b(?:mission|auto|job|goal)[_-][A-Za-z0-9-]{8,}\\b', 'esta misión', 'gi');
  v_label := regexp_replace(v_label, '\\b[0-9a-f]{8}-[0-9a-f-]{27,}\\b', 'esta misión', 'gi');
  v_label := btrim(v_label, ' .');
  if length(v_label) > 180 then
    v_label := left(v_label, 177) || '...';
  end if;

  if v_label = '' then
    return 'esta misión';
  end if;

  return v_label;
end;
$$;

comment on function aria_internal.meditation_notification_mission_label(text) is
  'Post-audit hardening: returns a human-readable mission label; opaque identifiers remain out of notification title/message.';

create or replace function aria_internal.materialize_meditation_notification()
returns trigger
language plpgsql
set search_path = pg_catalog, aria_internal
as $$
declare
  v_kind text;
  v_severity text;
  v_title text;
  v_message text;
  v_action text;
  v_recoverable boolean := true;
  v_code text := lower(coalesce(new.payload->>'code',''));
  v_error text := lower(coalesce(new.payload->>'error',''));
  v_reason text := lower(coalesce(new.payload->>'reason',''));
  v_next_action text := lower(coalesce(new.payload->>'next_action',''));
  v_relevant_text text;
  v_mission_label text := aria_internal.meditation_notification_mission_label(new.mission_id);
begin
  v_relevant_text := concat_ws(' ', v_code, v_error, v_reason, v_next_action);

  if new.event_type = 'mission_verified'
     and lower(coalesce(new.payload->>'verified','true')) <> 'false' then
    v_kind := 'mission_completed_verified';
    v_severity := 'success';
    v_title := 'Misión completada y verificada';
    v_message := format('ARIA completó y verificó: %s.', v_mission_label);
    v_action := 'review_result';

  elsif new.event_type in ('human_gate_requested','self_improvement_human_gate') then
    v_kind := 'human_gate_required';
    v_severity := 'warning';
    v_title := 'Human Gate requerido';
    v_message := format('ARIA necesita tu confirmación para continuar con: %s.', v_mission_label);
    v_action := 'open_human_gate';

  elsif new.event_type = 'mission_blocked' then
    if v_relevant_text ~ '(payment|pago|credential|credencial|quota|cuota|billing|facturacion)' then
      v_kind := 'payment_or_credential_block';
      v_severity := 'warning';
      v_title := 'Bloqueo por pago o credencial';
      v_message := format('ARIA no puede continuar con %s porque falta una dependencia de pago, cuota o credencial.', v_mission_label);
      v_action := 'review_dependency';
    else
      v_kind := 'mission_blocked';
      v_severity := 'warning';
      v_title := 'Misión bloqueada';
      v_message := format('ARIA no puede continuar con %s y necesita revisión.', v_mission_label);
      v_action := 'review_block';
    end if;

  elsif new.event_type = 'mission_dead_lettered' then
    v_kind := 'error_nonrecoverable';
    v_severity := 'error';
    v_title := 'Error no recuperable';
    v_message := format('ARIA terminó %s en un estado no recuperable.', v_mission_label);
    v_action := 'review_failure';
    v_recoverable := false;

  elsif new.event_type = 'mission_failed' then
    v_recoverable := lower(coalesce(new.payload->>'recoverable','true')) <> 'false'
      and v_relevant_text !~ '(non.?recoverable|fatal|permanent)';
    if v_recoverable then
      v_kind := 'error_recoverable';
      v_severity := 'warning';
      v_title := 'Error recuperable en misión';
      v_message := format('ARIA tuvo un problema con %s, pero la ruta de recuperación sigue disponible.', v_mission_label);
      v_action := 'review_recovery';
    else
      v_kind := 'error_nonrecoverable';
      v_severity := 'error';
      v_title := 'Error no recuperable';
      v_message := format('ARIA no pudo completar %s y no existe una ruta automática de recuperación válida.', v_mission_label);
      v_action := 'review_failure';
    end if;

  elsif new.event_type in ('mission_created','mission_queued')
     and (
       lower(coalesce(new.payload->>'proposal_ready','false')) = 'true'
       or lower(coalesce(new.payload->>'requires_review','false')) = 'true'
     ) then
    v_kind := 'mission_proposal_ready';
    v_severity := 'info';
    v_title := 'Nueva propuesta lista para revisión';
    v_message := format('ARIA preparó una nueva propuesta: %s. Está lista para tu revisión.', v_mission_label);
    v_action := 'review_proposal';
  end if;

  if v_kind is null then
    return new;
  end if;

  insert into aria_internal.meditation_notifications (
    source_event_id,
    mission_id,
    kind,
    severity,
    title,
    message,
    action,
    metadata
  )
  values (
    new.event_id,
    new.mission_id,
    v_kind,
    v_severity,
    v_title,
    v_message,
    v_action,
    jsonb_build_object(
      'source_event_id', new.event_id,
      'event_type', new.event_type,
      'recoverable', case when v_kind = 'error_recoverable' then true when v_kind = 'error_nonrecoverable' then false else null end,
      'mission_label', v_mission_label
    )
  )
  on conflict (source_event_id) do nothing;

  return new;
end;
$$;

comment on function aria_internal.materialize_meditation_notification() is
  'Mission 3/7 + post-audit hardening: materializes traceable human-readable notifications without exposing opaque mission IDs in title/message.';
