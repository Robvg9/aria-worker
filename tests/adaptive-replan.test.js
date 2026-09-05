'use strict';

const assert = require('assert');
const { createAutonomousMissionOrchestrator } = require('../autonomy/orchestrator');

(async () => {
  const mission = {
    mission_id: 'replan-test',
    status: 'queued',
    goal: 'adaptive plan test',
    current_step: 0,
    completed_steps: 0,
    checkpoint: {}
  };
  const calls = [];
  const store = {
    async get() { return mission; },
    async transition(_id, status, patch = {}) { mission.status = status; Object.assign(mission, patch); calls.push(['transition', status]); return mission; },
    async checkpoint(_id, checkpoint, patch = {}) { mission.checkpoint = checkpoint; Object.assign(mission, patch); calls.push(['checkpoint']); return mission; }
  };
  let executions = 0;
  const orchestrator = createAutonomousMissionOrchestrator({
    missionStore: store,
    planner: async () => [{ id: 'a', action: 'bad', operation: 'op', target: { type: 'x' }, retryable: false }],
    replanner: async () => [{ id: 'b', action: 'good', operation: 'op', target: { type: 'x' } }],
    executor: async ({ step }) => { executions += 1; return { status: step.id === 'a' ? 'failed' : 'succeeded', executor_type: 'test' }; },
    verify: async ({ step, final }) => final ? true : step.id === 'b',
    policy: { enabled: true, max_risk: 'critical', max_replans: 1, max_steps: 10 }
  });

  const result = await orchestrator.run('replan-test');
  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(executions, 2);
  assert.strictEqual(mission.checkpoint.replan_count, 1);
  assert.ok(calls.some(([kind, status]) => kind === 'transition' && status === 'succeeded'));
  console.log('adaptive-replan.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
