'use strict';

const LEVELS = Object.freeze(['low', 'medium', 'high', 'critical']);

function createAutonomyPolicy(input = {}) {
  const maxRisk = input.max_risk || 'low';
  if (!LEVELS.includes(maxRisk)) throw new Error('invalid max_risk');
  const maxSteps = Number.isInteger(input.max_steps) && input.max_steps > 0 ? input.max_steps : 20;
  const maxRuntimeMs = Number.isInteger(input.max_runtime_ms) && input.max_runtime_ms > 0 ? input.max_runtime_ms : 30000;
  return Object.freeze({
    enabled: input.enabled === true,
    max_risk: maxRisk,
    max_steps: maxSteps,
    max_runtime_ms: maxRuntimeMs,
    require_human_approval: input.require_human_approval !== false,
    allow_background: input.allow_background === true
  });
}

function riskAllowed(risk, policy) {
  const r = LEVELS.indexOf(risk || 'critical');
  const max = LEVELS.indexOf(policy.max_risk);
  return r >= 0 && r <= max;
}

module.exports = { LEVELS, createAutonomyPolicy, riskAllowed };
