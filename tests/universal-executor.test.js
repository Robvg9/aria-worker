'use strict';

const assert = require('assert');
const { createUniversalExecutor } = require('../autonomy/universal-executor');
const { createAriaRuntime } = require('../activation/bootstrap');

(async () => {
  const calls = [];
  const activation = {
    async execute(connectorId, operation, context) {
      calls.push({ connectorId, operation, context });
      return { status: 'succeeded', connector_id: connectorId, operation, data: { ok: true } };
    }
  };

  const deviceDispatcher = {
    async execute(input) {
      calls.push({ device: input.step.target.device_id, step: input.step.id });
      return { status: 'succeeded', exit_code: 0 };
    }
  };

  const universal = createUniversalExecutor({ activation, deviceDispatcher });

  const connectorResult = await universal.execute({
    missionId: 'm1',
    step: { id: 's1', operation: 'repo_read', target: { type: 'connector', connector_id: 'github' }, input: { owner: 'Robvg9', repo: 'aria-worker' }, risk_class: 'READ' }
  });
  assert.strictEqual(connectorResult.status, 'succeeded');
  assert.strictEqual(calls[0].connectorId, 'github');

  const deviceResult = await universal.execute({
    missionId: 'm1',
    step: { id: 's2', operation: 'shell.execute', executor_type: 'device', target: { type: 'device', device_id: 'android-termux-test' }, input: { command: 'echo ok' } }
  });
  assert.strictEqual(deviceResult.status, 'succeeded');
  assert.strictEqual(calls[1].device, 'android-termux-test');

  const universalAgent = createUniversalExecutor({
    activation,
    agentExecutors: { grok: async ({ step }) => ({ status: 'succeeded', agent_id: step.target.agent_id }) }
  });
  const agentResult = await universalAgent.execute({
    missionId: 'm2', step: { id: 's3', operation: 'delegate', executor_type: 'agent', target: { agent_id: 'grok' } }
  });
  assert.strictEqual(agentResult.agent_id, 'grok');

  const modelCalls = [];
  const modelExecution = {
    async execute(request) {
      modelCalls.push(request);
      return {
        execution_id: 'exec_model_test',
        status: 'succeeded',
        route: request.selected_route,
        response: { output_text: 'model ok' },
        usage: { status: 'known', prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
        metadata: { engine_version: 'test', canonical_write: false }
      };
    }
  };
  const universalModel = createUniversalExecutor({ activation, deviceDispatcher, modelExecution });
  const modelResult = await universalModel.execute({
    missionId: 'm3',
    step: {
      id: 's4',
      operation: 'text_generation',
      executor_type: 'model',
      target: { type: 'model', provider_id: 'openrouter', account_id: 'acct_openrouter_primary', model_id: 'google/gemini-2.5-flash-lite' },
      authorization: { status: 'approved', risk_class: 'READ', evidence_ref: 'test:model' },
      input: { payload: { prompt: 'hello' } }
    }
  });
  assert.strictEqual(modelResult.status, 'succeeded');
  assert.strictEqual(modelResult.executor_type, 'model');
  assert.strictEqual(modelResult.model_execution, true);
  assert.strictEqual(modelCalls.length, 1);
  assert.deepStrictEqual(modelCalls[0].selected_route, {
    status: 'selected', provider_id: 'openrouter', account_id: 'acct_openrouter_primary', model_id: 'google/gemini-2.5-flash-lite', capability: 'text_generation'
  });
  assert.strictEqual(modelCalls[0].authorization.status, 'approved');

  const runtime = createAriaRuntime();
  assert.strictEqual(typeof runtime.autonomy.universalExecutor.createUniversalExecutor, 'function');
  assert.strictEqual(typeof runtime.execution.deviceDispatcher.createDeviceDispatcher, 'function');

  console.log('universal executor tests passed');
})().catch(error => { console.error(error); process.exit(1); });
