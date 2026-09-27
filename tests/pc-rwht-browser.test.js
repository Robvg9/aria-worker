'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(path.join(__dirname, '..', 'rwht', 'pc-browser', 'rwht-pc-browser.mjs'), 'utf8');
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
assert.match(runner, /page_errors/);
assert.match(runner, /failed_responses/);
assert.match(runner, /RWHT_EMAIL/);
assert.match(runner, /RWHT_PASSWORD/);
assert.doesNotMatch(runner, /console\.log\([^\n]*password/i);
assert.equal(pkg.dependencies.playwright, '1.63.0');

assert.match(missionRunnerFixes, /buildDeviceEnqueuePayload/);
assert.match(missionRunnerFixes, /for \(const key of \["start_url"\] as const\)/);
assert.match(missionRunnerFixes, /input\[key\] === null \|\| input\[key\] === undefined/);
assert.match(missionRunnerFixes, /delete input\[key\]/);

console.log('PC BROWSER RWHT CONTRACT: PASS');

assert.match(runner, /RWHT_REQUIRE_AUTH/);
assert.match(runner, /RWHT_EXPECTED_AUTH_TEXT/);
assert.match(runner, /auth_verified/);
