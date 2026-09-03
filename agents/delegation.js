'use strict';
const { scopeAllows } = require('./scope');

function planDelegation({ registry, from, agent_id, task_id, objective, request = {}, parent_depth = 0, max_depth = 2 } = {}) {
  if (!registry || typeof task_id !== 'string' || !task_id || typeof objective !== 'string' || !objective) return { status: 'blocked', reason: 'invalid_request' };
  if (parent_depth >= max_depth) return { status: 'blocked', reason: 'max_depth' };
  const agent = registry.get(agent_id);
  if (!agent || agent.status !== 'available') return { status: 'blocked', reason: 'agent_unavailable' };
  const scope = agent.scope_object || { capabilities: agent.capabilities, tools: [], operations: [], max_risk: 'low' };
  if (!scopeAllows(scope, request)) return { status: 'blocked', reason: 'scope_denied' };
  return Object.freeze({
    status: 'planned', task_id, parent_agent: from || null, agent_id,
    objective, request: { ...request }, depth: parent_depth + 1
  });
}

module.exports = { planDelegation };