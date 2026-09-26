-- Mission 3/7 — restore governed Android notifications as a secondary delivery channel.
-- The ARIA PWA notification center remains the canonical user-facing web channel.
-- This migration intentionally replaces the retired 2026-09-19 Android trigger with a
-- current online-device path that consumes the same canonical notification ledger.
create or replace function aria_internal.enqueue_meditation_android_notification_jobs_v2()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, aria_internal
as $$
declare
  d record;
  v_job_id text;
  v_payload jsonb;
  v_priority text;
begin
  v_priority := case new.severity
    when 'error' then 'max'
    when 'warning' then 'high'
    when 'success' then 'default'
    else 'default'
  end;

  v_payload := jsonb_build_object(
    'notification_id', new.notification_id::text,
    'title', new.title,
    'message', new.message,
    'severity', new.severity,
    'kind', new.kind,
    'action', coalesce(new.action, ''),
    'mission_id', new.mission_id,
    'priority', v_priority
  );

  for d in
    select device_id
    from aria_internal.device_registry
    where agent_type = 'android-termux'
      and status = 'online'
      and coalesce(capabilities, '[]'::jsonb) ? 'notifications.push'
  loop
    v_job_id := 'meditation-android-notification-v2-'
      || replace(new.notification_id::text, '-', '')
      || '-'
      || substr(md5(d.device_id), 1, 12);

    insert into aria_internal.execution_jobs (
      job_id,
      mission_id,
      device_id,
      operation,
      command,
      cwd,
      timeout_ms,
      policy,
      status,
      metadata,
      idempotency_key
    )
    values (
      v_job_id,
      new.mission_id,
      d.device_id,
      'android.notification',
      v_payload::text,
      null,
      30000,
      jsonb_build_object(
        'risk', 'LOW',
        'scope', 'notification-only',
        'governance', 'meditation-ia',
        'delivery_version', 'v2'
      ),
      'queued',
      jsonb_build_object(
        'source', 'meditation_notifications',
        'notification_id', new.notification_id::text,
        'source_event_id', new.source_event_id,
        'delivery_channel', 'android-termux',
        'delivery_version', 'v2'
      ),
      v_job_id
    )
    on conflict (job_id) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_meditation_android_notification_delivery_v2
  on aria_internal.meditation_notifications;

create trigger trg_meditation_android_notification_delivery_v2
after insert on aria_internal.meditation_notifications
for each row
execute function aria_internal.enqueue_meditation_android_notification_jobs_v2();

update aria_internal.device_registry
set capabilities = case
  when capabilities ? 'notifications.push' then capabilities
  else capabilities || '["notifications.push"]'::jsonb
end
where agent_type = 'android-termux';

comment on function aria_internal.enqueue_meditation_android_notification_jobs_v2() is
  'Mission 3/7 — secondary Android notification delivery from the canonical Meditation IA notification ledger. Only online Termux devices advertising notifications.push are targeted.';

comment on table aria_internal.meditation_notifications is
  'Mission 3/7 — canonical Meditation IA notification ledger; delivered through the ARIA PWA notification center and, when an eligible device is online, the governed Android notification channel.';
