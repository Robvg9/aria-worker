'use strict';

/**
 * ARIA Advanced Planner v1.
 * Pure planning primitives: no execution, provider calls, secrets, or mutations.
 */

const { createResourceBudget } = require('../resources/budget');

const RISK_WEIGHT = Object.freeze({ READ: 0, LOW: 10, MEDIUM: 25, HIGH: 50, CRITICAL: 100 });
const DEFAULTS = Object.freeze({ max_alternatives: 3, max_replans: 2, max_risk: 'CRITICAL' });

function normalizePolicy(policy = {}) {
  const maxAlternatives = Number.isInteger(policy.max_alternatives) && policy.max_alternatives > 0
    ? Math.min(policy.max_alternatives, 16)
    : DEFAULTS.max_alternatives;
  const maxReplans = Number.isInteger(policy.max_replans) && policy.max_replans >= 0
    ? Math.min(policy.max_replans, 16)
    : DEFAULTS.max_replans;
  const maxRisk = String(policy.max_risk || DEFAULTS.max_risk).toUpperCase();
  if (!(maxRisk in RISK_WEIGHT)) throw new TypeError(`invalid_max_risk:${maxRisk}`);
  return Object.freeze({ max_alternatives: maxAlternatives, max_replans: maxReplans, max_risk: maxRisk });
}

function normalizeStep(step, index) {
  if (!step || typeof step !== 'object') throw new TypeError(`invalid_step:${index}`);
  const id = String(step.id || `step_${index + 1}`);
  const action = String(step.action || step.operation || '').trim();
  if (!action) throw new TypeError(`step_action_required:${id}`);
  const risk = String(step.risk || step.policy?.risk || 'CRITICAL').toUpperCase();
  if (!(risk in RISK_WEIGHT)) throw new TypeError(`invalid_step_risk:${id}`);
  const depends = Array.isArray(step.depends_on) ? step.depends_on.map(String) : [];
  return Object.freeze({
    ...step,
    id,
    action,
    risk,
    depends_on: Object.freeze(depends),
  });
}

function normalizePlan(candidate) {
  if (!Array.isArray(candidate) || candidate.length === 0) throw new TypeError('plan_steps_required');
  const steps = candidate.map(normalizeStep);
  const ids = new Set();
  for (const step of steps) {
    if (ids.has(step.id)) throw new Error('duplicate_step_id');
    for (const dep of step.depends_on) if (!ids.has(dep)) throw new Error('forward_or_unknown_dependency');
    ids.add(step.id);
  }
  return Object.freeze(steps);
}

function estimatePlan(plan) {
  const risk = plan.reduce((max, step) => Math.max(max, RISK_WEIGHT[step.risk] ?? 100), 0);
  const actions = plan.length;
  const estimated = Object.freeze({
    actions,
    risk_score: risk,
    tokens: plan.reduce((sum, step) => sum + Number(step.estimated_cost?.tokens || step.cost?.tokens || 0), 0),
    milliseconds: plan.reduce((sum, step) => sum + Number(step.estimated_cost?.milliseconds || step.cost?.milliseconds || 0), 0),
    usd: plan.reduce((sum, step) => sum + Number(step.estimated_cost?.usd || step.cost?.usd || 0), 0),
  });
  return estimated;
}

function stableSignature(plan) {
  return plan.map((step) => `${step.id}:${step.action}:${step.risk}:${step.depends_on.join(',')}`).join('|');
}

function rankCandidates(candidates, policy = {}) {
  const p = normalizePolicy(policy);
  const normalized = [];
  const seen = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    try {
      const steps = normalizePlan(candidate.steps || candidate);
      const signature = stableSignature(steps);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const estimate = estimatePlan(steps);
      if (estimate.risk_score > RISK_WEIGHT[p.max_risk]) continue;
      const score = Number(candidate.score);
      normalized.push({
        id: String(candidate.id || `alternative_${normalized.length + 1}`),
        steps,
        estimate,
        source: String(candidate.source || 'strategy'),
        score: Number.isFinite(score) ? score : 0,
      });
    } catch {
      // Invalid alternatives are rejected closed; another candidate may still be usable.
    }
  }
  normalized.sort((a, b) =>
    (b.score - a.score) ||
    (a.estimate.risk_score - b.estimate.risk_score) ||
    (a.estimate.actions - b.estimate.actions) ||
    (a.estimate.usd - b.estimate.usd) ||
    a.id.localeCompare(b.id)
  );
  return normalized.slice(0, p.max_alternatives).map((candidate, index) => Object.freeze({
    ...candidate,
    rank: index + 1,
  }));
}

function planAdvanced({ goal, candidates, policy = {}, budget = {} } = {}) {
  const task = typeof goal === 'string' ? goal.trim() : '';
  if (!task) throw new TypeError('goal_required');
  const p = normalizePolicy(policy);
  const ranked = rankCandidates(candidates, p);
  if (!ranked.length) return Object.freeze({ status: 'no_plan', goal: task, alternatives: [], planner_version: 'aria-advanced-planner-v1.0.0' });

  const budgetGate = createResourceBudget(budget);
  const usable = ranked.filter((candidate) => budgetGate.canConsume(candidate.estimate));
  if (!usable.length) {
    return Object.freeze({
      status: 'budget_blocked',
      goal: task,
      alternatives: ranked,
      planner_version: 'aria-advanced-planner-v1.0.0',
    });
  }

  const selected = usable[0];
  return Object.freeze({
    status: 'planned',
    goal: task,
    selected: selected.id,
    selected_plan: selected.steps,
    alternatives: Object.freeze(usable.map((candidate) => candidate.id)),
    candidates: Object.freeze(usable),
    backtracking: Object.freeze({
      enabled: usable.length > 1,
      cursor: 0,
      exhausted: false,
    }),
    budgets: Object.freeze({ limits: budgetGate.limits, estimated: selected.estimate }),
    replanning: Object.freeze({ count: 0, max_replans: p.max_replans }),
    planner_version: 'aria-advanced-planner-v1.0.0',
  });
}

function advanceAlternative(state) {
  if (!state || !Array.isArray(state.candidates)) throw new TypeError('planner_state_required');
  const current = Number.isInteger(state.backtracking?.cursor) ? state.backtracking.cursor : 0;
  const next = current + 1;
  if (next >= state.candidates.length) {
    return Object.freeze({ ...state, backtracking: Object.freeze({ ...(state.backtracking || {}), cursor: next, exhausted: true }) });
  }
  const candidate = state.candidates[next];
  return Object.freeze({
    ...state,
    selected: candidate.id,
    selected_plan: candidate.steps,
    backtracking: Object.freeze({ ...(state.backtracking || {}), cursor: next, exhausted: false }),
  });
}

function replanFromFailure(state, failure = {}) {
  if (!state || typeof state !== 'object') throw new TypeError('planner_state_required');
  const count = Number(state.replanning?.count || 0);
  const max = Number(state.replanning?.max_replans || 0);
  if (count >= max) return Object.freeze({ ...state, replanning: Object.freeze({ ...(state.replanning || {}), count, exhausted: true }) });
  const advanced = advanceAlternative(state);
  return Object.freeze({
    ...advanced,
    replanning: Object.freeze({ ...(advanced.replanning || {}), count: count + 1, last_failure: String(failure.reason || failure.code || 'unknown') }),
  });
}

function createBacktrackingState(planResult) {
  if (!planResult || planResult.status !== 'planned') throw new TypeError('planned_result_required');
  return Object.freeze({
    ...planResult,
    backtracking: Object.freeze({ ...(planResult.backtracking || {}), stack: Object.freeze(planResult.candidates.map((c) => c.id)) }),
  });
}

module.exports = Object.freeze({
  DEFAULTS,
  RISK_WEIGHT,
  normalizePolicy,
  normalizeStep,
  normalizePlan,
  estimatePlan,
  rankCandidates,
  planAdvanced,
  advanceAlternative,
  replanFromFailure,
  createBacktrackingState,
});
