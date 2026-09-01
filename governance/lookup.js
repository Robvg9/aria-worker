/**
 * ARIA Governance / Human-Gate (Mission 10.12)
 * Pure evaluation. selected ≠ approved_to_execute.
 */
const registry = require('./registry.json');

const APPROVED = 'approved';
const PENDING = 'pending_gate';
const DENIED = 'denied';
const BLOCKED = 'blocked';

function isApproved(auth) {
  if (!auth || typeof auth !== 'object') return false;
  return auth.status === APPROVED;
}

function requiresHumanGate(actionType, impact) {
  const action = (actionType || '').toLowerCase();
  const imp = impact && typeof impact === 'object' ? impact : {};
  if (action === 'memory_write' || action === 'memory_commit' || action === 'bridge_activation') return true;
  if (action === 'credential_change' || action === 'credential_mutation') return true;
  if (action === 'secret_read' || action === 'secret_output') return true;
  if (imp.memory_mutation === true) return true;
  if (imp.system_mutation === true) return true;
  if (imp.external_effect === true && action === 'execute') return true;
  return false;
}

/**
 * evaluateAuthorization(request) → { status, reason, authorization, decision }
 */
function evaluateAuthorization(request) {
  const req = request && typeof request === 'object' ? request : {};
  const auth = req.authorization && typeof req.authorization === 'object' ? req.authorization : null;
  const action = req.action_type || 'unknown';
  const impact = req.impact || {};

  if (!auth) {
    return {
      status: BLOCKED,
      reason: 'authorization_missing',
      authorization: { status: 'invalid', authority: 'none', evidence_ref: null },
      decision: { status: BLOCKED, reason: 'authorization_missing' },
      metadata: { deterministic: true, no_secret_access: true }
    };
  }

  if (auth.status === 'expired' || auth.status === 'invalid' || auth.status === 'denied') {
    return {
      status: BLOCKED,
      reason: 'authorization_' + auth.status,
      authorization: auth,
      decision: { status: BLOCKED, reason: 'authorization_' + auth.status },
      metadata: { deterministic: true, no_secret_access: true }
    };
  }

  if (requiresHumanGate(action, impact) && auth.authority !== 'human' && auth.status !== APPROVED) {
    return {
      status: PENDING,
      reason: 'require_human_gate',
      authorization: Object.assign({}, auth, { status: PENDING }),
      decision: { status: PENDING, reason: 'require_human_gate' },
      metadata: { deterministic: true, no_secret_access: true }
    };
  }

  if (auth.status === APPROVED) {
    return {
      status: APPROVED,
      reason: 'authorized',
      authorization: auth,
      decision: { status: APPROVED, reason: 'authorized' },
      metadata: { deterministic: true, no_secret_access: true }
    };
  }

  if (auth.status === PENDING) {
    return {
      status: PENDING,
      reason: 'pending_gate',
      authorization: auth,
      decision: { status: PENDING, reason: 'pending_gate' },
      metadata: { deterministic: true, no_secret_access: true }
    };
  }

  return {
    status: BLOCKED,
    reason: 'authorization_not_approved',
    authorization: auth,
    decision: { status: BLOCKED, reason: 'authorization_not_approved' },
    metadata: { deterministic: true, no_secret_access: true }
  };
}

module.exports = {
  version: registry.version,
  evaluateAuthorization,
  isApproved,
  requiresHumanGate,
  APPROVED,
  PENDING,
  DENIED,
  BLOCKED,
  registry
};
