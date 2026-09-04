'use strict';

function createUniversalExecutor({ activation, deviceDispatcher, agentExecutors = {} } = {}) {
  if (!activation || typeof activation.execute !== 'function') throw new TypeError('activation runtime required');

  async function execute({ missionId, step, attempt, policy, request = {} } = {}) {
    if (!step || typeof step !== 'object') throw new TypeError('step required');

    const executorType = step.executor_type || step.target?.type || step.target?.executor_type || null;

    if (executorType === 'device') {
      if (!deviceDispatcher || typeof deviceDispatcher.execute !== 'function') throw new Error('device dispatcher unavailable');
      return deviceDispatcher.execute({ missionId, step, attempt, policy, request });
    }

    if (executorType === 'agent') {
      const agentId = step.target?.agent_id || step.agent_id;
      const fn = agentId && agentExecutors[agentId];
      if (typeof fn !== 'function') throw new Error('agent executor unavailable');
      return fn({ missionId, step, attempt, policy, request });
    }

    const connectorId = step.target?.connector_id || step.connector_id;
    if (!connectorId) throw new Error('executor target missing');
    const operation = step.operation;
    if (!operation) throw new Error('step operation missing');

    const context = {
      ...request,
      ...(step.input || {}),
      risk_class: step.risk_class || step.policy?.risk_class || request.risk_class,
      request_id: request.request_id || missionId,
      task_id: request.task_id || missionId,
      tool_id: step.tool_id || request.tool_id,
      target: step.target || request.target,
      policy_version: step.policy_version || request.policy_version,
      authorization_id: step.authorization_id || request.authorization_id
    };

    const result = await activation.execute(connectorId, operation, context);
    return { ...result, executor_type: 'connector', connector_id: connectorId };
  }

  return Object.freeze({ execute });
}

module.exports = Object.freeze({ createUniversalExecutor });
