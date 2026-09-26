'use strict';

const fs = require('node:fs');
const path = require('node:path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const migration = read('supabase/migrations/20260919210000_meditation_pwa_notifications_cutover_v1.sql');
const migrationV2 = read('supabase/migrations/20260920002111_meditation_pwa_notifications_cutover_v2.sql');
const finalCutover = read('supabase/migrations/20260926133000_meditation_android_notification_pwa_final_cutover.sql');
const agent = read('agents/termux/aria-agent.js');
const api = read('supabase/functions/aria-app-api-v3/index.ts');
const app = read('pwa/src/App.tsx');
const helper = read('pwa/src/notifications.ts');
const sw = read('pwa/public/sw.js');

assert(migration.includes('drop trigger if exists trg_meditation_android_notification_delivery'), 'legacy Android notification trigger not retired in V1 contract');
assert(migrationV2.includes('drop trigger if exists trg_meditation_android_notification_delivery'), 'definitive V2 notification trigger retirement missing');
assert(migrationV2.includes('pwa_notification_cutover_v2'), 'definitive V2 cutover marker missing');

assert(finalCutover.includes('drop trigger if exists trg_meditation_android_notification_delivery_v2'), 'final Termux-v2 trigger retirement missing');
assert(finalCutover.includes('drop function if exists aria_internal.enqueue_meditation_android_notification_jobs_v2'), 'final Termux-v2 function retirement missing');
assert(finalCutover.includes('meditation_android_termux_transport_retired_v2'), 'final Android transport retirement marker missing');
assert(finalCutover.includes('status = \'cancelled\''), 'final legacy job cancellation missing');

assert(agent.includes("job.operation === 'android.notification'"), 'generic Android notification operation must remain available for non-Meditation uses');
assert(api.includes('meditationNotificationsForUser'), 'user-scoped notification reader missing');
assert(api.includes('markMeditationNotificationsReadForUser'), 'user-scoped notification ack missing');
assert(app.includes("from './notifications'"), 'PWA notification helper import missing');
assert(app.includes('PwaNotificationCenter'), 'PWA notification center missing');
assert(app.includes('/meditation/notifications'), 'PWA notification polling missing');
assert(app.includes('/meditation/notifications/read'), 'PWA notification read action missing');
assert(helper.includes('navigator.serviceWorker'), 'service-worker notification helper missing');
assert(helper.includes('showNotification'), 'persistent PWA notification call missing');
assert(helper.includes('/pwa/#notification='), 'notification deep link missing');
assert(sw.includes('notificationclick'), 'service-worker notificationclick handler missing');
assert(sw.includes('/pwa/#notification='), 'service-worker notification target missing');

console.log('MEDITATION IA ANDROID NOTIFICATIONS FINAL CONTRACT: PASS');
console.log(JSON.stringify({
  canonical_ledger: true,
  android_native_delivery: 'pwa-service-worker',
  termux_meditation_delivery: false,
  persistent_notifications: true,
  click_through: true,
  user_scoped_read_ack: true,
  final_cutover: true
}, null, 2));
