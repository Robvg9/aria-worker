'use strict';

const assert = require('assert');
const { createUniversalMissionRunner } = require('../autonomy/universal-mission');

(async () => {
  const missions = new Map([[
    'm-live', {
      mission_id: 'm-live',
      goal: 'execute locally with Qwen3',
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
      const next = { ...missions.get(id), ...patch, status };
      missions.set(id, next);
      return next;
    },
    async checkpoint(id, checkpoint, patch = {}) {
      const next = { ...missions.get(id), ...patch, checkpoint };
      missions.set(id, next);
      return next;
    }
  };

  const deviceCalls = [];
  const deviceDispatcher = {
    async execute(input) {
      deviceCalls.push(input);
      return {
        status: 'succeeded',
        exit_code: 0,
        stdout: 'ARIA_LOCAL_OK',
        job_id: 'job_windows_qwen3_test'
      };
    }
  };

  let planned = false;
  const planner = async ({ mission }) => {
    planned = mission.goal === 'execute locally with Qwen3';
    return [{
      id: 'local-qwen3',
      operation: 'ollama.qwen3',
      target: {
        type: 'device',
        device_id: 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
      },
      input: {
        prompt: 'Responde exactamente: ARIA_LOCAL_OK',
        model: 'qwen3:4b'
      },
      risk: 'low'
    }];
  };

  const verify = async ({ final, result }) => final ? true : result?.status === 'succeeded' && result?.stdout === 'ARIA_LOCAL_OK';

  const runner = createUniversalMissionRunner({
    missionStore,
    planner,
    verify,
    activation: { async execute() { return { status: 'succeeded' }; } },
    deviceDispatcher,
    policy: { enabled: true, max_risk: 'low', max_steps: 5, max_runtime_ms: 10000 }
  });

  const result = await runner.run('m-live');

  assert.strictEqual(planned, true);
  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(deviceCalls.length, 1);
  assert.strictEqual(deviceCalls[0].step.operation, 'ollama.qwen3');
  assert.strictEqual(deviceCalls[0].step.target.device_id, 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089');
  assert.strictEqual(deviceCalls[0].step.input.model, 'qwen3:4b');
  assert.strictEqual(missions.get('m-live').status, 'succeeded');
  assert.strictEqual(missions.get('m-live').completed_steps, 1);

  console.log('Autonomous Windows Qwen3 mission route: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
