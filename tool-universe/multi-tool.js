'use strict';

function createMultiToolExecutor({ router, gateway } = {}) {
  if (!router || typeof router.route !== 'function') throw new TypeError('router is required');
  if (!gateway || typeof gateway.execute !== 'function') throw new TypeError('gateway is required');
  async function execute(plan, context = {}) {
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error('invalid_plan');
    const results = [];
    const completed = new Set();
    for (const step of plan.steps) {
      const deps = Array.isArray(step.depends_on) ? step.depends_on : [];
      if (deps.some((id) => !completed.has(id))) return { status: 'blocked', reason: 'dependency_not_satisfied', results };
      const route = await router.route({
        ...context,
        tool_id: step.tool_id,
        operation: step.operation || step.action,
        risk_level: step.risk_level || context.risk_level || null
      });
      if (!route || route.status !== 'selected') return { status: 'blocked', reason: 'tool_route_unavailable', step_id: step.id, results };
      const result = await gateway.execute({ route, step, context });
      results.push({ step_id: step.id, route, result });
      if (!result || !['succeeded','completed'].includes(result.status)) return { status: 'failed', reason: 'step_failed', step_id: step.id, results };
      completed.add(step.id);
    }
    return { status: 'succeeded', results };
  }
  return Object.freeze({ execute });
}

module.exports = { createMultiToolExecutor };
