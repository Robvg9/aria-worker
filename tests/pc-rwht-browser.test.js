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

assert.match(runner, /aria-pc-browser-rwht-v1\.0\.0/);
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
assert.match(runner, /isInActiveSurface/);
