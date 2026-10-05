'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const manifest = JSON.parse(read('runtime/lane-manifest-v1.json'));
const runner = read('supabase/functions/aria-mission-runner-v22/index.ts');
const finalE2E = read('.github/workflows/aria-windows-final-e2e.yml');
const meditationE2E = read('.github/workflows/aria-meditation-live-e2e.yml');
const runtimeRepair = read('.github/workflows/aria-windows-runtime-repair.yml');
const queueFairness = read('supabase/migrations/20261004013000_mission_claim_queue_fairness_v1.sql');

test('canonical physical lanes are explicit and disjoint', () => {
  assert.equal(manifest.lanes['omniroute-robvg-windows'].device_id, 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089');
  assert.equal(manifest.lanes['omniroute-robvg-windows'].runner_name, 'ARIA-WINDOWS');
  assert.equal(manifest.lanes['windows-lacueva-runtime'].device_id, 'windows-lacueva-780886');
  assert.equal(manifest.lanes['android-meditation-control'].execution_authority, 'canonical-mission-runner');
  assert.deepEqual(manifest.lanes['omniroute-robvg-windows'].runner_labels, ['self-hosted','Windows','X64','aria-robvg-omniroute']);
  assert.deepEqual(manifest.lanes['windows-lacueva-runtime'].runner_labels, ['aria-lacueva-runtime']);
  assert.notEqual(
    manifest.lanes['omniroute-robvg-windows'].device_id,
    manifest.lanes['windows-lacueva-runtime'].device_id
  );
});

test('mission runner refuses implicit device selection', () => {
  assert.match(runner, /resolveDeviceTargetPolicy/);
  assert.doesNotMatch(runner, /const selected = exact \|\| candidates\[0\]/);
  assert.match(runner, /requestedLocalDeviceId/);
  assert.match(runner, /qwenCandidates\.length === 1/);
});

test('persistent Windows physical E2E is trusted-main only and lane-guarded', () => {
  assert.doesNotMatch(finalE2E, /^\s*pull_request:/m);
  assert.match(finalE2E, /expected='windows-lacueva-780886'/);
  assert.match(finalE2E, /WRONG_ARIA_WINDOWS_LANE/);
  assert.ok(finalE2E.indexOf('Guard canonical Windows lane') < finalE2E.indexOf('Inspect and safely free C'));
  assert.match(finalE2E, /runs-on: \[aria-lacueva-runtime\]/);
});

test('Meditation Windows continuity is serialized and lane-guarded', () => {
  assert.match(meditationE2E, /group: aria-meditation-live-e2e/);
  assert.match(meditationE2E, /expected='windows-lacueva-780886'/);
  assert.match(meditationE2E, /WRONG_ARIA_WINDOWS_LANE/);
  assert.match(meditationE2E, /runs-on: \[aria-lacueva-runtime\]/);
});

test('Windows runtime repair is pinned to the LaCueva lane and self-starts', () => {
  assert.match(runtimeRepair, /runs-on: \[aria-lacueva-runtime\]/);
  assert.match(runtimeRepair, /expected='windows-lacueva-780886'/);
  assert.match(runtimeRepair, /WRONG_RUNNER_IDENTITY/);
  assert.match(runtimeRepair, /ARIA-LACUEVA-Runner\.lnk/);
  assert.match(runtimeRepair, /ARIA_LACUEVA_RUNNER_AUTOSTART=PASS/);
});

test('queue fairness keeps fresh queued work ahead of stale recovery', () => {
  assert.match(queueFairness, /when 'queued' then 0/);
  assert.match(queueFairness, /for update skip locked/i);
  assert.match(queueFairness, /m\.status='running' and m\.lease_owner is null/i);
});

test('verified closure remains evidence-gated', () => {
  assert.match(runner, /mission_verified/);
  assert.match(runner, /aria_mission_finalize_verified_lease/);
  assert.match(runner, /__aria_verification_evidence/);
  assert.match(runner, /github_pr_and_main_workflows/);
});

console.log('RUNTIME LANE INTEGRITY V1: PASS');
