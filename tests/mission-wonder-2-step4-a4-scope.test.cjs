'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.join(__dirname, '..');
  const shared = await import('../supabase/functions/_shared/mission-wonder-2-a4-scope-v1.mjs');
  const pwa = await import('../pwa/src/mission-submission-request-v1.mjs');
  const userId = 'a4-user-identity-test';
  const goal = 'Misión A4 read-only contract';
  const storage = {
    value: null,
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; },
    removeItem() { this.value = null; },
  };
  await pwa.getOrCreateMissionSubmissionRequestIdV1({
    userId, goal, projectId: null, storage, createRequestId: () => 'pwa-request-a4-test',
  });
  const keyFromPwa = Object.keys(JSON.parse(storage.value))[0];
  const keyFromRuntime = await shared.m22A4GoalIdentityHashV1(userId, goal, null);
  assert.equal(keyFromRuntime, keyFromPwa, 'A4 hash must exactly match PWA request identity');

  const now = Date.now();
  const metadata = {
    mission_wonder_2_a4_scope_id: 'scope-a4-test',
    mission_wonder_2_a4_goal_hash: keyFromRuntime,
    mission_wonder_2_a4_allowed_device_id: 'windows-a4-test',
    mission_wonder_2_a4_readonly: true,
    user_id: userId, owner_user_id: userId, request_id: 'pwa-request-a4-test',
    source_application: 'aria-app-v1', goal_source: 'user', project_id: null,
  };
  const scope = {
    scope_id: metadata.mission_wonder_2_a4_scope_id,
    owner_user_id: userId, request_id: metadata.request_id, goal_hash: keyFromRuntime,
    mission_id: 'mission-a4-test', allowed_device_id: 'windows-a4-test',
    status: 'bound', expires_at: new Date(now + 60000).toISOString(),
  };
  const matchArgs = { scope, metadata, missionId: 'mission-a4-test', userId,
    requestId: metadata.request_id, goal, projectId: null, requiredStatuses: ['bound'], nowMs: now };
  assert.equal(await shared.m22A4ScopeRowMatchesV1(matchArgs), true);
  for (const change of [
    { scope: { ...scope, owner_user_id: 'other-user' } },
    { scope: { ...scope, request_id: 'other-request' } },
    { scope: { ...scope, mission_id: 'other-mission' } },
    { scope: { ...scope, allowed_device_id: 'other-device' } },
    { scope: { ...scope, status: 'revoked' } },
    { scope: { ...scope, expires_at: new Date(now - 1000).toISOString() } },
    { metadata: { ...metadata, mission_wonder_2_a4_readonly: false } },
    { metadata: { ...metadata, mission_wonder_2_a4_goal_hash: '0'.repeat(64) } },
  ]) assert.equal(await shared.m22A4ScopeRowMatchesV1({ ...matchArgs, ...change }), false);

  const step = shared.m22A4BuildReadonlyProbeStepV1('windows-a4-test');
  assert.equal(shared.m22A4ReadonlyProbeStepMatchesV1(step, 'windows-a4-test'), true);
  assert.equal(shared.m22A4ReadonlyProbeStepMatchesV1({ ...step, input: { ...step.input, command: 'Remove-Item *' } }, 'windows-a4-test'), false);
  assert.equal(shared.m22A4ReadonlyProbeStepMatchesV1({ ...step, max_attempts: 2 }, 'windows-a4-test'), false);
  assert.equal(shared.m22A4ReadonlyProbeStepMatchesV1({ ...step, target: { ...step.target, device_id: 'other-device' } }, 'windows-a4-test'), false);

  const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
  const frozenPaths = [
    'supabase/functions/aria-app-api-v3/index.ts',
    'supabase/functions/aria-direct-v1/index.ts',
    'supabase/functions/aria-mission-intake-v1/index.ts',
    'supabase/functions/aria-canonical-runtime-v1/index.ts',
    'supabase/functions/aria-mission-runner-v22/index.ts',
    'supabase/functions/aria-execution-runtime-v1/index.ts',
  ];
  for (const file of frozenPaths) assert.match(read(file), /const MISSION_EXECUTION_PAUSED\s*=\s*true\s*;/, file + ' must preserve global freeze');
  const appApi = read(frozenPaths[0]);
  const direct = read(frozenPaths[1]);
  const intake = read(frozenPaths[2]);
  const canonical = read(frozenPaths[3]);
  const runner = read(frozenPaths[4]);
  const migration = read('supabase/migrations/20261104233000_aria_mission_wonder_2_a4_scope_v1.sql');
  const workflow = read('.github/workflows/mission-wonder-2-step4-a4-live-e2e.yml');
  const e2e = read('rwht/pc-browser/mission-wonder-2-step4-a4-live-e2e.mjs');

  assert.match(appApi, /aria_m22_a4_claim_scope_v1/);
  assert.match(appApi, /mission_wonder_2_a4_readonly/);
  assert.match(appApi, /headers\\["x-aria-user-id"\\] = options\\.userId\\.trim\\(\\)/);
  assert.ok(appApi.includes("}, undefined, { userId: user.id });"), "A4 owner identity must be sent as an HTTP header to DIRECT");
  assert.match(direct, /request\\.headers\\.get\\("x-aria-user-id"\\)/);
  assert.match(appApi, /path\.endsWith\("\/missions"\)/);
  assert.match(direct, /m22A4ScopeRowMatchesV1/);
  assert.match(direct, /!a4ScopeRow && \(sourceKind/);
  assert.match(intake, /m22A4ScopeRowMatchesV1/);
  assert.match(intake, /aria_mission_create/);
  assert.match(canonical, /requiredStatuses:\["bound"\]/);
  assert.match(runner, /m22A4BuildReadonlyProbeStepV1/);
  assert.match(runner, /m22A4ReadonlyProbeStepMatchesV1/);
  assert.match(runner, /a4_independent_execution_job_readback/);
  assert.match(runner, /aria_m22_a4_complete_scope_v1/);
  assert.doesNotMatch(migration, /insert\s+into\s+aria_internal\.(?:mission_state|execution_jobs)/i);
  assert.match(migration, /aria_m22_a4_claim_scope_v1/);
  assert.match(migration, /aria_m22_a4_revoke_scope_v1/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Deploy ARIA Supabase Runtime/);
  assert.doesNotMatch(workflow, /LIVE_GATE_PREDECESSORS|ARIA Persistence \+ Recovery Browser RWHT Authenticated/);
  assert.match(e2e, /scopeId = 'mission_wonder_2_a4_authorized_once'/);
  assert.match(e2e, /missionId = 'mission_a4_authorized_once'/);
  assert.match(e2e, /single-authorized-execution/);
  assert.ok(e2e.includes("const args = ['db', 'query', query, ...(write ? ['--yes'] : ['--read-only']), '--remote'];"));
  assert.match(e2e, /A4_SCOPE_ALREADY_CONSUMED/);
  assert.match(e2e, /const tick = await runtimeTick\(missionId\)/);
  assert.match(e2e, /Dispatch exactly once/);
  assert.match(e2e, /x-aria-request-id/);
  assert.match(e2e, /textarea\[aria-label="Objetivo de la misión"\]/);
  assert.match(e2e, /mission_verified/);
  assert.match(e2e, /A4_SCOPE_REVOKED_PASS/);

  console.log('MISSION WONDER 2 STEP 4 A4 ONE-SHOT CONTRACT: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
