'use strict';

const { selectExecutor } = require('./universal-execution/selector');
const { listExecutors } = require('./universal-execution/lookup');

function createUniversalExecutor({ activation, deviceDispatcher, agentExecutors = {}, executorRegistry = null } = {}) {
  if (!activation || typeof activation.execute !== 'function') throw new TypeError('activation runtime required');

  const registry = executorRegistry || { list: listExecutors };

  async function execute({ missionId, step, attempt, policy, request = {} } = {}) {
    if (!step || typeof step !== 'object') throw new TypeError('step required');

    const selected = selectExecutor(step, registry);
    const executorType = selected.type;

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
    const operation = step.operation;

    const context = {
      ...request,
      ...(step.input || {}),
      risk_class: step.risk_class || step.policy?.risk_class || request.risk_class,
      request_id: request.request_id || missionId,
      task_id: request.task_id || missionId,
      tool_id: step.tool_id || request.tool_id,
      target: step.target || request.target,
      policy_version: step.policy_version || request.policy_version,
      authorization_id: step.authorization_id || request.authorization_id,
      executor_selection: selected
    };

    const result = await activation.execute(connectorId, operation, context);
    return { ...result, executor_type: 'connector', connector_id: connectorId, executor_selection: selected };
  }

  return Object.freeze({ execute });
}

module.exports = Object.freeze({ createUniversalExecutor });
