'use strict';

const assert = require('assert');
const { createAdapterRegistry } = require('../autonomy/universal-execution/adapters');

(async () => {
  const calls = [];

  const activation = {
    async execute(connectorId, operation, context) {
      calls.push({ connectorId, operation, context });
      return { status: 'succeeded', data: { ok: true } };
    }
  };

  const deviceDispatcher = {
    async execute(input) {
      calls.push({ device: input.step.target.device_id, step: input.step.id });
      return { status: 'succeeded', exit_code: 0 };
    }
  };

  const registry = createAdapterRegistry({
    activation,
    deviceDispatcher,
    agentExecutors: {
      test_agent: async ({ step }) => ({ status: 'succeeded', agent_id: step.target.agent_id })
    }
  });

  assert.deepStrictEqual(
    registry.list().map(x => x.executor_type),
    ['connector', 'device', 'agent']
  );

  const connector = registry.get('connector');
  const device = registry.get('device');
  const agent = registry.get('agent');
  assert.ok(connector && device && agent);

  const connectorResult = await connector.execute({
    missionId: 'u02-m1',
    step: {
      id: 's1',
      operation: 'repo_read',
      target: { type: 'connector', connector_id: 'github' },
      input: { owner: 'Robvg9', repo: 'aria-worker' }
    }
  });
  assert.strictEqual(connectorResult.status, 'succeeded');
  assert.strictEqual(connectorResult.connector_id, 'github');
  assert.strictEqual(calls[0].connectorId, 'github');

  const deviceResult = await device.execute({
    missionId: 'u02-m1',
    step: {
      id: 's2',
      operation: 'shell.execute',
      target: { type: 'device', device_id: 'android-termux' },
      input: { command: 'echo ok' }
    }
  });
  assert.strictEqual(deviceResult.status, 'succeeded');
  assert.strictEqual(deviceResult.exit_code, 0);
  assert.strictEqual(calls[1].device, 'android-termux');

  const agentResult = await agent.execute({
    missionId: 'u02-m1',
    step: { id: 's3', operation: 'delegate', target: { type: 'agent', agent_id: 'test_agent' } }
  });
  assert.strictEqual(agentResult.status, 'succeeded');
  assert.strictEqual(agentResult.agent_id, 'test_agent');

  const missingAgent = await agent.execute({
    missionId: 'u02-m1',
    step: { id: 's4', operation: 'delegate', target: { type: 'agent', agent_id: 'missing_agent' } }
  });
  assert.strictEqual(missingAgent.status, 'blocked');
  assert.strictEqual(missingAgent.reason, 'agent_executor_unavailable');

  assert.strictEqual(registry.get('unknown'), null);

  const secret = 'SUPER-SECRET-SENTINEL';
  const throwingActivation = {
    async execute() {
      throw new Error(`provider failure ${secret}`);
    }
  };
  const secretRegistry = createAdapterRegistry({ activation: throwingActivation, deviceDispatcher });
  const failed = await secretRegistry.get('connector').execute({
    missionId: 'u02-secret',
    step: { id: 's1', operation: 'repo_read', target: { type: 'connector', connector_id: 'github' } }
  });
  assert.strictEqual(failed.status, 'failed');
  assert.strictEqual(failed.error.code, 'adapter_error');
  assert.ok(!JSON.stringify(failed).includes(secret));

  console.log('UO-2 executor adapters tests passed');
})().catch(error => { console.error(error); process.exit(1); });
