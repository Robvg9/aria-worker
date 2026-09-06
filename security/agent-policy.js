'use strict';

const RISK_ORDER = Object.freeze({ read: 0, low: 1, medium: 2, high: 3, destructive: 4 });
const SECRET_PATTERNS = [/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i, /\b(?:ghp_|github_pat_|sk-[A-Za-z0-9_-]{12,}|sb_secret_)[A-Za-z0-9_-]*/i, /Bearer\s+[A-Za-z0-9._-]{12,}/i];
const INJECTION_PATTERNS = [/ignore (?:all|any|previous) instructions/i, /reveal (?:the )?(?:system|developer) prompt/i, /disable (?:security|governance|approval)/i, /bypass (?:policy|permissions|governance)/i];

function riskAllowed(requested, maximum = 'low') {
  const r = String(requested || 'read').toLowerCase();
  const m = String(maximum || 'low').toLowerCase();
  return RISK_ORDER[r] !== undefined && RISK_ORDER[m] !== undefined && RISK_ORDER[r] <= RISK_ORDER[m];
}
function containsSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return SECRET_PATTERNS.some(re => re.test(text));
}
function containsInjection(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return INJECTION_PATTERNS.some(re => re.test(text));
}
function evaluateAction({ capability, allowedCapabilities = [], operation, risk = 'read', maxRisk = 'low', input } = {}) {
  if (!capability || !allowedCapabilities.includes(capability)) return { allowed: false, reason: 'capability_denied' };
  if (!operation) return { allowed: false, reason: 'operation_required' };
  if (!riskAllowed(risk, maxRisk)) return { allowed: false, reason: 'risk_exceeded' };
  if (containsSecret(input)) return { allowed: false, reason: 'secret_material_rejected' };
  if (containsInjection(input)) return { allowed: false, reason: 'prompt_injection_signal' };
  return { allowed: true, reason: 'policy_allowed' };
}
module.exports = { RISK_ORDER, riskAllowed, containsSecret, containsInjection, evaluateAction };
