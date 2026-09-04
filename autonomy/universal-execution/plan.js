'use strict';

function normalizePlan(plan) {
  if (!Array.isArray(plan) || plan.length === 0) {
    throw new Error('plan_missing');
  }

  const ids = new Set();
  const normalized = plan.map((step, index) => {
    if (!step || typeof step !== 'object') throw new Error(`invalid_step:${index}`);
    const id = step.id || `step_${index + 1}`;
    if (ids.has(id)) throw new Error(`duplicate_step_id:${id}`);
    ids.add(id);
    const dependsOn = step.depends_on == null ? [] : step.depends_on;
    if (!Array.isArray(dependsOn)) throw new Error(`invalid_depends_on:${id}`);
    return Object.freeze({ ...step, id, depends_on: [...dependsOn] });
  });

  const byId = new Map(normalized.map(step => [step.id, step]));
  for (const step of normalized) {
    for (const dep of step.depends_on) {
      if (dep === step.id) throw new Error(`self_dependency:${step.id}`);
      if (!byId.has(dep)) throw new Error(`unknown_dependency:${step.id}:${dep}`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`dependency_cycle:${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).depends_on) visit(dep);
    visiting.delete(id);
    visited.add(id);
  }
  for (const step of normalized) visit(step.id);

  return normalized;
}

function dependenciesSatisfied(step, completedIds) {
  return step.depends_on.every(dep => completedIds.has(dep));
}

function nextReadyStep(plan, completedIds, startedIds = new Set()) {
  return plan.find(step => !completedIds.has(step.id) && !startedIds.has(step.id) && dependenciesSatisfied(step, completedIds)) || null;
}

module.exports = Object.freeze({ normalizePlan, dependenciesSatisfied, nextReadyStep });
