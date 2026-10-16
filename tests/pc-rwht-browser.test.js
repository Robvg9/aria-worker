'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(path.join(__dirname, '..', 'rwht', 'pc-browser', 'rwht-pc-browser.mjs'), 'utf8');
const pwaIndex = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'index.html'), 'utf8');
const pwaFastDeploy = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'aria-pwa-fast-deploy.yml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rwht', 'pc-browser', 'package.json'), 'utf8'));
const missionRunnerFixes = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'forensic-continuity-fixes.ts'),
  'utf8',
);

assert.match(runner, /aria-pc-browser-rwht-v1.5.7/);
assert.match(runner, /playwright/);
assert.match(runner, /DEFAULT_ROUTES/);
assert.match(runner, /aria\.robvg9\.workers\.dev\/pwa/);
assert.match(runner, /SAFE_BLOCKED/);
assert.match(runner, /EXTERNAL_CONNECTION_AUTH/);
assert.match(runner, /function isBattleCruiserExternalAuthField/);
assert.match(runner, /battleCruiserExternalAuthSnapshot/);
assert.match(runner, /not_attempted_external_auth_boundary/);
assert.match(runner, /external_integration_auth_requires_human_gate/);
assert.match(runner, /external_backend_connection/);
assert.match(runner, /SECRET/);
assert.match(runner, /SAFE_MUTATION/);
assert.ok(runner.includes("class_name: String(el.getAttribute('class') || '').slice(0, 120)"));
assert.ok(runner.includes('function isSafeReadOnlyMeditationAction(control, routeHash, label)'));
assert.ok(runner.includes('isSafeReadOnlyMeditationAction(original, routeHash, originalLabel)'));
assert.ok(runner.includes('async function readOnlyActionUiState(page)'), 'Read-only UI state must be observable for asynchronous detail navigation');
assert.ok(runner.includes('async function waitForReadOnlyActionEffect(page, before, timeoutMs)'), 'Read-only mission details must be awaited before scoring visible effects');
assert.ok(runner.includes('Math.max(35000, config.action_timeout_ms, config.settle_ms)'), 'Read-only detail navigation must wait for async mission APIs');
assert.ok(runner.includes('await closeDialogs(page).catch(() => false);'), 'A failed or timed-out click must clean up late-opening mission detail overlays');
assert.ok(runner.includes("const meditationClasses = String(control.class_name || '').split(/\\s+/);"), 'Queue mutation guard must split class names correctly');
assert.ok(runner.includes('async function expandMeditationDetailsForDiscovery(page, routeHash)'), 'Meditation detail accordions must be expanded before the initial control inventory');
assert.ok(runner.includes("page.locator('.meditationMoreDetails').evaluateAll("), 'RWHT must open the outer MORE INFORMATION panel and nested mission lists read-only');
const meditationAuditRoute = runner.indexOf('async function auditRoute(page, url, routeIndex, config)');
const meditationExpansion = runner.indexOf('await expandMeditationDetailsForDiscovery(page, routeForReadiness);', meditationAuditRoute);
const firstMeditationInventory = runner.indexOf('const initialControls = authenticationBoundaryFailed', meditationAuditRoute);
assert.ok(meditationExpansion > meditationAuditRoute && meditationExpansion < firstMeditationInventory, 'expand Meditation accordions before discoverInteractive snapshots hidden rows');
assert.match(runner, /reason: 'queue_order_mutation_requires_human_gate'/, 'priority buttons must remain blocked in a read-only audit');
assert.ok(runner.includes('async function reopenReadOnlyMeditationDetails(page, control, routeHash)'), 'PC RWHT must reopen read-only Meditation detail panels before replay');
assert.ok(runner.includes("if (routeHash !== '#meditation' || control?.tag !== 'button') return 0;"), 'detail reopening must be limited to Meditation buttons');
assert.ok(runner.includes("String(control.selector_hint || '').includes('details')"), 'detail reopening must require an identified nested details row');
assert.ok(runner.includes("const classes = String(control.class_name || '').split(/\\s+/);"), 'detail reopening must split multi-class rows on whitespace so row/button classes are recognized');
assert.ok(runner.includes("page.locator('details').evaluateAll("), 'detail reopening must restore closed native details before rediscovery');
const meditationReplayLoop = runner.indexOf('for (let index = 0; index < maxControls; index += 1) {');
const reopenDetailsCall = runner.indexOf('await reopenReadOnlyMeditationDetails(page, original, routeHash);', meditationReplayLoop);
const rediscoverControls = runner.indexOf('let controlsNow = await discoverInteractive(page);', meditationReplayLoop);
assert.ok(reopenDetailsCall > meditationReplayLoop && reopenDetailsCall < rediscoverControls, 'reopen Meditation details before rediscovering controls after reload');
const meditationSoftReset = runner.indexOf("if (routeHash === '#meditation') {", meditationReplayLoop);
assert.ok(meditationSoftReset > meditationReplayLoop, 'Meditation must have a route-specific soft-reset strategy');
const meditationRouteDrift = runner.indexOf('if (currentRouteHash !== routeHash) {', meditationSoftReset);
const meditationCloseInPlace = runner.indexOf('await closeDialogs(page);', meditationSoftReset);
const reloadAfterRouteDrift = runner.indexOf("await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms }).catch(() => {});", meditationRouteDrift);
assert.ok(meditationRouteDrift > meditationSoftReset && meditationCloseInPlace > meditationSoftReset && reloadAfterRouteDrift > meditationRouteDrift, 'Meditation must close read-only modals in-place and reload only after route drift');
assert.ok(runner.includes('re-fetches /api/meditation/overview'), 'Meditation row replay must avoid refetching the overview on each control');
assert.ok(runner.includes("const requiresDynamicMeditationIdentity = routeHash === '#meditation'"), 'dynamic Meditation rows must be detected for target-specific hydration');
assert.ok(runner.includes('if (exact || (!requiresDynamicMeditationIdentity && controlsNow.length > index)) break;'), 'dynamic row hydration must wait for the exact target instead of unrelated static controls');

assert.ok(runner.includes('const safeReadOnlyAction = isSafeReadOnlyMeditationAction(control, routeHash, label);'));
assert.ok(runner.includes('isSafeReadOnlyMeditationAction(control, routeHash, label)'));
assert.ok(runner.includes('isSafeReadOnlyMeditationAction(control, routeForReadiness, safeLabel(control.name))'));
assert.ok(runner.includes('if ((dynamicMissionSnapshot || dynamicQueueSnapshot) && !safeReadOnlyAction)'));
assert.ok(runner.includes("(classes.includes('row') || classes.includes('queueMissionMain'))"));
assert.match(runner, /Capture the real interaction result BEFORE cleanup closes the modal/);
assert.ok(runner.includes('async function visibleBlockingSurfaceSignature(page)'), 'RWHT must observe visible modal/dialog surfaces before cleanup');
const testControlStart = runner.indexOf('async function testControl(page, control, config)');
const measuredDialogSnapshot = Math.max(
  runner.indexOf('const afterDialogs = await visibleBlockingSurfaceSignature(page);', testControlStart),
  runner.indexOf('let afterDialogs = await visibleBlockingSurfaceSignature(page);', testControlStart),
);
const closeAfterMeasurement = runner.indexOf('await closeDialogs(page);', measuredDialogSnapshot);
assert.ok(measuredDialogSnapshot > testControlStart && closeAfterMeasurement > measuredDialogSnapshot, 'RWHT must measure visible dialog effects before closing them');
assert.match(runner, /reason: 'read_only_action_no_visible_effect'/, 'safe read-only Meditation clicks must fail if no visible effect is observed');
assert.ok(runner.includes('await closeDialogs(page);'), 'close read-only detail overlays after measuring their effect');
const dialogDismissalImplementation = runner.slice(runner.indexOf('async function waitForSurfaceDismissal'), runner.indexOf('async function closeDialogs'));
assert.ok(dialogDismissalImplementation.includes('element.isConnected'), 'dialog cleanup must wait for the exact overlay handle to detach or stop intercepting');
assert.ok(dialogDismissalImplementation.includes("style.pointerEvents !== 'none'"), 'dialog dismissal must test the actual pointer-event blocker');
assert.doesNotMatch(dialogDismissalImplementation, /style\.opacity/, 'opacity zero does not guarantee that an overlay stops intercepting clicks');
const closeDialogsImplementation = runner.slice(runner.indexOf('async function closeDialogs'), runner.indexOf('async function isBattleCruiserExternalAuthField'));
assert.ok(closeDialogsImplementation.includes("const selector = '.modalBackdrop, [role=\"dialog\"], dialog[open]'"), 'dialog cleanup must be scoped to actual visible dialog surfaces');
assert.ok(closeDialogsImplementation.includes("{ name: /^(cerrar|close)$/i }"), 'dialog cleanup must use an exact close-button label within the dialog');
const serviceWorkerDeploy = pwaFastDeploy.slice(pwaFastDeploy.indexOf('name: Verify deployed versioned Service Worker JavaScript'));
assert.ok(serviceWorkerDeploy.includes('for attempt in $(seq 1 15); do'), 'versioned Service Worker LIVE smoke must retry transient edge propagation');
assert.ok(serviceWorkerDeploy.includes("grep -qiE '^content-type: *application/javascript'"), 'Service Worker smoke must require JavaScript content type');
assert.ok(serviceWorkerDeploy.includes('aria-pwa-${GITHUB_SHA}'), 'Service Worker smoke must require exact-SHA payload');
assert.ok(serviceWorkerDeploy.includes("! grep -qiE '<!doctype html|<html([ >])'"), 'Service Worker smoke must hard-reject SPA HTML fallback');
assert.ok(serviceWorkerDeploy.includes('node --check "${worker_file}"'), 'Service Worker smoke must syntax-check the fetched JS before PASS');
assert.ok(serviceWorkerDeploy.includes('::error::Versioned Service Worker did not become valid JavaScript'), 'Service Worker smoke must fail if retry budget expires');
assert.ok(closeDialogsImplementation.includes('for (let index = count - 1; index >= 0; index -= 1)'), 'dialog cleanup must close the topmost overlay first');
assert.ok(closeDialogsImplementation.includes('await waitForSurfaceDismissal(page, surface, 1800);'), 'dialog cleanup must wait for that specific overlay before re-querying the stack');
assert.match(closeDialogsImplementation, /return !remainingBlockingSurface/);
assert.match(runner, /reason: 'blocking_modal_not_dismissed'/, 'RWHT must hard-fail instead of clicking through an overlay that remains blocking');
assert.ok(runner.includes('summary.counter_reconciliation'), 'report must publish explicit counter reconciliation');
assert.ok(runner.includes('summary.counters_reconciled === true'), 'PASS requires root, route, and action counters to reconcile');
assert.ok(runner.includes('await expandMeditationDetailsForDiscovery(page, routeForReadiness);'), 'Meditation audit must inventory nested details before its first snapshot');
assert.ok(!closeDialogsImplementation.includes("page.getByRole('button', { name: /cerrar|close|cancelar|cancel/i })"), 'dialog cleanup must not click mission rows with CANCELADA labels');
const closeStaleModal = runner.indexOf("if (routeHash !== '#mission') await closeDialogs(page);", meditationReplayLoop);
assert.ok(closeStaleModal > reloadAfterRouteDrift && closeStaleModal < reopenDetailsCall, 'on non-Meditation routes, close stale dialogs after reset and before reopening nested details');
assert.match(runner, /mutation_requires_human_gate/);
assert.match(runner, /RWHT_ALLOW_MUTATIONS/);
assert.match(runner, /selector_hint/);
assert.match(runner, /RWHT_STORAGE_STATE/);
assert.match(runner, /authentication_human_gate/);
assert.match(runner, /discoverInteractive/);
assert.match(runner, /checkUx/);
assert.match(runner, /horizontal_overflow/);
assert.match(runner, /unnamed_interactive/);
assert.match(runner, /const ariaChatCta = control\.role === 'button' && \/Hablar con ARIA\/i\.test\(label\)/);
assert.match(runner, /getByRole\('button', \{ name: \/Hablar con ARIA\/i \}\)/);
assert.ok(runner.includes("const textFallback = page.locator('.dashboardScreen button')"), 'Chat CTA replay must fall back to its visible text within the home surface');
assert.ok(runner.includes(".filter({ hasText: /Hablar\\s+con\\s+ARIA/i })"), 'Chat CTA text fallback must match the stable semantic phrase');
assert.ok(runner.indexOf("const ariaChatCta = control.role === 'button'") < runner.indexOf("const semanticLocator = () =>"), 'Chat CTA detection must be in scope for both semantic and fallback locators');
assert.ok(runner.includes("const newMissionCta = control.role === 'button' && /Nueva\\s+misión/i.test(label)"), 'New Mission control must use a whitespace-tolerant semantic label match');
assert.ok(runner.includes("page.getByRole('button', { name: /Nueva\\s+misión/i }).first()"), 'New Mission replay must use a semantic Playwright role locator');
assert.ok(runner.indexOf('if (newMissionCta)') < runner.indexOf('if (!locator && !settingsDynamic && !newMissionCta && control.selector_hint)'), 'New Mission CTA must prefer semantic location over its position-based selector hint');
const authVerification = runner.slice(runner.indexOf('async function verifyAuthState'), runner.indexOf('async function waitForPwaBoot'));
assert.ok(authVerification.includes(`page.locator('form.authCard input[type="password"]')`), 'PC auth verification must ignore BattleCruiser project password fields');
assert.ok(!authVerification.includes(`page.locator('input[type="password"]')`), 'PC auth verification must not scan document-wide password fields');

assert.match(runner, /images_missing_alt/);
assert.match(runner, /unlabeled_inputs/);
assert.ok(runner.includes("const associatedLabelText = Array.from(element.labels || [])"),
  'unnamed-interactive audit must derive the accessible name from native associated labels');
assert.ok(runner.includes("if (element.labels?.length) return false;"),
  'unlabeled-input audit must recognize both wrapping labels and label[for] associations');
assert.match(runner, /controls_verified/);
assert.match(runner, /controls_blocked/);
assert.match(runner, /controls_failed/);
assert.match(runner, /coverage_ratio/);
assert.match(runner, /controls_testable/);
assert.match(runner, /controls_skipped/);
assert.match(runner, /externalPreviewConsoleErrors/);
assert.match(runner, /external_preview_console_errors/);
assert.match(runner, /internalConsoleHosts/);
assert.match(runner, /server_backed_dynamic_diagnostic_not_reproducible/);
assert.match(runner, /dynamicDiagnostic/);
assert.match(runner, /externalPreviewFailedResponses/);
assert.match(runner, /external_preview_failed_responses/);
assert.match(runner, /response\.status\(\) < 400/);
assert.match(runner, /dynamicDiagnosticSnapshot/);
assert.match(runner, /do not count it twice on replay/);
assert.match(runner, /outcome\.outcome === 'skipped' && !wasInitiallySkipped/);
assert.equal(runner.split("outcome.outcome === 'skipped' && !wasInitiallySkipped").length - 1, 2, 'Skipped replay outcomes must update counters in both control paths.');
assert.match(runner, /controls_testable = Math\.max\(0, routeResult\.controls_testable - 1\)/);
assert.match(runner, /cerrar\\s\+\(\?:la\\s\+\)\?conexión/);
assert.match(runner, /externalNavigation/);
assert.match(runner, /page_errors/);
assert.match(runner, /failed_responses/);
assert.match(runner, /RWHT_EMAIL/);
assert.match(runner, /RWHT_PASSWORD/);
assert.doesNotMatch(runner, /console\.log\([^\n]*password/i);
assert.equal(pkg.dependencies.playwright, '1.63.0');

assert.match(missionRunnerFixes, /buildDeviceEnqueuePayload/);
assert.match(missionRunnerFixes, /operation === "computer\.use\.autonomous"/);
assert.match(missionRunnerFixes, /\["goal", "mode", "start_url", "max_actions", "max_runtime_ms", "capture_screenshots"\]/);
assert.match(missionRunnerFixes, /input\[key\] = value/);
assert.match(missionRunnerFixes, /value === null \|\| value === undefined/);
assert.match(missionRunnerFixes, /key === "start_url"/);
const appApi = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'aria-app-api-v3', 'index.ts'), 'utf8');
assert.match(appApi, /aria_app_get_global_conversation/);
assert.doesNotMatch(appApi, /schema\(["']aria_app["']\)\.from\(["']conversations["']\)/);

console.log('PC BROWSER RWHT CONTRACT: PASS');

assert.match(runner, /RWHT_REQUIRE_AUTH/);
assert.match(runner, /RWHT_EXPECTED_AUTH_TEXT/);
assert.match(runner, /auth_verified/);
assert.match(runner, /authenticationBoundaryFailed/);
assert.match(runner, /Authenticated RWHT.*hard boundary|Authentication is a hard boundary/);
assert.match(runner, /authenticated_surface_missing/);

const pwaViteConfig = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'vite.config.ts'), 'utf8');
const pwaTestCatalog = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'src', 'testCatalog.ts'), 'utf8');
const projectsRwhtWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'projects-rwht-authenticated.yml'), 'utf8');
const pcRwhtWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pc-rwht.yml'), 'utf8');
const pwaFastDeployWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'aria-pwa-fast-deploy.yml'), 'utf8');
const cloudflareDeployWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'aria-cloudflare-deploy.yml'), 'utf8');
const persistenceRecoveryWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'persistence-recovery-rwht-authenticated.yml'), 'utf8');
const webPushGateTriggerWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'aria-meditation-webpush-production-e2e.yml'), 'utf8');
assert.match(pwaFastDeployWorkflow,/push:\s*\n\s*branches:\s*\[main\]/,'PC RWHT runner changes are covered because PWA deploys every main SHA for Exact-SHA certification');
assert.doesNotMatch(pwaFastDeployWorkflow,/push:\s*\n\s*branches:\s*\[main\]\s*\n\s*paths:/,'PWA deploy cannot path-filter out a SHA required by Exact-SHA certification');
assert.match(cloudflareDeployWorkflow,/push:\s*\n\s*branches:\s*\[main\]/,'PC RWHT runner changes are covered because Worker deploys every main SHA for Exact-SHA certification');
assert.doesNotMatch(cloudflareDeployWorkflow,/push:\s*\n\s*branches:\s*\[main\]\s*\n\s*paths:/,'Worker deploy cannot path-filter out a SHA required by Exact-SHA certification');
for (const [workflowName, workflow] of [
  ['Persistence + Recovery RWHT', persistenceRecoveryWorkflow],
  ['Production Web Push E2E', webPushGateTriggerWorkflow],
]) {
  assert.ok(workflow.includes("'rwht/pc-browser/rwht-pc-browser.mjs'"), `${workflowName} must trigger when the full PC RWHT harness changes`);
  assert.ok(workflow.includes("'tests/pc-rwht-browser.test.js'"), `${workflowName} must trigger when the PC RWHT contract changes`);
}
assert.match(pwaIndex, /aria-test-catalog-version/);
assert.match(pwaIndex, /content='__ARIA_TEST_CATALOG_VERSION__'/);
assert.match(pwaIndex, /aria-test-catalog-total/);
assert.match(pwaIndex, /content='__ARIA_TEST_CATALOG_TOTAL__'/);
assert.match(pwaViteConfig, /TEST_CATALOG_VERSION/);
assert.match(pwaViteConfig, /testCatalogTotal/);
assert.match(pwaViteConfig, /aria-test-catalog-metadata/);
assert.match(pwaTestCatalog, /export const TEST_CATALOG_VERSION = '2026-10-16-voice-audio-v2'/);
assert.equal([...pwaTestCatalog.matchAll(/"file": "tests\//g)].length, 325);
assert.match(projectsRwhtWorkflow, /export const TEST_CATALOG_VERSION/);
assert.match(projectsRwhtWorkflow, /grep -c '"file": "tests\//);
assert.match(projectsRwhtWorkflow, /PROJECTS_CANONICAL_TEST_CATALOG_LIVE_OK/);
assert.ok(projectsRwhtWorkflow.includes('catalog_match=false'));
assert.ok(projectsRwhtWorkflow.includes('test "$catalog_match" = true'));
assert.match(pcRwhtWorkflow, /export const TEST_CATALOG_VERSION/);
assert.match(pcRwhtWorkflow, /catalog_match=false/);
assert.ok(pcRwhtWorkflow.includes('test "$catalog_match" = true'));
assert.ok(pcRwhtWorkflow.includes('node --check rwht/pc-browser/rwht-pc-browser.mjs'));
assert.match(pcRwhtWorkflow, /json.loads\(os.environ\["VERSION"\]\)\["build"\] == os.environ\["EXPECTED"\]/);

const workersBuild = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'cloudflare-workers-build.js'), 'utf8');
assert.match(workersBuild, /WORKERS_CI_COMMIT_SHA/);
assert.match(workersBuild, /__PWA_BUILD__/);
assert.match(workersBuild, /index-.*html/);
assert.match(workersBuild, /sw-.*\.js/);

const authenticatedWorkflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'pc-rwht-authenticated.yml'),
  'utf8',
);
assert.match(authenticatedWorkflow, /RWHT_REQUIRE_AUTH: 'true'/);
assert.match(authenticatedWorkflow, /RWHT_EXPECTED_AUTH_TEXT: 'Lista para actuar'/);
assert.match(authenticatedWorkflow, /RWHT_EMAIL:/);
assert.match(authenticatedWorkflow, /RWHT_PASSWORD:/);
assert.match(authenticatedWorkflow, /RWHT_STORAGE_STATE_B64:/);
assert.match(authenticatedWorkflow, /Require an authenticated session source/);
assert.match(authenticatedWorkflow, /Configure RWHT_EMAIL \+ RWHT_PASSWORD, RWHT_STORAGE_STATE_B64, or RWHT_STORAGE_STATE_GZIP_B64/);
assert.match(authenticatedWorkflow, /Execute authenticated PC PWA RWHT/);

const pcWorkflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'pc-rwht.yml'),
  'utf8',
);
assert.equal((pcWorkflow.match(/'supabase\/functions\/aria-app-api-v3\/\*\*'/g) || []).length, 2,
assert.equal((pcWorkflow.match(/'worker\\.js'/g) || []).length, 2, 'Full PC RWHT must trigger for worker-only release changes on both PR and main pushes');
assert.equal((pcWorkflow.match(/'wrangler\\.toml'/g) || []).length, 2, 'Full PC RWHT must trigger for Wrangler config changes on both PR and main pushes');
assert.equal(pcWorkflow.split("'.github/workflows/aria-cloudflare-deploy.yml'").length - 1, 2, 'Full PC RWHT must trigger for Worker deploy changes on both PR and main pushes');
assert.equal(pcWorkflow.split("'.github/workflows/aria-pwa-fast-deploy.yml'").length - 1, 2, 'Full PC RWHT must trigger for PWA fast deploy changes on both PR and main pushes');
assert.equal(pcWorkflow.split("'.github/workflows/aria-scheduler-transport-deploy.yml'").length - 1, 2, 'Full PC RWHT must trigger for scheduler transport deploy changes on both PR and main pushes');
  'PC Browser RWHT must run on push and PR changes to the canonical App API');
assert.match(pcWorkflow, /LIVE_GATE_PREDECESSORS: "ARIA ABSORB Contract and LIVE E2E;ARIA Chat Browser RWHT Authenticated;ARIA Capabilities Browser RWHT Authenticated;ARIA PWA Steps 7-8 LIVE Certification;ARIA npm test;ARIA Autonomous Windows Qwen3;All For One Forensic Audit"/,
  'Full PC RWHT may certify only after every exact-SHA predecessor, including Steps 7-8, succeeds');
const steps78WorkflowTriggers = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'aria-pwa-steps-7-8-live.yml'), 'utf8');
assert.ok(steps78WorkflowTriggers.includes("'.github/workflows/pc-rwht.yml'"),
  'Steps 7-8 certification must rerun when the PC certification workflow graph changes');
assert.ok(steps78WorkflowTriggers.includes("'rwht/pc-browser/rwht-pc-browser.mjs'"),
  'Steps 7-8 must rerun when the PC RWHT execution harness changes');
assert.ok(steps78WorkflowTriggers.includes("'tests/pc-rwht-browser.test.js'"),
  'Steps 7-8 must rerun when the PC RWHT contract changes');
for (const workflowPath of [
  '.github/workflows/aria-meditation-webpush-production-e2e.yml',
  '.github/workflows/capabilities-rwht-authenticated.yml',
  '.github/workflows/chat-rwht-authenticated.yml',
  '.github/workflows/persistence-recovery-rwht-authenticated.yml',
  '.github/workflows/responsive-ux-rwht-authenticated.yml',
  '.github/workflows/settings-rwht-authenticated.yml',
]) {
  const workflow = fs.readFileSync(path.join(__dirname, '..', workflowPath), 'utf8');
  assert.ok(workflow.includes("'.github/workflows/pc-rwht.yml'"),
    workflowPath + ' must rerun on PC RWHT exact-SHA gate changes');
}
assert.match(pcWorkflow, /RWHT_STORAGE_STATE_B64/);
assert.match(pcWorkflow, /Load persistent authenticated browser state/);
assert.match(pcWorkflow, /RWHT_REQUIRE_AUTH:.*RWHT_STORAGE_STATE_B64/);

const deployGate = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'ci', 'wait-for-aria-exact-sha-deploys.sh'), 'utf8');
assert.match(deployGate, /Deploy ARIA Cloudflare Worker/);
assert.match(deployGate, /Deploy ARIA PWA Fast Lane/);
assert.match(deployGate, /Deploy ARIA APP API v3/);
assert.match(deployGate, /EXACT_SHA_PRODUCTION_DEPLOYS_PASS/);
assert.match(deployGate, /RUNS_FILE/);
assert.match(deployGate, /LIVE_GATE_PREDECESSORS/);
assert.match(deployGate, /PREDECESSOR/);
assert.match(deployGate, /with open\(os\.environ\[\"RUNS_FILE\"\]/);
assert.match(deployGate, /head_sha/);
const webPushWorkflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'aria-meditation-webpush-production-e2e.yml'),
  'utf8',
);
assert.ok(webPushWorkflow.includes('if [[ ( -z "${RWHT_EMAIL}" || -z "${RWHT_PASSWORD}" ) && -n "${RWHT_STORAGE_STATE_B64}" ]]; then'), 'Web Push must prefer fresh credentials and use raw browser state only when a credential is missing');
assert.ok(webPushWorkflow.includes('elif [[ ( -z "${RWHT_EMAIL}" || -z "${RWHT_PASSWORD}" ) && -n "${RWHT_STORAGE_STATE_GZIP_B64}" ]]; then'), 'Web Push must support compressed browser state only as a missing-credentials fallback');
assert.ok(webPushWorkflow.includes('static storage-state refresh token'), 'Web Push must document why concurrent jobs cannot race on a shared rotating refresh token');
assert.ok(webPushWorkflow.includes('group: aria-production-webpush-e2e-${{ github.sha }}'), 'Web Push must use a release-scoped concurrency group');
assert.ok(webPushWorkflow.includes('cancel-in-progress: false'), 'Web Push must not be cancelled by a later SHA');
assert.ok(webPushWorkflow.includes('Wait for both exact-SHA production deploys'));
assert.match(deployGate, /EXACT_SHA_PRODUCTION_DEPLOYS_PASS=/, 'The shared deployment gate must emit a positive exact-SHA marker only after deploy success');
assert.ok(webPushWorkflow.includes('actions: read'), 'Web Push needs read-only Actions access to gate on both deploy runs');

const wranglerToml = fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf8');
assert.match(wranglerToml, /\[placement\]/);
assert.match(wranglerToml, /mode = "smart"/);

assert.match(runner, /reload_auth: envBool\('RWHT_RELOAD_AUTH'/);
assert.match(runner, /page\.reload\(\{ waitUntil: 'domcontentloaded'/);
assert.match(authenticatedWorkflow, /RWHT_ROUTES: '#home,#chat,#projects,#meditation,#capabilities,#settings,#mission'/);
assert.match(authenticatedWorkflow, /RWHT_RELOAD_AUTH: 'true'/);
assert.match(authenticatedWorkflow, /RWHT_LOGIN_WAIT_MS: '40000'/);

assert.match(runner, /routeHash === '#home' \? '\.dashboardScreen'/);
assert.match(runner, /routeHash === '#chat' \? '\.chatScreen'/);
assert.match(runner, /routeHash === '#projects' \? '\.projectShell'/);
assert.match(runner, /isInActiveSurface/);
assert.match(runner, /activeSurfaceSelector/);
const uxAudit = runner.slice(runner.indexOf('async function checkUx'), runner.indexOf('async function loginIfConfigured'));
assert.ok(uxAudit.includes("routeHash === '#projects' ? '.projectShell'"), 'Projects UX checks must ignore inactive PWA surfaces');
assert.ok(runner.includes('await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});'), 'Each route UX audit must start from the canonical top scroll position');
assert.match(runner, /function isBattleCruiserExternalAuthSnapshot/);
assert.ok(runner.includes('(!externalAuthBoundary && (!control.visible || control.disabled))'), 'Human-gated external auth remains blocked/testable while ordinary disabled controls count only as skipped');
assert.ok(runner.includes("reason: !original.visible ? 'not_visible_initial_snapshot' : 'disabled_initial_snapshot'"), 'Initially hidden/disabled controls must not also be reclassified as verified or blocked');
assert.match(runner, /\.chatScreen/);
assert.match(runner, /not\(\[type="file"\]\)/);
assert.match(runner, /'hidden', 'password', 'file'/);


const chatE2E = fs.readFileSync(path.join(__dirname, '..', 'rwht', 'pc-browser', 'rwht-chat-e2e.mjs'), 'utf8');
assert.match(chatE2E, /aria-chat-rwht-e2e-v1\.1\.4/);
assert.match(chatE2E, /Habla con ARIA/);
assert.match(chatE2E, /aria_session_v2/);
assert.match(chatE2E, /chat_server_conversation_id_mismatch/);
assert.match(chatE2E, /chat_server_user_message_missing/);
assert.match(chatE2E, /chat_server_assistant_response_missing/);
assert.match(chatE2E, /chat_server_response_mismatch/);
assert.match(chatE2E, /chat_reload_persistence_missing/);
assert.match(chatE2E, /chat_ux_contract_failed/);
assert.match(chatE2E, /RWHTCHATCERT/);
assert.match(chatE2E, /replace\(\/\\s\+\/g, ' '\)/);
assert.doesNotMatch(chatE2E, /RWHT_CHAT_CERT_/);
const omniNpmWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'aria-npm-test.yml'), 'utf8');
const chatWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'chat-rwht-authenticated.yml'), 'utf8');
assert.match(chatWorkflow, /ARIA Chat Browser RWHT Authenticated/);
assert.match(chatWorkflow, /RWHT_EMAIL/);
assert.match(chatWorkflow, /RWHT_PASSWORD/);
assert.match(chatWorkflow, /RWHT_STORAGE_STATE_B64/);
assert.match(chatWorkflow, /Execute authenticated Chat E2E/);
assert.ok(chatWorkflow.includes('group: aria-chat-rwht-${{ github.sha }}'), 'Chat must not share a concurrency group with Capabilities or Persistence');
assert.match(omniNpmWorkflow, /Cleanup OmniRoute and Ollama/);
assert.ok(omniNpmWorkflow.includes('CLEANUP_PROCESS_ALREADY_EXITED'), 'OmniRoute cleanup must tolerate processes that exited naturally');
assert.ok(omniNpmWorkflow.includes('CLEANUP_PROCESS_STILL_RUNNING'), 'OmniRoute cleanup must fail only when a process survives cleanup');
assert.ok(omniNpmWorkflow.includes('$global:LASTEXITCODE=0'), 'OmniRoute cleanup must clear stale taskkill exit codes after checking process state');
assert.match(chatE2E, /const existingSession = await readSession\(page\)\.catch\(\(\) => null\)/, 'Chat must verify a real local ARIA session before skipping login');
assert.match(chatE2E, /if \(existingSession\?\.accessToken && existingSession\.userId\)/, 'A storage-state path alone must not count as authenticated');
assert.match(chatE2E, /form\.authCard input\[type="password"\]/, 'Chat post-login readiness must scope password checks to the ARIA auth form');
assert.match(chatE2E, /if \(session\?\.accessToken && session\?\.userId\) return \{ kind: 'session' \}/, 'Chat login must complete only when a persisted ARIA session exists');
assert.match(chatE2E, /const authForm = page\.locator\('form\.authCard'\)/, 'Chat login controls must be scoped to the ARIA auth form');
assert.match(chatE2E, /kind: 'auth_error'/, 'Chat login must report an explicit visible auth error instead of a generic timeout');
assert.match(chatE2E, /const outcome = await outcomeHandle\.jsonValue\(\)/, 'Chat must unwrap the Playwright outcome handle before checking auth errors');
assert.match(chatE2E, /await outcomeHandle\.dispose\(\)/, 'Chat must dispose the outcome handle after reading it');
assert.match(chatE2E, /aria_auth_session_timeout_no_visible_error/, 'Timeout without a visible auth error must be diagnosed explicitly');
assert.match(chatE2E, /authForm\.locator\('button\[type="submit"\],input\[type="submit"\]'\)/, 'Chat login must submit ARIA auth form directly');
assert.doesNotMatch(chatE2E, /!document\.querySelector\('input\[type="password"\]'\)/, 'Unrelated project password fields must not block Chat login');
assert.ok(chatWorkflow.includes('if [[ "${has_password_auth}" != true && "${has_storage_auth}" == true ]]; then'), 'Chat must prefer fresh password credentials over a saved browser state');
assert.ok(chatWorkflow.includes('elif [[ "${has_password_auth}" != true && "${has_storage_gzip_auth}" == true ]]; then'), 'Compressed browser state must also be fallback-only');
const capabilitiesWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'capabilities-rwht-authenticated.yml'), 'utf8');
assert.ok(capabilitiesWorkflow.includes('group: aria-capabilities-rwht-${{ github.sha }}'), 'Capabilities needs its own release-scoped group');
assert.ok(capabilitiesWorkflow.includes("expected_version=\"$(grep '^export const TEST_CATALOG_VERSION' pwa/src/testCatalog.ts | cut -d \"'\" -f 2)\""), 'Capabilities must derive expected catalog version from the checked-out source');
assert.ok(capabilitiesWorkflow.includes("expected_total=\"$(grep -c '\"file\": \"tests/' pwa/src/testCatalog.ts)\""), 'Capabilities must derive expected catalog size from the checked-out source');
assert.doesNotMatch(capabilitiesWorkflow, /2026-10-02-canonical|content='293'/, 'Capabilities must not pin stale catalog metadata');
assert.ok(capabilitiesWorkflow.includes('catalog_match=false'), 'Capabilities must not default the LIVE catalog gate to passing');
assert.ok(capabilitiesWorkflow.includes('then catalog_match=true; break; fi'), 'Capabilities must pass only after both live catalog markers match');
assert.ok(capabilitiesWorkflow.includes('test "$catalog_match" = true'), 'Capabilities must fail if the canonical catalog does not match before timeout');
assert.match(capabilitiesWorkflow, /CAPABILITIES_CANONICAL_TEST_CATALOG_LIVE_OK version=/, 'Capabilities must persist the exact catalog metadata it verified');
assert.ok(pwaFastDeployWorkflow.includes('manifest_ok=false'), 'PWA deploy must retry the manifest smoke until available');
assert.ok(pwaFastDeployWorkflow.includes('test "$manifest_ok" = true'), 'PWA deploy must fail if manifest never becomes available');
assert.ok(pwaFastDeployWorkflow.includes('js_ok=false') && pwaFastDeployWorkflow.includes('test "$js_ok" = true'), 'PWA deploy must retry and require the JS asset');
assert.ok(pwaFastDeployWorkflow.includes('css_ok=false') && pwaFastDeployWorkflow.includes('test "$css_ok" = true'), 'PWA deploy must retry and require the CSS asset');
const persistenceWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'persistence-recovery-rwht-authenticated.yml'), 'utf8');
assert.ok(persistenceWorkflow.includes('group: aria-persistence-recovery-rwht-${{ github.sha }}'), 'Persistence needs its own release-scoped group');
const steps78Workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'aria-pwa-steps-7-8-live.yml'), 'utf8');
assert.ok(steps78Workflow.includes('Wait for both exact-SHA production deploys'));
assert.match(deployGate, /EXACT_SHA_PRODUCTION_DEPLOYS_PASS=/, 'Steps 7–8 must depend on the shared deploy gate result');
assert.ok(steps78Workflow.includes('actions: read'), 'Steps 7-8 must read deployment run states before browser execution');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'src', 'App.tsx'), 'utf8');
assert.match(appSource, /chatWindowRef/);
assert.match(appSource, /data-testid='chat-window'/);
assert.match(appSource, /node\.scrollTop = node\.scrollHeight/);

const projectsSource = fs.readFileSync(path.join(__dirname, '..', 'rwht', 'pc-browser', 'rwht-projects-e2e.mjs'), 'utf8');
assert.match(projectsSource, /aria-projects-rwht-e2e-v1\.1\.10/);
assert.match(projectsSource, /battlecruiser|cuevacoin|aria/);
assert.match(projectsSource, /server_persistence_verified/);
assert.match(projectsSource, /visual_mission_verified/);
assert.match(projectsSource, /png_persisted/);
assert.match(projectsSource, /externalPreviewConsoleErrors/);
assert.match(projectsSource, /external_preview_console_errors/);
assert.match(projectsSource, /canonical_queue/);
assert.match(projectsSource, /report\.reality_board/);
assert.match(projectsSource, /reality_board_live_sha_not_rendered/);
assert.match(projectsSource, /manual_refresh_api_responses/);
assert.match(projectsSource, /reality_board_project_api_read_failed/);
const projectsWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'projects-rwht-authenticated.yml'), 'utf8');
assert.match(projectsWorkflow, /ARIA Projects Browser RWHT Authenticated/);
assert.match(projectsWorkflow, /RWHT_REQUIRE_AUTH: 'true'/);
assert.match(projectsWorkflow, /RWHT_ROUTES: '#projects'/);
assert.match(chatWorkflow, /Wait for exact-SHA production deploys before authenticated Chat/, 'Chat must only run after exact-SHA deployment gates pass');
assert.doesNotMatch(projectsWorkflow, /^\s+- Deploy ARIA (Cloudflare Worker|PWA Fast Lane|APP API v3)$/m, 'Projects + ARTIA must not be triggered by multiple independent deploy workflows');
assert.match(projectsWorkflow, /- ARIA PC Browser RWHT/, 'Only a successful full PC browser RWHT should trigger the final Projects + ARTIA proof');
assert.match(projectsWorkflow, /wait-for-aria-exact-sha-deploys\.sh/, 'Projects must validate the exact-SHA deployment barrier');
assert.match(projectsWorkflow, /Execute authenticated Projects \+ ARTIA E2E/);
assert.match(projectsWorkflow, /RWHT_EMAIL/);
assert.match(projectsWorkflow, /RWHT_PASSWORD/);
assert.match(projectsWorkflow, /RWHT_STORAGE_STATE_B64/);

// 2026-10-01 final-head authenticated RWHT recertification trigger.

// Final universal RWHT certification trigger: Chat + Projects + Capabilities + PC.
