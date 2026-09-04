'use strict';

const assert = require('assert');
const { createAutonomousMissionOrchestrator } = require('../autonomy/orchestrator');

(async () => {
  function createStore(initial) {
    const state = JSON.parse(JSON.stringify(initial));
    return {
      async get() { return JSON.parse(JSON.stringify(state)); },
      async transition(_id, status, patch = {}) {
        state.status = status;
        Object.assign(state, patch);
        return JSON.parse(JSON.stringify(state));
      },
      async checkpoint(_id, checkpoint = {}, patch = {}) {
        state.checkpoint = JSON.parse(JSON.stringify(checkpoint));
        Object.assign(state, patch);
        return JSON.parse(JSON.stringify(state));
      },
      state
    };
  }

  const plan = [
    { id: 'step_1', operation: 'noop', executor_type: 'device', risk: 'low', retryable: true },
    { id: 'step_2', operation: 'noop', executor_type: 'device', risk: 'low', retryable: false },
    { id: 'step_3', operation: 'noop', executor_type: 'device', risk: 'low', retryable: false }
  ];

  {
    const store = createStore({ mission_id: 'u06-retry', status: 'queued', checkpoint: {} });
    let calls = 0;
    const orchestrator = createAutonomousMissionOrchestrator({
      missionStore: store,
      planner: async () => plan,
      executor: async ({ step }) => {
        calls += 1;
        if (step.id === 'step_1' && calls === 1) return { status: 'failed', stderr: 'transient' };
        return { status: 'succeeded', stdout: step.id };
      },
      verify: async ({ final, result }) => final ? true : result?.status === 'succeeded',
      policy: { enabled: true, max_steps: 10, max_runtime_ms: 10000, max_risk: 'low' }
    });
    const result = await orchestrator.run('u06-retry');
    assert.strictEqual(result.status, 'succeeded');
    assert.strictEqual(calls, 4);
    assert.strictEqual(store.state.completed_steps, 3);
  }

  {
    const store = createStore({
      mission_id: 'u06-resume',
      status: 'paused',
      completed_steps: 2,
      current_step: 2,
      checkpoint: { plan, completed_step: 'step_2', completed_steps: ['step_1', 'step_2'] }
    });
    const calls = [];
    const orchestrator = createAutonomousMissionOrchestrator({
      missionStore: store,
      planner: async () => { throw new Error('planner must not run on checkpoint resume'); },
      executor: async ({ step }) => {
        calls.push(step.id);
        return { status: 'succeeded', stdout: step.id };
      },
      verify: async ({ final, result }) => final ? true : result?.status === 'succeeded',
      policy: { enabled: true, max_steps: 10, max_runtime_ms: 10000, max_risk: 'low' }
    });
    const result = await orchestrator.run('u06-resume');
    assert.strictEqual(result.status, 'succeeded');
    assert.deepStrictEqual(calls, ['step_3']);
    assert.strictEqual(store.state.completed_steps, 3);
  }

  {
    const store = createStore({ mission_id: 'u06-verify', status: 'queued', checkpoint: {} });
    let calls = 0;
    const orchestrator = createAutonomousMissionOrchestrator({
      missionStore: store,
      planner: async () => plan.slice(0, 1),
      executor: async () => { calls += 1; return { status: 'succeeded' }; },
      verify: async ({ final }) => final ? false : false,
      policy: { enabled: true, max_steps: 10, max_runtime_ms: 10000, max_risk: 'low', max_attempts_per_step: 1 }
    });
    const result = await orchestrator.run('u06-verify');
    assert.strictEqual(result.status, 'failed');
    assert.strictEqual(calls, 1);
    assert.strictEqual(store.state.completed_steps || 0, 0);
    assert.strictEqual(store.state.next_action, 'recover_or_human_gate');
  }

  console.log('UO-6 recovery + resume tests passed');
})().catch(error => { console.error(error); process.exit(1); });
