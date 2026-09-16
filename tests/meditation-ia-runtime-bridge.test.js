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
  assert.ok(canonical.includes('RUNNER'));
  assert.ok(runner.includes('createPlan'));
  assert.ok(runner.includes('executeStep'));
  assert.ok(runner.includes('verifyStep'));
  assert.ok(runner.includes('aria_mission_claim_by_id_lease'));
});

console.log('MEDITATION_IA_RUNTIME_BRIDGE=PASS');
