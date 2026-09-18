-- Mission 3/7 — Android notification delivery through the canonical execution queue.
-- Notifications are materialized in the canonical ledger first; this trigger only schedules
-- governed device jobs. Delivery itself happens on the Android Termux agent.
create or replace function aria_internal.enqueue_android_notification_jobs()
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
      and coalesce(lower(status), 'offline') not in ('revoked', 'disabled')
  loop
    v_job_id := 'meditation-notification-'
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
        'governance', 'meditation-ia'
      ),
      'queued',
      jsonb_build_object(
        'source', 'meditation_notifications',
        'notification_id', new.notification_id::text,
        'source_event_id', new.source_event_id,
        'delivery_channel', 'android-termux'
      ),
      v_job_id
    )
    on conflict (job_id) do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_meditation_android_notification_delivery
  on aria_internal.meditation_notifications;

create trigger trg_meditation_android_notification_delivery
after insert on aria_internal.meditation_notifications
for each row
execute function aria_internal.enqueue_android_notification_jobs();

update aria_internal.device_registry
set capabilities = case
  when capabilities ? 'notifications.push' then capabilities
  else capabilities || '["notifications.push"]'::jsonb
end
where agent_type = 'android-termux';

comment on function aria_internal.enqueue_android_notification_jobs() is
  'Mission 3/7 — enqueue deterministic, governed Android notification jobs for every registered non-revoked Termux device.';
