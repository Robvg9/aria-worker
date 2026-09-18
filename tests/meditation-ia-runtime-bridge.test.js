'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const gateway = fs.readFileSync(path.join(root, 'supabase/functions/aria-device-gateway/index.ts'), 'utf8');
const canonical = fs.readFileSync(path.join(root, 'supabase/functions/aria-canonical-runtime-v1/index.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'supabase/functions/aria-mission-runner-v22/index.ts'), 'utf8');

test('Meditation IA tick delegates execution to canonical runtime', () => {
  assert.ok(gateway.includes('/functions/v1/aria-canonical-runtime-v1'));
  assert.ok(gateway.includes('runCanonicalMission'));
  assert.ok(gateway.includes('x-aria-trigger'));
  assert.ok(gateway.includes('runCanonicalMission(m.mission_id)'));
  assert.ok(gateway.includes('runCanonicalMission(missionId)'));
});

test('Canonical runtime remains the single mission execution entrypoint', () => {
  assert.ok(canonical.includes('aria-mission-runner-v22'));
  assert.ok(canonical.includes('x-aria-trigger'));
  assert.ok(canonical.includes('meditation-ia'));
  assert.ok(runner.includes('aria_mission_claim_next_lease'));
  assert.ok(runner.includes('chain_depth'));
  assert.ok(runner.includes('chainNextMeditationMission'));
  assert.ok(canonical.includes('RUNNER'));
  assert.ok(runner.includes('createPlan'));
  assert.ok(runner.includes('executeStep'));
  assert.ok(runner.includes('verifyStep'));
  assert.ok(runner.includes('aria_mission_claim_by_id_lease'));
  assert.ok(runner.includes('explicitlyUnverified'));
  assert.ok(runner.includes('mutating_operation_required'));
  assert.ok(runner.includes('Lease preserved for stale recovery') || runner.includes('lease_preserved_for_stale_recovery'));
  assert.ok(runner.includes('const failedMissionId = activeMissionId || requestedMissionId'));
  assert.ok(runner.includes('agentSteps.every'));
  assert.ok(runner.includes('modelSteps.every'));
  assert.ok(runner.includes('modelSteps.length > 0'));
  assert.ok(runner.includes('agentSteps.length > 0'));

const dbGuard = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260918013000_meditation_verified_db_guard_v1.sql'),
  'utf8'
);
assert.ok(dbGuard.includes('semantic_verification_required:mission_verified_event'));
assert.ok(dbGuard.includes('semantic_verification_failed:explicit_unverified'));
assert.ok(dbGuard.includes('mutation_without_change'));
assert.ok(dbGuard.includes('NO_CHANGE_REQUIRED'));
});

const githubRuntime = fs.readFileSync(path.join(root, 'supabase/functions/aria-github-app-runtime-v1/index.ts'), 'utf8');
assert.ok(githubRuntime.includes('idempotent:true'));
assert.ok(githubRuntime.includes('existing?.content'));
console.log('MEDITATION_IA_RUNTIME_BRIDGE=PASS');
