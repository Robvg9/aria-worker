'use strict';

const assert = require('assert');
const { createAutonomousMissionOrchestrator } = require('../autonomy/orchestrator');

function makeStore() {
  const missions = new Map();
  const events = [];
  return {
    missions, events,
    async get(id) { return missions.get(id) || null; },
    async transition(id, status, patch = {}) {
      const current = missions.get(id);
      if (!current) throw new Error('missing mission');
      const next = { ...current, ...patch, status };
      missions.set(id, next);
      events.push([id, status]);
      return next;
    },
    async checkpoint(id, checkpoint, patch = {}) {
      const current = missions.get(id);
      if (!current) throw new Error('missing mission');
      const next = { ...current, ...patch, checkpoint, status: patch.status || current.status };
      missions.set(id, next);
      return next;
    }
  };
}

(async () => {
  const store = makeStore();
  store.missions.set('m1', { mission_id: 'm1', goal: 'finish build', status: 'queued', current_step: 0, completed_steps: 0, checkpoint: {} });
  const executed = [];
  const orchestrator = createAutonomousMissionOrchestrator({
    missionStore: store,
    planner: async () => [
      { id: 's1', action: 'create', operation: 'shell.execute', risk: 'low' },
      { id: 's2', action: 'test', operation: 'shell.execute', risk: 'low' }
    ],
    executor: async ({ step }) => { executed.push(step.id); return { status: 'succeeded', exit_code: 0, stdout: step.id }; },
    verify: async ({ result, final }) => final ? executed.length === 2 : result.status === 'succeeded',
    policy: { max_steps: 5, max_attempts_per_step: 2, max_risk: 'low', max_runtime_ms: 5000 }
  });
  const result = await orchestrator.run('m1');
  assert.strictEqual(result.status, 'succeeded');
  assert.deepStrictEqual(executed, ['s1', 's2']);
  assert.strictEqual(store.missions.get('m1').completed_steps, 2);

  const blockedStore = makeStore();
  blockedStore.missions.set('m2', { mission_id: 'm2', goal: 'unknown', status: 'queued', current_step: 0, completed_steps: 0, checkpoint: {} });
  const blocked = createAutonomousMissionOrchestrator({
    missionStore: blockedStore,
    planner: async () => [],
    executor: async () => ({ status: 'succeeded' }),
    verify: async () => true
  });
  assert.strictEqual((await blocked.run('m2')).status, 'blocked');

  const riskStore = makeStore();
  riskStore.missions.set('m3', { mission_id: 'm3', goal: 'risky', status: 'queued', current_step: 0, completed_steps: 0, checkpoint: {} });
  const risk = createAutonomousMissionOrchestrator({
    missionStore: riskStore,
    planner: async () => [{ id: 'danger', action: 'delete', risk: 'high' }],
    executor: async () => { throw new Error('must not execute blocked step'); },
    verify: async () => true,
    policy: { max_risk: 'low' }
  });
  assert.strictEqual((await risk.run('m3')).reason, 'risk_blocked');

  console.log('AF-4 orchestrator tests passed');
})().catch(error => { console.error(error); process.exit(1); });
