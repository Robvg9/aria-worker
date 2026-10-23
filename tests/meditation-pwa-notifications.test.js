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
const serverSideMigration = read('supabase/migrations/20261012110400_meditation_notifications_server_side_rpc_v1.sql');
const exactNotificationMigration = read('supabase/migrations/20261023020000_meditation_notification_by_id_v1.sql');
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
assert(api.includes('meditationNotificationsForUser'), 'user-scoped notification reader missing');
assert(api.includes('markMeditationNotificationsReadForUser'), 'user-scoped notification ack missing');
assert(api.includes('aria_meditation_notifications_for_user_v1'), 'notification GET must use the server-side SQL RPC');
assert(api.includes('aria_mark_meditation_notifications_read_for_user_v1'), 'notification read ack must use the server-side SQL RPC');
assert(exactNotificationMigration.includes('CREATE OR REPLACE FUNCTION aria_internal.aria_meditation_notification_by_id_for_user_v1'), 'exact notification lookup RPC migration missing');
assert(exactNotificationMigration.includes('GRANT EXECUTE ON FUNCTION aria_internal.aria_meditation_notification_by_id_for_user_v1(uuid, uuid) TO service_role'), 'exact notification lookup must be service-role only');
assert(api.includes('aria_meditation_notification_by_id_for_user_v1'), 'exact notification lookup must use the scoped SQL RPC');
assert(api.includes('async function meditationNotificationByIdForUser'), 'exact notification lookup handler missing');
assert(api.includes('invalid_notification_id'), 'exact notification route must validate UUID input');
assert(!api.includes('async function meditationOwnedMissionIds'), 'notification API must not materialize large mission ID arrays in Edge Function memory');
assert(serverSideMigration.includes('CREATE OR REPLACE FUNCTION aria_internal.aria_meditation_notifications_for_user_v1'), 'server-side notification reader RPC migration missing');
assert(serverSideMigration.includes('CREATE OR REPLACE FUNCTION aria_internal.aria_mark_meditation_notifications_read_for_user_v1'), 'server-side notification read RPC migration missing');
assert(serverSideMigration.includes('GRANT EXECUTE ON FUNCTION aria_internal.aria_meditation_notifications_for_user_v1(uuid, boolean, integer) TO service_role'), 'notification RPC must be service-role only');
assert(serverSideMigration.includes('GRANT EXECUTE ON FUNCTION aria_internal.aria_mark_meditation_notifications_read_for_user_v1(uuid, uuid[], boolean) TO service_role'), 'notification read RPC must be service-role only');
const notificationRouteStart = api.indexOf('if (req.method === "GET" && path.endsWith("/meditation/notifications"))');
const notificationRouteEnd = api.indexOf('if (req.method === "GET" && path.endsWith("/meditation/push/status"))', notificationRouteStart);
const notificationRoute = api.slice(notificationRouteStart, notificationRouteEnd);
assert(notificationRoute.includes('meditation_notifications_get_failed'), 'notification GET route must log controlled failures');
assert(notificationRoute.includes('meditation_notifications_unavailable'), 'notification GET route must return a controlled error on failure');
assert(api.includes('.select("event_id,mission_id,payload")'), 'completion notification reconciliation must inspect persisted mission verification payloads');
assert(api.includes('const latestVerificationByMission=new Map<string,{eventId:string;verified:boolean}>();'), 'notification reconciliation must retain the latest verification event proof');
assert(api.includes('const verified=payload.verified===true||String(payload.verified||"").toLowerCase()==="true";'), 'only an explicit verified=true payload may validate completion proof');
assert(api.includes('&& latestVerification?.eventId===sourceEventId'), 'completion notification must reference the latest verification event');
assert(api.includes('&& latestVerification?.verified===true;'), 'a succeeded mission notification must be suppressed when latest verification payload is not verified=true');


assert(app.includes("from './notifications'"), 'PWA notification helper import missing');
assert(app.includes('PwaNotificationCenter'), 'PWA notification center missing');
assert(app.includes('const [missionDetailOpen, setMissionDetailOpen] = useState(false);'), 'mission modal visibility must be separate from cached mission detail data');
assert(app.includes('async function openNotification(item: PwaNotificationItem, openMissionAfterSelection = false)'), 'native click path must be distinguishable from notification-list selection');
assert(app.includes('await openNotification(item, true);'), 'native notification deep links must open mission detail directly');
assert(app.includes("api('/meditation/notifications/' + encodeURIComponent(id), session.accessToken)"), 'notification deep links must fetch an exact notification when it is outside the recent ledger page');
assert(app.includes('processingNotificationHash.current === id'), 'notification hash processing must be idempotent while exact lookup is in flight');
assert(!app.includes('if (!id || !items.length) return;'), 'deep-link resolution must not depend on the notification ledger being populated first');
assert(app.includes('{missionDetail && missionDetailOpen && ('), 'mission detail must render only when explicitly opened, avoiding stacked modal backdrops');
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
assert(app.includes("window.addEventListener('hashchange', openNotificationFromHash)"), 'notification deep links must be processed when a hash changes in an already-open PWA');
assert(app.includes("window.removeEventListener('hashchange', openNotificationFromHash)"), 'notification hash listener must be cleaned up');
assert(app.includes("return { page: 'meditation', screen: 0, newMission: false };"), 'notification hash must mount the notification-owning page');
assert(meditationE2E.includes('dispatchNotificationClickViaServiceWorker'), 'authenticated E2E must exercise Service Worker notificationclick');
assert(meditationE2E.includes("await controllerPage.goto(base + '#meditation'"), 'push probe must attach CDP to the real PWA origin');
assert(meditationE2E.includes("waitUntil:'load'"), 'push probe must wait for the production window.load service-worker registration handler');
assert(meditationE2E.includes("fetch('/pwa/version.json', { cache:'no-store' })"), 'push probe must recover the exact versioned worker script from the canonical live build endpoint');
assert(meditationE2E.includes("navigator.serviceWorker.register('/pwa/sw-' + build + '.js', { scope:'/pwa/' })"), 'push probe must register the canonical versioned PWA worker when the new test page has no registration yet');
assert(meditationE2E.includes('pwa_service_worker_not_active'), 'push probe must require an active PWA service worker before injecting the event');
assert(meditationE2E.includes('WEBPUSH_E2E_CONTROL_PAGE_CLOSED_BEFORE_RECEIPT'), 'push receipt must be read after the helper page is closed');
assert(meditationE2E.includes("new ExtendableEvent('notificationclick')"), 'click-through test must preserve native Service Worker waitUntil lifecycle');
assert(meditationE2E.includes('verified_notification_for_clickthrough_not_found'), 'click-through E2E must use a real persisted verified notification');
assert(meditationE2E.includes("await probePage.locator('.notificationBackdrop').waitFor({ state:'detached'"), 'native notification click-through must close its panel before mission detail is checked');
assert(meditationE2E.includes('notification_click_did_not_mark_read_in_server_ledger'), 'click-through E2E must verify server-side read persistence');
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
