'use strict';

const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migration = read('supabase/migrations/20260919210000_meditation_pwa_notifications_cutover_v1.sql');
const migrationV2 = read('supabase/migrations/20260920002111_meditation_pwa_notifications_cutover_v2.sql');
const agent = read('agents/termux/aria-agent.js');
const api = read('supabase/functions/aria-app-api-v3/index.ts');
const app = read('pwa/src/App.tsx');
const helper = read('pwa/src/notifications.ts');
const sw = read('pwa/public/sw.js');
const meditationE2E = read('rwht/pc-browser/rwht-meditation-pwa-e2e.mjs');

assert(migration.includes('drop trigger if exists trg_meditation_android_notification_delivery'), 'legacy Android notification trigger not retired in V1 contract');
assert(migration.includes('drop function if exists aria_internal.enqueue_android_notification_jobs'), 'legacy Android notification enqueue function not retired in V1 contract');
assert(migrationV2.includes('drop trigger if exists trg_meditation_android_notification_delivery'), 'definitive V2 notification trigger retirement missing');
assert(migrationV2.includes('drop function if exists aria_internal.enqueue_android_notification_jobs'), 'definitive V2 notification function retirement missing');
assert(migrationV2.includes('pwa_notification_cutover_v2'), 'definitive V2 cutover marker missing');

assert(agent.includes("job.operation === 'android.notification'"), 'legacy Android notification operation must remain available for non-Meditation uses');
assert(migration.includes("status = 'cancelled'"), 'legacy queued Termux deliveries are not cancelled');
assert(migration.includes("metadata->>'source' = 'meditation_notifications'"), 'legacy meditation notification jobs are not scoped for cancellation');

assert(api.includes('path.endsWith("/meditation/notifications")') || api.includes("path.endsWith('/meditation/notifications')"), 'PWA notification GET route missing');
assert(api.includes('path.endsWith("/meditation/notifications/read")') || api.includes("path.endsWith('/meditation/notifications/read')"), 'PWA notification read route missing');
assert(api.includes('meditationNotificationsForUser'), 'user-scoped notification reader missing');
assert(api.includes('markMeditationNotificationsReadForUser'), 'user-scoped notification ack missing');

assert(app.includes("from './notifications'"), 'PWA notification helper import missing');
assert(app.includes('PwaNotificationCenter'), 'PWA notification center missing');
assert(app.includes('const selectedLive = selected'), 'selected notification must derive from current ledger state');
assert(app.includes('setSelected(current => current?.notification_id === item.notification_id'), 'selected notification read state must update immediately');
assert(app.includes('const visibleItems = historyExpanded ? items : items.slice(0, 8)'), 'notification history must be compact by default');
assert(app.includes("Ver historial completo · ' + items.length"), 'full notification history must remain accessible');
assert(app.includes('/meditation/notifications'), 'PWA notification polling missing');
assert(app.includes('/meditation/notifications/read'), 'PWA notification read action missing');

assert(helper.includes('navigator.serviceWorker'), 'service-worker notification helper missing');
assert(helper.includes('showNotification'), 'persistent PWA notification call missing');
assert(helper.includes('ensurePwaWebPushSubscription'), 'background Web Push subscription sync missing');
assert(helper.includes('PushManager'), 'background Web Push API surface missing');
assert(helper.includes('/pwa/#notification='), 'notification deep link missing');

assert(sw.includes('notificationclick'), 'service-worker notificationclick handler missing');
assert(app.includes("String(hash).startsWith('#notification=')"), 'native notification hash must route to Meditation IA');
assert(app.includes("return { page: 'meditation', screen: 0, newMission: false };"), 'notification hash must mount the notification-owning page');
assert(meditationE2E.includes('dispatchNotificationClickViaServiceWorker'), 'authenticated E2E must exercise Service Worker notificationclick');
assert(meditationE2E.includes('verified_notification_for_clickthrough_not_found'), 'click-through E2E must use a real persisted verified notification');
assert(meditationE2E.includes("getByRole('button', { name:'Abrir misión completa' })"), 'click-through E2E must open the full mission detail');
assert(meditationE2E.includes('notification_click_through_verified'), 'click-through proof must be recorded in the RWHT evidence');
assert(app.includes('const livePermission = typeof window !== \'undefined\' && \'Notification\' in window'));
assert(app.includes('const recentUnread = compact.filter'));
assert(app.includes('const notificationCandidates = firstSync.current'));
assert(app.includes('if (shown) seenSet.add(String(item.notification_id))'));
assert(app.includes('if (livePermission !== \'granted\' && !item.read_at) return'));
console.log('PWA FIRST-SYNC NOTIFICATION DELIVERY REGRESSION: PASS');
assert(sw.includes('/pwa/#notification='), 'service-worker notification target missing');

console.log('MEDITATION IA PWA NOTIFICATIONS CUTOVER CONTRACT: PASS');
console.log(JSON.stringify({
  canonical_ledger: true,
  termux_meditation_delivery: false,
  pwa_persistent_notifications: true,
  click_through: true,
  user_scoped_read_ack: true
}, null, 2));
