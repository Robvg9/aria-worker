'use strict';

const assert = require('assert');
const { createUniversalExecutor } = require('../autonomy/universal-executor');

(async () => {
  const calls = [];
  const activation = {
    async execute(connectorId, operation, context) {
      calls.push({ type: 'connector', connectorId, operation, context });
      return { status: 'succeeded', value: 'CONNECTOR_OK' };
    }
  };
  const deviceDispatcher = {
    async execute(input) {
      calls.push({ type: 'device', input });
      return { status: 'succeeded', exit_code: 0, stdout: 'DEVICE_OK' };
    }
  };
  const agentExecutors = {
    'agent.test': async input => {
      calls.push({ type: 'agent', input });
      return { status: 'succeeded', output: 'AGENT_OK' };
    }
  };

  const executorRegistry = {
    list: () => [
      { executor_id: 'connector', type: 'connector', status: 'ready', operations: ['repo.read'] },
      { executor_id: 'device', type: 'device', status: 'ready', operations: ['shell.execute'] },
      { executor_id: 'agent', type: 'agent', status: 'ready', operations: ['delegate'] }
    ]
  };

  const executor = createUniversalExecutor({
    activation,
    deviceDispatcher,
    agentExecutors,
    executorRegistry
  });

  const connectorResult = await executor.execute({
    missionId: 'm-u04',
    step: { operation: 'repo.read', target: { type: 'connector', connector_id: 'github' }, input: { path: 'README.md' } }
  });
  assert.strictEqual(connectorResult.status, 'succeeded');
  assert.strictEqual(connectorResult.executor_type, 'connector');

  const deviceResult = await executor.execute({
    missionId: 'm-u04',
    step: { operation: 'shell.execute', target: { type: 'device', device_id: 'android-termux' }, input: { command: 'pwd' } }
  });
  assert.strictEqual(deviceResult.status, 'succeeded');
  assert.strictEqual(deviceResult.executor_type, 'device');

  const agentResult = await executor.execute({
    missionId: 'm-u04',
    step: { operation: 'delegate', target: { type: 'agent', agent_id: 'agent.test' }, input: { prompt: 'ok' } }
  });
  assert.strictEqual(agentResult.status, 'succeeded');
  assert.strictEqual(agentResult.executor_type, 'agent');

  assert.deepStrictEqual(calls.map(call => call.type), ['connector', 'device', 'agent']);
  assert.ok(calls[0].context);
  assert.strictEqual(calls[0].context.target.connector_id, 'github');
  assert.strictEqual(calls[1].input.step.target.device_id, 'android-termux');
  assert.strictEqual(calls[2].input.step.target.agent_id, 'agent.test');

  const unavailableExecutor = createUniversalExecutor({
    activation,
    deviceDispatcher,
    agentExecutors,
    executorRegistry,
    adapterRegistry: { get: () => null }
  });
  const blocked = await unavailableExecutor.execute({
    missionId: 'm-u04',
    step: { operation: 'shell.execute', target: { type: 'device', device_id: 'android-termux' } }
  });
  assert.strictEqual(blocked.status, 'blocked');
  assert.strictEqual(blocked.reason, 'executor_adapter_unavailable');

  console.log('UO-4 dispatch integration tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
