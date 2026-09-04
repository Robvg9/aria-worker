'use strict';

function createDeviceAdapter({ deviceDispatcher } = {}) {
  if (!deviceDispatcher || typeof deviceDispatcher.execute !== 'function') {
    throw new TypeError('deviceDispatcher.execute function required');
  }

  return Object.freeze({
    adapter_id: 'device-runtime-v1',
    executor_type: 'device',
    status: 'ready',
    operations: ['shell.execute'],
    async execute({ missionId, step, attempt = 1, policy, request = {} } = {}) {
      if (!step || typeof step !== 'object') throw new TypeError('step required');
      if (step.operation !== 'shell.execute') throw new Error(`unsupported device operation: ${step.operation}`);

      try {
        const result = await deviceDispatcher.execute({
          missionId,
          step,
          attempt,
          policy,
          request
        });
        return { ...result, executor_type: 'device', attempt };
      } catch (_error) {
        return {
          status: 'failed',
          executor_type: 'device',
          attempt,
          error: {
            code: 'adapter_error',
            message: 'device adapter execution failed'
          }
        };
      }
    }
  });
}

module.exports = Object.freeze({ createDeviceAdapter });
