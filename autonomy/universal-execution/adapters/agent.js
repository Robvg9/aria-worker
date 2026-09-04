'use strict';

function createAgentAdapter({ agentExecutors = {} } = {}) {
  return Object.freeze({
    adapter_id: 'agent-runtime-v1',
    executor_type: 'agent',
    status: 'ready',
    operations: ['delegate'],
    async execute({ missionId, step, attempt = 1, policy, request = {} } = {}) {
      if (!step || typeof step !== 'object') throw new TypeError('step required');
      const agentId = step.target?.agent_id || step.agent_id;
      if (!agentId) throw new Error('agent_id required');
      const fn = agentExecutors[agentId];
      if (typeof fn !== 'function') {
        return {
          status: 'blocked',
          executor_type: 'agent',
          agent_id: agentId,
          attempt,
          reason: 'agent_executor_unavailable'
        };
      }

      try {
        const result = await fn({ missionId, step, attempt, policy, request });
        return { ...result, executor_type: 'agent', agent_id: agentId, attempt };
      } catch (_error) {
        return {
          status: 'failed',
          executor_type: 'agent',
          agent_id: agentId,
          attempt,
          error: {
            code: 'adapter_error',
            message: 'agent adapter execution failed'
          }
        };
      }
    }
  });
}

module.exports = Object.freeze({ createAgentAdapter });
