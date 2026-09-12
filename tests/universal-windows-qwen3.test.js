'use strict';

const assert = require('assert');
const { createUniversalExecutor } = require('../autonomy/universal-executor');

(async () => {
  const calls = [];
  const activation = { async execute() { return { status: 'succeeded' }; } };
  const deviceDispatcher = {
    async execute(input) {
      calls.push(input);
      return { status: 'succeeded', exit_code: 0, stdout: 'ARIA_LOCAL_OK' };
    }
  };

  const universal = createUniversalExecutor({ activation, deviceDispatcher });
  const result = await universal.execute({
    missionId: 'windows-qwen3-certification',
    step: {
      id: 'local-qwen3',
      operation: 'ollama.qwen3',
      target: { type: 'device', device_id: 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089' },
      input: { prompt: 'Responde exactamente: ARIA_LOCAL_OK', model: 'qwen3:4b' },
      risk_class: 'READ'
    }
  });

  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(result.executor_type, 'device');
  assert.strictEqual(result.stdout, 'ARIA_LOCAL_OK');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].step.operation, 'ollama.qwen3');
  assert.strictEqual(calls[0].step.target.device_id, 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089');

  console.log('universal Windows qwen3 route test passed');
})().catch(error => { console.error(error); process.exit(1); });
