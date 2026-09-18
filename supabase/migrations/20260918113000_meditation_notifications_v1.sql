-- Mission 3/7 — governed, traceable Meditation IA notifications.
-- One notification per relevant mission event, deduplicated by source_event_id.
create table if not exists aria_internal.meditation_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  source_event_id bigint not null unique references aria_internal.mission_events(event_id) on delete cascade,
  mission_id text not null references aria_internal.mission_state(mission_id) on delete cascade,
  kind text not null check (kind in (
    'mission_completed_verified',
    'human_gate_required',
    'mission_blocked',
    'error_recoverable',
    'error_nonrecoverable',
    'payment_or_credential_block',
    'mission_proposal_ready'
  )),
  severity text not null check (severity in ('info','success','warning','error')),
  title text not null,
  message text not null,
  action text,
  metadata jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists meditation_notifications_created_idx
  on aria_internal.meditation_notifications (created_at desc);

create index if not exists meditation_notifications_unread_idx
  on aria_internal.meditation_notifications (read_at, created_at desc);

create index if not exists meditation_notifications_mission_idx
  on aria_internal.meditation_notifications (mission_id, created_at desc);

alter table aria_internal.meditation_notifications enable row level security;

revoke all on aria_internal.meditation_notifications from anon, authenticated;

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
begin
  v_relevant_text := concat_ws(' ', v_code, v_error, v_reason, v_next_action);

  if new.event_type = 'mission_verified'
     and lower(coalesce(new.payload->>'verified','true')) <> 'false' then
    v_kind := 'mission_completed_verified';
    v_severity := 'success';
    v_title := 'Misión completada y verificada';
    v_message := format('La misión %s terminó y su verificación fue registrada.', new.mission_id);
    v_action := 'review_result';

  elsif new.event_type in ('human_gate_requested','self_improvement_human_gate') then
    v_kind := 'human_gate_required';
    v_severity := 'warning';
    v_title := 'Human Gate requerido';
    v_message := format('La misión %s necesita una confirmación humana antes de continuar o cerrar.', new.mission_id);
    v_action := 'open_human_gate';

  elsif new.event_type = 'mission_blocked' then
    if v_relevant_text ~ '(payment|pago|credential|credencial|quota|cuota|billing|facturacion)' then
      v_kind := 'payment_or_credential_block';
      v_severity := 'warning';
      v_title := 'Bloqueo por pago o credencial';
      v_message := format('La misión %s quedó bloqueada por una dependencia de pago, cuota o credencial.', new.mission_id);
      v_action := 'review_dependency';
    else
      v_kind := 'mission_blocked';
      v_severity := 'warning';
      v_title := 'Misión bloqueada';
      v_message := format('La misión %s quedó bloqueada y requiere revisión.', new.mission_id);
      v_action := 'review_block';
    end if;

  elsif new.event_type = 'mission_dead_lettered' then
    v_kind := 'error_nonrecoverable';
    v_severity := 'error';
    v_title := 'Error no recuperable';
    v_message := format('La misión %s alcanzó un estado no recuperable.', new.mission_id);
    v_action := 'review_failure';
    v_recoverable := false;

  elsif new.event_type = 'mission_failed' then
    v_recoverable := lower(coalesce(new.payload->>'recoverable','true')) <> 'false'
      and v_relevant_text !~ '(non.?recoverable|fatal|permanent)';
    if v_recoverable then
      v_kind := 'error_recoverable';
      v_severity := 'warning';
      v_title := 'Error recuperable en misión';
      v_message := format('La misión %s falló, pero la ruta de recuperación sigue disponible.', new.mission_id);
      v_action := 'review_recovery';
    else
      v_kind := 'error_nonrecoverable';
      v_severity := 'error';
      v_title := 'Error no recuperable';
      v_message := format('La misión %s falló sin una ruta de recuperación automática válida.', new.mission_id);
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
    v_message := format('La misión %s está lista para que Robert revise la propuesta.', new.mission_id);
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
      'recoverable', case when v_kind = 'error_recoverable' then true when v_kind = 'error_nonrecoverable' then false else null end
    )
  )
  on conflict (source_event_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_meditation_notifications_on_event
  on aria_internal.mission_events;

create trigger trg_meditation_notifications_on_event
after insert on aria_internal.mission_events
for each row
execute function aria_internal.materialize_meditation_notification();

comment on table aria_internal.meditation_notifications is
  'Mission 3/7 — canonical Meditation IA notification ledger; one traceable notification per relevant mission event.';
comment on column aria_internal.meditation_notifications.source_event_id is
  'Canonical mission_events.event_id used as the notification deduplication key.';
