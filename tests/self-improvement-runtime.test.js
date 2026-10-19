'use strict';

const assert = require('node:assert/strict');
const { createUniversalExecutor } = require('../autonomy/universal-executor');

async function main() {
  const received = [];
  const selfImprovement = {
    engine: {
      run: async signal => {
        received.push(signal);
        return {
          status: 'completed',
          version: 'self-improvement-v1',
          stop_reason: 'verified',
          evidence_hash: 'test-evidence'
        };
      }
    }
  };

  const runtime = createUniversalExecutor({
    activation: { execute: async () => ({ status: 'succeeded' }) },
    deviceDispatcher: { execute: async () => ({ status: 'succeeded' }) },
    selfImprovement
  });

  const result = await runtime.execute({
    missionId: 'mission-self-improvement-001',
    step: {
      id: 'step-self-improve',
      operation: 'self.improve',
      executor_type: 'self_improvement',
      target: { type: 'self_improvement', engine_id: 'self-improvement-engine-v1' },
      input: {
        goal: 'Improve a safe reliability path',
        category: 'reliability',
        proposed_changes: [{ path: 'autonomy/demo.js', risk_level: 'low', content: 'ok' }],
        approve_promote: true,
        approve_deploy: true
      }
    },
    policy: { max_risk: 'low' }
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.executor_type, 'self_improvement');
  assert.equal(result.operation, 'self.improve');
  assert.equal(result.human_gate_preserved, true);
  assert.equal(received.length, 1);
  assert.equal(received[0].approve_promote, false);
  assert.equal(received[0].approve_deploy, false);
  assert.equal(received[0].goal, 'Improve a safe reliability path');

  const listed = runtime.adapters.list().find(item => item.executor_type === 'self_improvement');
  assert.ok(listed);
  assert.deepEqual(listed.operations, ['self.improve']);

  await assert.rejects(
    () => runtime.execute({
      missionId: 'mission-self-improvement-002',
      step: {
        id: 'step-missing-target',
        operation: 'self.improve',
        executor_type: 'self_improvement',
        target: { type: 'self_improvement' },
        input: { goal: 'Should not run' }
      }
    }),
    /target engine_id missing/
  );
  assert.equal(received.length, 1);

  console.log('SELF_IMPROVEMENT_RUNTIME_V1_OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
