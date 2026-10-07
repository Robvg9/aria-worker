create or replace function aria_internal.supersede_mission_success_notifications_on_failure()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'aria_internal'
as $$
begin
  if new.kind in ('error_recoverable','error_nonrecoverable','mission_blocked','payment_or_credential_block')
     and new.mission_id is not null then
    update aria_internal.meditation_notifications
       set metadata = coalesce(metadata, '{}'::jsonb)
                     || jsonb_build_object(
                          'superseded_by_failure', true,
                          'superseded_at', new.created_at,
                          'superseded_by_notification_id', new.notification_id
                        ),
           read_at = coalesce(read_at, new.created_at)
     where mission_id = new.mission_id
       and kind = 'mission_completed_verified'
       and created_at <= new.created_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_supersede_mission_success_notifications_on_failure
  on aria_internal.meditation_notifications;

create trigger trg_supersede_mission_success_notifications_on_failure
after insert on aria_internal.meditation_notifications
for each row execute function aria_internal.supersede_mission_success_notifications_on_failure();
