'use strict';

function createConnectorAdapter({ activation } = {}) {
  if (!activation || typeof activation.execute !== 'function') {
    throw new TypeError('activation.execute function required');
  }

  return Object.freeze({
    adapter_id: 'connector-runtime-v1',
    executor_type: 'connector',
    status: 'ready',
    async execute({ missionId, step, attempt = 1, policy, request = {} } = {}) {
      if (!step || typeof step !== 'object') throw new TypeError('step required');
      const connectorId = step.target?.connector_id || step.connector_id;
      const operation = step.operation;
      if (!connectorId) throw new Error('connector_id required');
      if (!operation) throw new Error('operation required');

      const context = {
        ...request,
        ...(step.input || {}),
        mission_id: missionId,
        attempt,
        policy: policy || step.policy || {},
        target: step.target || null
      };

      try {
        const result = await activation.execute(connectorId, operation, context);
        return { ...result, executor_type: 'connector', connector_id: connectorId, attempt };
      } catch (_error) {
        return {
          status: 'failed',
          executor_type: 'connector',
          connector_id: connectorId,
          attempt,
          error: {
            code: 'adapter_error',
            message: 'connector adapter execution failed'
          }
        };
      }
    }
  });
}

module.exports = Object.freeze({ createConnectorAdapter });
