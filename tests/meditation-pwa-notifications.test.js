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
const agent = read('agents/termux/aria-agent.js');
const api = read('supabase/functions/aria-app-api-v3/index.ts');
const app = read('pwa/src/App.tsx');
const helper = read('pwa/src/notifications.ts');
const sw = read('pwa/public/sw.js');

assert(migration.includes('drop trigger if exists trg_meditation_android_notification_delivery'), 'legacy Android notification trigger not retired');
assert(migration.includes('drop function if exists aria_internal.enqueue_android_notification_jobs'), 'legacy Android notification enqueue function not retired');

assert(agent.includes("job.operation === 'android.notification'"), 'legacy Android notification operation must remain available for non-Meditation uses');
assert(migration.includes("status = 'cancelled'"), 'legacy queued Termux deliveries are not cancelled');
assert(migration.includes("metadata->>'source' = 'meditation_notifications'"), 'legacy meditation notification jobs are not scoped for cancellation');

assert(/path\.endsWith\([\"']\\/meditation\\/notifications[\"']\)/.test(api), 'PWA notification GET route missing');
assert(/path\.endsWith\([\"']\\/meditation\\/notifications\\/read[\"']\)/.test(api), 'PWA notification read route missing');
assert(api.includes('meditationNotificationsForUser'), 'user-scoped notification reader missing');
assert(api.includes('markMeditationNotificationsReadForUser'), 'user-scoped notification ack missing');

assert(app.includes("from './notifications'"), 'PWA notification helper import missing');
assert(app.includes('PwaNotificationCenter'), 'PWA notification center missing');
assert(app.includes('/meditation/notifications'), 'PWA notification polling missing');
assert(app.includes('/meditation/notifications/read'), 'PWA notification read action missing');

assert(helper.includes('ServiceWorkerRegistration'), 'service-worker notification helper missing');
assert(helper.includes('showNotification'), 'persistent PWA notification call missing');
assert(helper.includes('/pwa/#notification='), 'notification deep link missing');

assert(sw.includes('notificationclick'), 'service-worker notificationclick handler missing');
assert(sw.includes('/pwa/#notification='), 'service-worker notification target missing');

console.log('MEDITATION IA PWA NOTIFICATIONS CUTOVER CONTRACT: PASS');
console.log(JSON.stringify({
  canonical_ledger: true,
  termux_meditation_delivery: false,
  pwa_persistent_notifications: true,
  click_through: true,
  user_scoped_read_ack: true
}, null, 2));
