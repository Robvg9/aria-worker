'use strict';

function createDeviceAdapter({ deviceDispatcher } = {}) {
  const available = !!deviceDispatcher && typeof deviceDispatcher.execute === 'function';

  return Object.freeze({
    adapter_id: 'device-runtime-v1',
    executor_type: 'device',
    status: available ? 'ready' : 'unavailable',
    operations: ['shell.execute'],
    async execute({ missionId, step, attempt = 1, policy, request = {} } = {}) {
      if (!step || typeof step !== 'object') throw new TypeError('step required');
      if (step.operation !== 'shell.execute') throw new Error(`unsupported device operation: ${step.operation}`);
      if (!available) {
        return {
          status: 'blocked',
          executor_type: 'device',
          attempt,
          reason: 'device_dispatcher_unavailable'
        };
      }

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
