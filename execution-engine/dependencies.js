'use strict';

function normalizeSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0) throw new TypeError('steps_required');
  const ids = new Set();
  const byId = new Map();
  for (const step of steps) {
    if (!step || typeof step.id !== 'string' || !step.id) throw new TypeError('invalid_step');
    if (ids.has(step.id)) throw new Error('duplicate_step_id');
    const dependsOn = Array.isArray(step.depends_on) ? [...step.depends_on] : [];
    ids.add(step.id);
    byId.set(step.id, { ...step, depends_on: dependsOn });
  }
  for (const step of byId.values()) for (const dep of step.depends_on) {
    if (!byId.has(dep)) throw new Error('unknown_dependency');
    if (dep === step.id) throw new Error('self_dependency');
  }
  return [...byId.values()];
}

function topologicalOrder(steps) {
  const normalized = normalizeSteps(steps);
  const remaining = new Map(normalized.map(s => [s.id, new Set(s.depends_on)]));
  const order = [];
  while (remaining.size) {
    const ready = [...remaining.entries()].filter(([, deps]) => deps.size === 0).map(([id]) => id).sort();
    if (!ready.length) throw new Error('dependency_cycle');
    for (const id of ready) {
      order.push(id);
      remaining.delete(id);
      for (const deps of remaining.values()) deps.delete(id);
    }
  }
  return order;
}

module.exports = { normalizeSteps, topologicalOrder };
