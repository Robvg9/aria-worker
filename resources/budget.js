'use strict';

const METRIC_KEYS = Object.freeze(['tokens','milliseconds','usd','actions']);
function normalizeBudget(input = {}) {
  const out = {};
  for (const key of METRIC_KEYS) {
    const value = Number(input[key]);
    if (Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}
function createResourceBudget({ limits = {}, usage = {} } = {}) {
  let current = normalizeBudget(usage);
  const max = normalizeBudget(limits);
  function remaining() {
    const out = {};
    for (const key of METRIC_KEYS) if (max[key] !== undefined) out[key] = Math.max(0, max[key] - (current[key] || 0));
    return out;
  }
  function canConsume(cost = {}) {
    const c = normalizeBudget(cost);
    return METRIC_KEYS.every(key => max[key] === undefined || (current[key] || 0) + (c[key] || 0) <= max[key]);
  }
  function consume(cost = {}) {
    if (!canConsume(cost)) return { ok: false, reason: 'budget_exceeded', remaining: remaining() };
    const c = normalizeBudget(cost);
    for (const key of METRIC_KEYS) current[key] = (current[key] || 0) + (c[key] || 0);
    return { ok: true, usage: { ...current }, remaining: remaining() };
  }
  return Object.freeze({ limits: { ...max }, usage: () => ({ ...current }), remaining, canConsume, consume });
}
module.exports = { normalizeBudget, createResourceBudget };
