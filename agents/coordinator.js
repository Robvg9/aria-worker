'use strict';
const { planDelegation } = require('./delegation');
const { createAgentMessage, normalizeAgentResult } = require('./message');
const { createAgentGuard } = require('./guard');

async function runAgentDelegation({ registry, from = 'aria', agent_id, task_id, objective, request = {}, depth = 0, max_depth = 2, executeAgent, guard = createAgentGuard({ max_depth, max_agents: 4, max_steps: 8 }) } = {}) {
  const plan = planDelegation({ registry, from, agent_id, task_id, objective, request, parent_depth: depth, max_depth });
  if (plan.status !== 'planned') return plan;
  if (!guard.canSpawn(plan.depth) || !guard.spawned()) return { status: 'blocked', reason: 'resource_limit' };
  try {
    const message = createAgentMessage({ message_id: `${task_id}:delegation`, task_id, from, to: agent_id, type: 'task', payload: { objective, request }, depth: plan.depth });
    if (typeof executeAgent !== 'function') return { status: 'blocked', reason: 'executor_not_injected', message };
    const raw = await executeAgent(message, plan);
    const result = normalizeAgentResult({ agent_id, task_id, ...(raw || {}) });
    return { status: 'completed', plan, result };
  } catch (e) {
    return { status: 'failed', plan, result: normalizeAgentResult({ agent_id, task_id, status: 'failed', error: 'agent_execution_failed', verified: false }) };
  } finally { guard.finished(); }
}

module.exports = { runAgentDelegation };