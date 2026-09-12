'use strict';

function createMeditationPolicy(input = {}) {
  const policy = {
    enabled: input.enabled !== false,
    heartbeat_ms: Number(input.heartbeat_ms ?? 30_000),
    min_idle_seconds: Number(input.min_idle_seconds ?? 45),
    max_consecutive_failures: Number(input.max_consecutive_failures ?? 3),
    autonomous_risk_ceiling: input.autonomous_risk_ceiling || 'medium',
    allow_destructive: input.allow_destructive === true,
    allow_production_merge: input.allow_production_merge === true,
    alternate_model_after_failures: Number(input.alternate_model_after_failures ?? 3)
  };
  if (!Number.isInteger(policy.heartbeat_ms) || policy.heartbeat_ms < 10_000) throw new TypeError('heartbeat_ms must be >= 10000');
  if (!Number.isInteger(policy.min_idle_seconds) || policy.min_idle_seconds < 0) throw new TypeError('min_idle_seconds must be >= 0');
  if (!Number.isInteger(policy.max_consecutive_failures) || policy.max_consecutive_failures < 1) throw new TypeError('max_consecutive_failures must be >= 1');
  if (![1, 2, 3, 4].includes(policy.alternate_model_after_failures)) throw new TypeError('alternate_model_after_failures must be 1..4');
  return Object.freeze(policy);
}

function autonomousActionAllowed(action = {}, policy) {
  if (!policy || policy.enabled !== true) return { allowed: false, reason: 'meditation_disabled' };
  const risk = String(action.risk || action.policy?.risk || 'critical').toLowerCase();
  if (['critical', 'destructive'].includes(risk) && !policy.allow_destructive) return { allowed: false, reason: 'destructive_action_requires_human_gate' };
  if (action.production_merge === true && !policy.allow_production_merge) return { allowed: false, reason: 'production_merge_requires_human_gate' };
  const order = { low: 1, medium: 2, high: 3, critical: 4, destructive: 4 };
  if ((order[risk] || 4) > (order[String(policy.autonomous_risk_ceiling).toLowerCase()] || 2)) return { allowed: false, reason: `risk_exceeds_ceiling:${risk}` };
  return { allowed: true, reason: 'allowed' };
}

module.exports = Object.freeze({ createMeditationPolicy, autonomousActionAllowed });
