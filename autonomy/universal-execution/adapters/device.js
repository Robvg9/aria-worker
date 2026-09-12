'use strict';

const SUPPORTED_OPERATIONS = Object.freeze(['shell.execute', 'ollama.qwen3']);

function createDeviceAdapter({ deviceDispatcher } = {}) {
  const available = !!deviceDispatcher && typeof deviceDispatcher.execute === 'function';

  return Object.freeze({
    adapter_id: 'device-runtime-v1.1',
    executor_type: 'device',
    status: available ? 'ready' : 'unavailable',
    operations: [...SUPPORTED_OPERATIONS],
    async execute({ missionId, step, attempt = 1, policy, request = {}, selection } = {}) {
      if (!step || typeof step !== 'object') throw new TypeError('step required');
      if (!SUPPORTED_OPERATIONS.includes(step.operation)) throw new Error(`unsupported device operation: ${step.operation}`);
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
          request,
          selection
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

module.exports = Object.freeze({ createDeviceAdapter, SUPPORTED_OPERATIONS });
