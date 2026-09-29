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

assert.match(runner, /aria-pc-browser-rwht-v1\.2\.0/);
assert.match(runner, /playwright/);
assert.match(runner, /DEFAULT_ROUTES/);
assert.match(runner, /aria\.robvg9\.workers\.dev\/pwa/);
assert.match(runner, /SAFE_BLOCKED/);
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
assert.match(runner, /images_missing_alt/);
assert.match(runner, /unlabeled_inputs/);
assert.match(runner, /controls_verified/);
assert.match(runner, /controls_blocked/);
assert.match(runner, /controls_failed/);
assert.match(runner, /coverage_ratio/);
assert.match(runner, /controls_testable/);
assert.match(runner, /controls_skipped/);
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
assert.match(appApi, /aria_app_list_conversations/);
assert.doesNotMatch(appApi, /schema\(["']aria_app["']\)\.from\(["']conversations["']\)/);

console.log('PC BROWSER RWHT CONTRACT: PASS');

assert.match(runner, /RWHT_REQUIRE_AUTH/);
assert.match(runner, /RWHT_EXPECTED_AUTH_TEXT/);
assert.match(runner, /auth_verified/);

assert.match(pwaIndex, /aria-test-catalog-version/);
assert.match(pwaIndex, /2026-09-28-canonical/);
assert.match(pwaIndex, /aria-test-catalog-total/);
assert.match(pwaIndex, /content='254'/);

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
assert.match(authenticatedWorkflow, /Configure RWHT_EMAIL \+ RWHT_PASSWORD or RWHT_STORAGE_STATE_B64/);
assert.match(authenticatedWorkflow, /Execute authenticated PC PWA RWHT/);

assert.match(runner, /reload_auth: envBool\('RWHT_RELOAD_AUTH'/);
assert.match(runner, /page\.reload\(\{ waitUntil: 'domcontentloaded'/);
assert.match(authenticatedWorkflow, /RWHT_ROUTES: '#home'/);
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
assert.match(chatE2E, /aria-chat-rwht-e2e-v1\.0\.5/);
assert.match(chatE2E, /Habla con ARIA/);
assert.match(chatE2E, /aria_session_v2/);
assert.match(chatE2E, /chat_server_persistence_missing/);
assert.match(chatE2E, /chat_reload_persistence_missing/);
assert.match(chatE2E, /chat_ux_contract_failed/);
assert.match(chatE2E, /RWHTCHATCERT/);
assert.match(chatE2E, /replace\(\/\\s\+\/g, ' '\)/);
assert.doesNotMatch(chatE2E, /RWHT_CHAT_CERT_/);
const chatWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'chat-rwht-authenticated.yml'), 'utf8');
assert.match(chatWorkflow, /ARIA Chat Browser RWHT Authenticated/);
assert.match(chatWorkflow, /RWHT_EMAIL/);
assert.match(chatWorkflow, /RWHT_PASSWORD/);
assert.match(chatWorkflow, /RWHT_STORAGE_STATE_B64/);
assert.match(chatWorkflow, /Execute authenticated Chat E2E/);
const appSource = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'src', 'App.tsx'), 'utf8');
assert.match(appSource, /chatWindowRef/);
assert.match(appSource, /data-testid='chat-window'/);
assert.match(appSource, /node\.scrollTop = node\.scrollHeight/);

const projectsSource = fs.readFileSync(path.join(__dirname, '..', 'rwht', 'pc-browser', 'rwht-projects-e2e.mjs'), 'utf8');
assert.match(projectsSource, /aria-projects-rwht-e2e-v1\.1\.1/);
assert.match(projectsSource, /battlecruiser|cuevacoin|aria/);
assert.match(projectsSource, /server_persistence_verified/);
assert.match(projectsSource, /visual_mission_verified/);
assert.match(projectsSource, /png_persisted/);
assert.match(projectsSource, /externalPreviewConsoleErrors/);
assert.match(projectsSource, /external_preview_console_errors/);
assert.match(projectsSource, /canonical_queue/);
const projectsWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'projects-rwht-authenticated.yml'), 'utf8');
assert.match(projectsWorkflow, /ARIA Projects Browser RWHT Authenticated/);
assert.match(projectsWorkflow, /RWHT_REQUIRE_AUTH: 'true'/);
assert.match(projectsWorkflow, /RWHT_ROUTES: '#projects'/);
assert.match(projectsWorkflow, /Execute authenticated Projects \+ ARTIA E2E/);
assert.match(projectsWorkflow, /RWHT_EMAIL/);
assert.match(projectsWorkflow, /RWHT_PASSWORD/);
assert.match(projectsWorkflow, /RWHT_STORAGE_STATE_B64/);
