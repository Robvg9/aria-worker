-- Mission 3/7 — cutover from legacy Termux notification delivery to the canonical ARIA PWA.
-- The canonical notification ledger remains intact; only the Android Termux delivery trigger is retired.
drop trigger if exists trg_meditation_android_notification_delivery
  on aria_internal.meditation_notifications;

drop function if exists aria_internal.enqueue_android_notification_jobs();

comment on table aria_internal.meditation_notifications is
  'Mission 3/7 — canonical Meditation IA notification ledger; PWA delivery is the active client path after the 2026-09-19 cutover.';


-- Prevent already-queued legacy deliveries from reaching Termux after the cutover.
update aria_internal.execution_jobs
set
  status = 'cancelled',
  completed_at = now(),
  stderr = 'legacy meditation Android notification delivery retired; PWA notification center is now canonical',
  result = jsonb_build_object('status', 'cancelled', 'reason', 'pwa_notification_cutover'),
  updated_at = now()
where operation = 'android.notification'
  and metadata->>'source' = 'meditation_notifications'
  and status = 'queued';
