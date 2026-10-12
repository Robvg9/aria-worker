'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(path.join(__dirname, '..', 'rwht', 'pc-browser', 'rwht-pc-browser.mjs'), 'utf8');
const pwaIndex = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rwht', 'pc-browser', 'package.json'), 'utf8'));
const missionRunnerFixes = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'forensic-continuity-fixes.ts'),
  'utf8',
);

assert.match(runner, /aria-pc-browser-rwht-v1.4.2/);
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
assert.match(pwaIndex, /aria-test-catalog-version/);
assert.match(pwaIndex, /content='__ARIA_TEST_CATALOG_VERSION__'/);
assert.match(pwaIndex, /aria-test-catalog-total/);
assert.match(pwaIndex, /content='__ARIA_TEST_CATALOG_TOTAL__'/);
assert.match(pwaViteConfig, /TEST_CATALOG_VERSION/);
assert.match(pwaViteConfig, /testCatalogTotal/);
assert.match(pwaViteConfig, /aria-test-catalog-metadata/);
assert.match(pwaTestCatalog, /export const TEST_CATALOG_VERSION = '2026-10-10-canonical'/);
assert.equal([...pwaTestCatalog.matchAll(/"file": "tests\//g)].length, 323);
assert.match(projectsRwhtWorkflow, /export const TEST_CATALOG_VERSION/);
assert.match(projectsRwhtWorkflow, /grep -c '"file": "tests\//);
assert.match(projectsRwhtWorkflow, /PROJECTS_CANONICAL_TEST_CATALOG_LIVE_OK/);
assert.ok(projectsRwhtWorkflow.includes('catalog_match=false'));
assert.ok(projectsRwhtWorkflow.includes('test "$catalog_match" = true'));
assert.match(pcRwhtWorkflow, /export const TEST_CATALOG_VERSION/);
assert.match(pcRwhtWorkflow, /catalog_match=false/);
assert.ok(pcRwhtWorkflow.includes('test "$catalog_match" = true'));
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
assert.match(projectsSource, /aria-projects-rwht-e2e-v1\.1\.8/);
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
