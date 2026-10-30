'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (file) => fs.readFileSync(file, 'utf8');

test('canonical runtime is fail-closed before reading or forwarding a mission request', () => {
  const source = read('supabase/functions/aria-canonical-runtime-v1/index.ts');
  const handler = source.indexOf('Deno.serve(async r=>{');
  const gate = source.indexOf('if(MISSION_EXECUTION_PAUSED)', handler);
  const bodyRead = source.indexOf('const body=await r.text()', handler);
  assert.match(source, /function internalFunctionFetch\(input:RequestInfo\|URL,init:RequestInit=\{\}\)/);
  assert.ok(handler >= 0 && gate > handler && bodyRead > gate, 'pause gate must run before request forwarding');
});

test('mission runner is fail-closed before stale recovery, hard-block reopening, and claims', () => {
  const source = read('supabase/functions/aria-mission-runner-v22/index.ts');
  const handler = source.indexOf('Deno.serve(async (request) => {');
  const gate = source.indexOf('if (MISSION_EXECUTION_PAUSED)', handler);
  const bodyRead = source.indexOf('const body = await request.json()', handler);
  const recover = source.indexOf('aria_autonomy_recover_stale_missions', handler);
  const reopen = source.indexOf('aria_reopen_recoverable_hard_blocks', handler);
  const claim = source.indexOf('aria_mission_claim_next_lease', handler);
  assert.ok(handler >= 0 && gate > handler, 'runner gate must be inside the authenticated entrypoint');
  for (const [name, index] of Object.entries({ bodyRead, recover, reopen, claim })) {
    assert.ok(index > gate, 'runner gate must precede ' + name);
  }
});

test('supervisor does not fan out while paused or call the undeployed repair endpoint', () => {
  const source = read('supabase/functions/aria-autonomy-supervisor-v5/index.ts');
  const gate = source.indexOf('MISSION_EXECUTION_PAUSED)return');
  const kick = source.indexOf('const runtime=await kick(r)');
  assert.ok(gate >= 0 && kick > gate, 'supervisor gate must precede fan-out');
  assert.doesNotMatch(source, /\/functions\/v1\/aria-repair-supervisor-v1/);
  assert.match(source, /aria_repair_supervisor_v1_not_deployed/);
});

test('device gateway blocks mission, autonomy, manual queue execution, and job claim routes before parsing body', () => {
  const source = read('supabase/functions/aria-device-gateway/index.ts');
  const handler = source.indexOf('Deno.serve(async(req)=>{');
  const gate = source.indexOf('PAUSED_MISSION_ENDPOINTS.has(p)', handler);
  const bodyRead = source.indexOf('const b=await body(req)', handler);
  assert.ok(handler >= 0 && gate > handler && bodyRead > gate, 'gateway route guard must precede request body handling');
  for (const endpoint of [
    '/v1/autonomy/cycle',
    '/v1/audit/all-for-one/start',
    '/v1/audit/all-for-one/tick',
    '/v1/meditation/tick-service',
    '/v1/meditation/tick',
    '/v1/meditation/queue/run-next',
    '/v1/meditation/human-gate/complete',
    '/v1/rwht-final-repair',
    '/v1/mission5/agent-probe',
    '/v1/mission5/model-probe',
    '/v1/jobs/claim',
  ]) assert.ok(source.includes('"' + endpoint + '"'), 'blocked route missing: ' + endpoint);
});

test('autonomy selectors enforce max_attempts for core and gateway-local engines', async () => {
  const core = await import('../autonomy/dynamic-goal-engine.mjs');
  const gateway = await import('../supabase/functions/aria-device-gateway/_shared/dynamic-goal-engine.mjs');
  const goals = [
    { goal_id: 'runaway', goal: 'runaway goal', status: 'queued', attempts: 94, max_attempts: 3, priority: 100 },
    { goal_id: 'eligible', goal: 'eligible goal', status: 'queued', attempts: 2, max_attempts: 3, priority: 50 },
    { goal_id: 'paused-exhausted', goal: 'paused exhausted goal', status: 'paused', attempts: 3, max_attempts: 3, priority: 99 },
  ];
  const coreCandidates = core.generateCandidates({ goals }, { now: '2026-10-30T20:00:00.000Z' });
  assert.equal(core.selectDynamicGoal(coreCandidates)?.goal_id, 'eligible');
  const localCandidates = gateway.generateCandidates({ goals }, { now: '2026-10-30T20:00:00.000Z' });
  assert.equal(gateway.selectDynamicGoal(localCandidates, new Set(), new Set())?.goal_id, 'eligible');
  assert.equal(core.selectDynamicGoal(coreCandidates.filter((candidate) => candidate.goal_id === 'runaway')), null);
  assert.equal(gateway.selectDynamicGoal(localCandidates.filter((candidate) => candidate.goal_id === 'runaway'), new Set(), new Set()), null);
});

test('consistency checker flags terminal missions with open steps and missing cancel events without mutating data', async () => {
  const { analyzeMissionConsistency } = await import('../supabase/functions/_shared/mission-consistency.mjs');
  for (const status of ['failed', 'blocked', 'cancelled']) {
    const report = analyzeMissionConsistency({
      mission: { mission_id: 'mission-' + status, status, total_steps: 1, completed_steps: 0 },
      steps: [{ step_index: 1, status: 'pending' }],
      jobs: [],
      events: [],
    });
    assert.ok(report.checks.some((check) => check.code === 'terminal_mission_has_open_steps'), status + ' must flag open steps');
    if (status === 'cancelled') assert.ok(report.checks.some((check) => check.code === 'cancelled_mission_missing_event'));
  }
  const withEvent = analyzeMissionConsistency({
    mission: { mission_id: 'mission-cancelled', status: 'cancelled' },
    steps: [],
    events: [{ mission_id: 'mission-cancelled', event_type: 'mission_cancelled' }],
  });
  assert.ok(!withEvent.checks.some((check) => check.code === 'cancelled_mission_missing_event'));
  assert.equal(withEvent.version, 'aria-mission-consistency-v1.2.0');
});

console.log('ARIA no-mission-reactivation contract tests registered');
