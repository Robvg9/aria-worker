'use strict';

const RISK_CLASSES = new Set(['READ', 'LOW_RISK_WRITE', 'HIGH_RISK_WRITE', 'DESTRUCTIVE']);
const STATES = new Set(['pending_approval', 'approved', 'rejected', 'expired', 'invalid']);

function hasString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requiresHumanGate(riskClass, policy) {
  if (!RISK_CLASSES.has(riskClass)) return true;
  if (!policy || policy.enabled !== true) return true;
  if (riskClass === 'READ') return policy.readRequiresHuman === true;
  return true;
}

function scopeMatches(request, authorization) {
  if (!request || !authorization) return false;
  if (request.execution_id && authorization.execution_id !== request.execution_id) return false;
  if (request.request_id && authorization.request_id !== request.request_id) return false;
  if (request.task_id && authorization.task_id !== request.task_id) return false;
  if (request.risk_class && authorization.risk_class !== request.risk_class) return false;
  if (request.operation && authorization.operation && authorization.operation !== request.operation) return false;
  if (request.tool_id && authorization.tool_id && authorization.tool_id !== request.tool_id) return false;
  return true;
}

function validateAuthorizationRecord(authorization) {
  if (!authorization || typeof authorization !== 'object') return { valid: false, reason: 'missing_authorization' };
  if (!hasString(authorization.authorization_id)) return { valid: false, reason: 'missing_authorization_id' };
  if (!hasString(authorization.execution_id)) return { valid: false, reason: 'missing_execution_id' };
  if (!RISK_CLASSES.has(authorization.risk_class)) return { valid: false, reason: 'invalid_risk_class' };
  if (!STATES.has(authorization.decision)) return { valid: false, reason: 'invalid_decision' };
  if (!hasString(authorization.policy_version)) return { valid: false, reason: 'missing_policy_version' };
  if (authorization.decision === 'approved') {
    if (!hasString(authorization.reviewed_by) || !hasString(authorization.reviewed_at) || !hasString(authorization.evidence_ref)) {
      return { valid: false, reason: 'approved_missing_evidence' };
    }
  }
  return { valid: true };
}

function evaluateAuthorization(request, authorization = null, policy = null) {
  if (!request || typeof request !== 'object') return { status: 'blocked', reason: 'invalid_request' };
  if (!RISK_CLASSES.has(request.risk_class)) return { status: 'blocked', reason: 'invalid_risk_class' };

  const record = validateAuthorizationRecord(authorization);
  if (!record.valid) return { status: 'blocked', reason: record.reason };
  if (!scopeMatches(request, authorization)) return { status: 'blocked', reason: 'authorization_scope_mismatch' };

  if (authorization.decision === 'approved') {
    if (requiresHumanGate(request.risk_class, policy)) {
      return { status: 'approved', approved_to_execute: true, authorization_id: authorization.authorization_id };
    }
    return { status: 'approved', approved_to_execute: true, authorization_id: authorization.authorization_id };
  }

  if (authorization.decision === 'pending_approval') return { status: 'pending_approval', approved_to_execute: false, reason: 'human_gate_required', authorization_id: authorization.authorization_id };
  if (authorization.decision === 'rejected') return { status: 'blocked', approved_to_execute: false, reason: 'rejected', authorization_id: authorization.authorization_id };
  if (authorization.decision === 'expired') return { status: 'blocked', approved_to_execute: false, reason: 'expired', authorization_id: authorization.authorization_id };
  return { status: 'blocked', approved_to_execute: false, reason: 'invalid', authorization_id: authorization.authorization_id };
}

module.exports = {
  RISK_CLASSES: [...RISK_CLASSES],
  STATES: [...STATES],
  requiresHumanGate,
  scopeMatches,
  validateAuthorizationRecord,
  evaluateAuthorization,
};
