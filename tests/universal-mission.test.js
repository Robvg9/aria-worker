'use strict';

const assert = require('assert');
const { createUniversalMissionRunner } = require('../autonomy/universal-mission');

(async () => {
  const events = [];
  const missions = new Map([[
    'm1', {
      mission_id: 'm1',
      goal: 'exercise universal executors',
      status: 'queued',
      current_step: 0,
      completed_steps: 0,
      attempt_count: 0,
      checkpoint: {}
    }
  ]]);

  const missionStore = {
    async get(id) { return missions.get(id) || null; },
    async transition(id, status, patch = {}) {
      const current = missions.get(id);
      const next = { ...current, ...patch, status };
      missions.set(id, next);
      events.push({ type: 'transition', status });
      return next;
    },
    async checkpoint(id, checkpoint, patch = {}) {
      const current = missions.get(id);
      const next = { ...current, ...patch, checkpoint };
      missions.set(id, next);
      events.push({ type: 'checkpoint' });
      return next;
    }
  };

  const connectorCalls = [];
  const activation = {
    async execute(connectorId, operation, context) {
      connectorCalls.push({ connectorId, operation, context });
      return { status: 'succeeded', connector_id: connectorId, operation };
    }
  };

  const deviceCalls = [];
  const deviceDispatcher = {
    async execute({ missionId, step, attempt }) {
      deviceCalls.push({ missionId, step, attempt });
      return { status: 'succeeded', exit_code: 0, stdout: 'DEVICE_OK' };
    }
  };

  const agentCalls = [];
  const agentExecutors = {
    'agent.test': async input => {
      agentCalls.push(input);
      return { status: 'succeeded', output: 'AGENT_OK' };
    }
  };

  const planner = async () => [
    {
      id: 's1', action: 'connector.write', operation: 'write', risk: 'low',
      target: { connector_id: 'github' }, input: { path: 'README.md' }
    },
    {
      id: 's2', action: 'device.shell', operation: 'shell.execute', risk: 'low',
      target: { type: 'device', device_id: 'android-test' }, input: { command: 'echo ok' }
    },
    {
      id: 's3', action: 'agent.task', risk: 'low',
      target: { type: 'agent', agent_id: 'agent.test' }, input: { prompt: 'finish' }
    }
  ];

  const verify = async ({ final, result }) => final ? true : result?.status === 'succeeded';

  const runner = createUniversalMissionRunner({
    missionStore,
    planner,
    verify,
    activation,
    deviceDispatcher,
    agentExecutors,
    policy: { enabled: true, max_risk: 'low', max_steps: 10, max_runtime_ms: 10000 }
  });

  assert.strictEqual(typeof runner.run, 'function');
  assert.strictEqual(typeof runner.executor.execute, 'function');
  assert.strictEqual(typeof runner.orchestrator.run, 'function');

  const result = await runner.run('m1');
  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(connectorCalls.length, 1);
  assert.strictEqual(deviceCalls.length, 1);
  assert.strictEqual(agentCalls.length, 1);
  assert.strictEqual(missions.get('m1').completed_steps, 3);
  assert.strictEqual(missions.get('m1').status, 'succeeded');
  assert.ok(events.some(event => event.status === 'running'));

  console.log('Universal mission orchestration: PASS — connector + device + agent chain');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
