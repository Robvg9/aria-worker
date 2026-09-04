'use strict';

const assert = require('assert');
const { createUniversalExecutor } = require('../autonomy/universal-executor');

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
    step: {
      id: 's1',
      operation: 'repo_read',
      target: { type: 'connector', connector_id: 'github' },
      input: { owner: 'Robvg9', repo: 'aria-worker' },
      risk_class: 'READ'
    }
  });
  assert.strictEqual(connectorResult.status, 'succeeded');
  assert.strictEqual(calls[0].connectorId, 'github');

  const deviceResult = await universal.execute({
    missionId: 'm1',
    step: {
      id: 's2',
      operation: 'shell.execute',
      executor_type: 'device',
      target: { type: 'device', device_id: 'android-termux-test' },
      input: { command: 'echo ok' }
    }
  });
  assert.strictEqual(deviceResult.status, 'succeeded');
  assert.strictEqual(calls[1].device, 'android-termux-test');

  const universalAgent = createUniversalExecutor({
    activation,
    agentExecutors: {
      grok: async ({ step }) => ({ status: 'succeeded', agent_id: step.target.agent_id })
    }
  });
  const agentResult = await universalAgent.execute({
    missionId: 'm2',
    step: { id: 's3', operation: 'delegate', executor_type: 'agent', target: { agent_id: 'grok' } }
  });
  assert.strictEqual(agentResult.agent_id, 'grok');

  console.log('universal executor tests passed');
})().catch(error => { console.error(error); process.exit(1); });
