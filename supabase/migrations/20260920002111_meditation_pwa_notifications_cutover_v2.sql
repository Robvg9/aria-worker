-- Mission 3/7 — definitive PWA notification cutover V2.
-- Unique content hash: this migration must execute even if an older remote migration
-- was incorrectly matched by content hash.
drop trigger if exists trg_meditation_android_notification_delivery
  on aria_internal.meditation_notifications;

drop function if exists aria_internal.enqueue_android_notification_jobs();

update aria_internal.execution_jobs
set
  status = 'cancelled',
  completed_at = now(),
  stderr = 'legacy meditation Android notification delivery retired by definitive PWA cutover',
  result = jsonb_build_object('status', 'cancelled', 'reason', 'pwa_notification_cutover_v2'),
  updated_at = now()
where operation = 'android.notification'
  and metadata->>'source' = 'meditation_notifications'
  and status in ('queued','claimed','running');

comment on table aria_internal.meditation_notifications is
  'Mission 3/7 — canonical Meditation IA notification ledger; ARIA PWA is the only active client delivery path after definitive 2026-09-19 cutover V2.';
