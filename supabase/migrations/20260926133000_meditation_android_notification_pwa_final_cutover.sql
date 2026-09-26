-- Mission 3/7 corrective cutover.
-- The Android Termux notification executable on the current Android runtime is
-- not a reliable notification transport (its bundled getopt path is incompatible).
-- ARIA's supported Android notification channel is the PWA service-worker
-- notification path, which uses the browser's native Android notification stack.
drop trigger if exists trg_meditation_android_notification_delivery_v2
  on aria_internal.meditation_notifications;

drop function if exists aria_internal.enqueue_meditation_android_notification_jobs_v2();

update aria_internal.execution_jobs
set
  status = 'cancelled',
  completed_at = now(),
  stderr = 'mission 3/7 corrective cutover: Termux notification transport retired; PWA notification channel is canonical',
  result = jsonb_build_object(
    'status','cancelled',
    'reason','meditation_android_termux_transport_retired_v2'
  ),
  updated_at = now()
where operation = 'android.notification'
  and metadata->>'delivery_version' = 'v2'
  and status in ('queued','claimed','running');

comment on table aria_internal.meditation_notifications is
  'Mission 3/7 — canonical Meditation IA notification ledger; Android delivery uses the ARIA PWA service-worker notification channel.';
