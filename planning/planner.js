'use strict';

/**
 * ARIA Planning Engine — Mission 1.3
 * Produces validated execution plans; never executes tools.
 */

const ALLOWED_STEP_STATES = Object.freeze(['planned']);

function normalizeTask(task) {
  if (typeof task === 'string') return task.trim();
  if (task && typeof task === 'object' && typeof task.goal === 'string') return task.goal.trim();
  throw new TypeError('task must be a non-empty string or { goal }');
}

function makePlan(task, deps = {}) {
  const goal = normalizeTask(task);
  if (!goal) throw new TypeError('task goal cannot be empty');

  const discoverTools = typeof deps.discoverTools === 'function' ? deps.discoverTools : () => [];
  const tools = [...discoverTools(goal)].filter((t) => t && typeof t.id === 'string');
  const requested = typeof deps.strategy === 'function' ? deps.strategy({ goal, tools }) : [];

  const steps = (Array.isArray(requested) ? requested : []).map((step, index) => {
    if (!step || typeof step !== 'object' || typeof step.action !== 'string' || !step.action.trim()) {
      throw new TypeError(`invalid plan step at index ${index}`);
    }
    return Object.freeze({
      id: step.id || `step_${index + 1}`,
      action: step.action.trim(),
      tool_id: step.tool_id || null,
      state: 'planned',
      depends_on: Array.isArray(step.depends_on) ? [...step.depends_on] : []
    });
  });

  // Every dependency must reference a prior step; no implicit cycles/order changes.
  const ids = new Set();
  for (const step of steps) {
    if (ids.has(step.id)) throw new Error('duplicate_step_id');
    for (const dep of step.depends_on) if (!ids.has(dep)) throw new Error('forward_or_unknown_dependency');
    ids.add(step.id);
  }

  return Object.freeze({
    plan_version: 'aria-planner-v1.0.0',
    goal,
    tools: tools.map((t) => ({ id: t.id, capability: t.capability || null })),
    steps,
    execution_authority: 'governance-gated'
  });
}

module.exports = { ALLOWED_STEP_STATES, normalizeTask, makePlan };
