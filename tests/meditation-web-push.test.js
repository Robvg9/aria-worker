'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
const e2e = read('rwht/pc-browser/rwht-meditation-pwa-e2e.mjs');

assert(e2e.includes('form.authCard input[aria-label="Correo"]'), 'Web Push E2E must scope ARIA email selection to the ARIA auth card');
assert(e2e.includes('form.authCard input[type="password"]'), 'Web Push E2E must not select project-specific password fields as ARIA credentials');
assert(e2e.includes('form.authCard button[type="submit"]'), 'Web Push E2E must submit only ARIA auth form controls');
assert(e2e.includes("aria_auth_rejected:"), 'Web Push E2E must preserve visible ARIA login rejection evidence');
assert(!e2e.includes("return !pwd;"), 'Web Push E2E must prove persisted ARIA session rather than waiting for unrelated password fields to disappear');

assert(e2e.includes('console_error_details:[]'), 'Web Push E2E must persist console error messages, not only an error count');
assert(e2e.includes('report.console_error_details = ariaConsoleErrors.slice()'), 'Web Push E2E must write ARIA-origin console error detail into the evidence report');
assert(e2e.includes('report.external_console_errors = externalConsoleErrors.length'), 'Web Push E2E must count and distinguish external preview console errors');
assert(e2e.includes('report.external_console_error_details = externalConsoleErrors.slice()'), 'Web Push E2E must persist external preview console error details separately');
assert(e2e.includes('source_origin: sourceOrigin'), 'Web Push E2E must record the console error source origin');
assert(e2e.includes('report.page_error_details = pageErrors.slice()'), 'Web Push E2E must write page error detail into the evidence report');
assert(e2e.includes('report.failed_response_details = failedResponses.slice()'), 'Web Push E2E must write failed response detail into the evidence report');
const pushOnlyStart = e2e.indexOf("if (envBool('RWHT_BACKGROUND_PUSH_ONLY', false))");
const pushOnlyEnd = e2e.indexOf('await controllerPage.close();', pushOnlyStart);
assert(pushOnlyStart >= 0 && pushOnlyEnd > pushOnlyStart, 'Web Push push-only branch must be present and bounded');
const pushOnlyBranch = e2e.slice(pushOnlyStart, pushOnlyEnd);
const errorGate = pushOnlyBranch.indexOf('if (report.page_errors || report.console_errors || report.failed_responses)');
const earlyReturn = pushOnlyBranch.indexOf('return;');
assert(errorGate >= 0 && earlyReturn > errorGate, 'push-only Web Push E2E must enforce the zero browser-error gate before returning');
assert(pushOnlyBranch.includes('WEBPUSH_E2E_BROWSER_DIAGNOSTICS='), 'push-only Web Push E2E must emit full browser diagnostics into workflow logs');

assert(e2e.includes('const timeoutMs = 45000'), 'Web Push API checks must use a finite 45s ceiling matching observed production latency');
assert(e2e.includes('web_push_config_elapsed_ms'), 'Web Push E2E must persist config endpoint latency');
assert(e2e.includes('WEBPUSH_E2E_CONFIG_OK elapsed_ms='), 'Web Push E2E must log config endpoint latency');
assert(e2e.includes('elapsed_ms: Math.round(performance.now() - startedAt)'), 'Web Push API response and failure records must include elapsed time');
assert(e2e.includes('timeout_ms: timeoutMs'), 'Web Push API report must preserve its timeout threshold');



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

try { new vm.Script(sw, { filename: 'pwa/public/sw.js' }); } catch (error) { throw new Error('Service Worker source must parse before deployment: ' + String(error?.message || error)); }
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
