'use strict';

const assert = require('node:assert/strict');
const { createUniversalExecutor } = require('../autonomy/universal-executor');

(async () => {
  const calls = [];
  const activation = { async execute(connectorId, operation, context) { calls.push({ type: 'connector', connectorId, operation, context }); return { status: 'succeeded', value: 'CONNECTOR_OK' }; } };
  const deviceDispatcher = { async execute(input) { calls.push({ type: 'device', input }); return { status: 'succeeded', exit_code: 0, stdout: 'DEVICE_OK' }; } };
  const agentExecutors = { 'agent.test': async input => { calls.push({ type: 'agent', input }); return { status: 'succeeded', output: 'AGENT_OK' }; } };
  const modelExecution = { async execute(input) { calls.push({ type: 'model', input }); return { status: 'succeeded', response: { output_text: 'MODEL_OK' } }; } };

  const executorRegistry = { list: () => [
    { executor_id: 'connector', type: 'connector', status: 'ready', operations: ['repo.read'] },
    { executor_id: 'device', type: 'device', status: 'ready', operations: ['shell.execute'] },
    { executor_id: 'agent', type: 'agent', status: 'ready', operations: ['delegate'] },
    { executor_id: 'model', type: 'model', status: 'registered', availability: 'available', operations: ['text_generation'] }
  ] };

  const executor = createUniversalExecutor({ activation, deviceDispatcher, agentExecutors, modelExecution, executorRegistry });

  const connectorResult = await executor.execute({ missionId: 'm-u04', step: { operation: 'repo.read', target: { type: 'connector', connector_id: 'github' }, input: { path: 'README.md' } } });
  assert.strictEqual(connectorResult.status, 'succeeded');
  assert.strictEqual(connectorResult.executor_type, 'connector');

  const deviceResult = await executor.execute({ missionId: 'm-u04', step: { operation: 'shell.execute', target: { type: 'device', device_id: 'android-termux' }, input: { command: 'pwd' } } });
  assert.strictEqual(deviceResult.status, 'succeeded');
  assert.strictEqual(deviceResult.executor_type, 'device');

  const agentResult = await executor.execute({ missionId: 'm-u04', step: { operation: 'delegate', target: { type: 'agent', agent_id: 'agent.test' }, input: { prompt: 'ok' } } });
  assert.strictEqual(agentResult.status, 'succeeded');
  assert.strictEqual(agentResult.executor_type, 'agent');

  const modelResult = await executor.execute({ missionId: 'm-u04', step: {
    operation: 'text_generation', executor_type: 'model',
    target: { type: 'model', provider_id: 'openrouter', account_id: 'acct_openrouter_primary', model_id: 'google/gemini-2.5-flash-lite' },
    authorization: { status: 'approved', risk_class: 'READ', evidence_ref: 'u04:model' },
    input: { payload: { prompt: 'ok' } }
  } });
  assert.strictEqual(modelResult.status, 'succeeded');
  assert.strictEqual(modelResult.executor_type, 'model');
  assert.strictEqual(modelResult.model_execution, true);

  assert.deepStrictEqual(calls.map(call => call.type), ['connector', 'device', 'agent', 'model']);
  assert.ok(calls[0].context);
  assert.strictEqual(calls[0].context.target.connector_id, 'github');
  assert.strictEqual(calls[1].input.step.target.device_id, 'android-termux');
  assert.strictEqual(calls[2].input.step.target.agent_id, 'agent.test');
  assert.strictEqual(calls[3].input.selected_route.model_id, 'google/gemini-2.5-flash-lite');

  const unavailableExecutor = createUniversalExecutor({ activation, deviceDispatcher, agentExecutors, modelExecution, executorRegistry, adapterRegistry: { get: () => null } });
  const blocked = await unavailableExecutor.execute({ missionId: 'm-u04', step: { operation: 'shell.execute', target: { type: 'device', device_id: 'android-termux' } } });
  assert.strictEqual(blocked.status, 'blocked');
  assert.strictEqual(blocked.reason, 'executor_adapter_unavailable');

  console.log('UO-4 dispatch integration tests passed');
})().catch(error => { console.error(error); process.exit(1); });
