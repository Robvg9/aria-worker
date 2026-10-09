'use strict';

const fs = require('node:fs');
const path = require('node:path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migration = read('supabase/migrations/20261006190000_meditation_web_push_v1.sql');
const schemaSync = read('supabase/migrations/20261006190100_meditation_web_push_schema_sync.sql');
const api = read('supabase/functions/aria-app-api-v3/index.ts');
const helper = read('pwa/src/notifications.ts');
const sw = read('pwa/public/sw.js');
const workflow = read('.github/workflows/aria-meditation-webpush-production-e2e.yml');

assert(migration.includes('meditation_push_subscriptions'), 'background push subscription table missing');
assert(migration.includes('meditation_push_deliveries'), 'push delivery evidence table missing');
assert(migration.includes('aria_get_web_push_runtime_config'), 'Vault runtime config RPC missing');
assert(migration.includes('trg_meditation_notifications_web_push'), 'notification-to-web-push trigger missing');
assert(migration.includes('aria-app-api-v3/meditation/push/dispatch'), 'push trigger must target the existing app API function');
assert(schemaSync.includes('add column if not exists active boolean'), 'production web-push schema reconciliation missing');

assert(workflow.includes('json.loads(os.environ["VERSION"]).get("build") == os.environ["GITHUB_SHA"]'), 'live Web Push gate must verify the exact deployed SHA via version.json');
assert(workflow.includes('grep -q "aria-test-catalog-version" <<<"$html"'), 'live Web Push gate must confirm the PWA test catalog is present');
assert(!workflow.includes('grep -q "$GITHUB_SHA" <<<"$html"'), 'exact SHA must not depend on cached HTML duplicating version.json');

assert(api.includes('npm:web-push@3.6.7'), 'server-side Web Push implementation missing');
assert(api.includes('/meditation/push/status'), 'PWA Web Push status endpoint missing');
assert(api.includes('/meditation/push/subscribe'), 'PWA Web Push subscribe endpoint missing');
assert(api.includes('/meditation/push/unsubscribe'), 'PWA Web Push unsubscribe endpoint missing');
assert(api.includes('/meditation/push/dispatch'), 'internal background Web Push dispatch endpoint missing');
assert(api.includes('x-aria-webpush-secret'), 'internal Web Push dispatch authentication missing');
assert(api.includes('aria_get_web_push_runtime_config'), 'server-side Web Push must read VAPID secrets from Vault');

assert(helper.includes('PushManager'), 'browser PushManager integration missing');
assert(helper.includes('pushManager.subscribe'), 'PWA must create a persistent push subscription');
assert(helper.includes('applicationServerKey'), 'VAPID public key must be bound to the subscription');
assert(helper.includes('/meditation/push/subscribe'), 'PWA must persist subscriptions server-side');
assert(helper.includes('/meditation/push/status'), 'PWA must obtain live VAPID configuration');
assert(helper.includes("userVisibleOnly: true"), 'Web Push subscription must require user-visible notifications');

assert(sw.includes("addEventListener('push'"), 'service worker push event handler missing');
assert(sw.includes('self.registration.showNotification'), 'service worker must display background notifications');
assert(sw.includes('notification_id'), 'push payload must preserve notification identity');
assert(sw.includes('/pwa/#notification='), 'background notification deep link missing');

console.log('MEDITATION IA BACKGROUND WEB PUSH CONTRACT: PASS');
console.log(JSON.stringify({
  persistent_subscription: true,
  server_side_vapid: true,
  database_trigger: true,
  delivery_evidence: true,
  closed_pwa_handler: true
}, null, 2));
