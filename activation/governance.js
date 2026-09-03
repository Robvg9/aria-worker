'use strict';

const { evaluateAuthorization } = require('../governance/lookup');

const DECISION_MAP = Object.freeze({
  pending: 'pending_approval',
  approved: 'approved',
  rejected: 'rejected',
  expired: 'expired',
  revoked: 'rejected'
});

function hasString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function toGovernanceAuthorization(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    ...record,
    decision: DECISION_MAP[record.status] || 'invalid',
    reviewed_by: record.approved_by ?? null,
    reviewed_at: record.approved_at ?? null,
    evidence_ref: record.verification_ref ?? null
  };
}

function createGovernanceAuthorizer({ approvalStore, policy = null, now = () => new Date() } = {}) {
  if (!approvalStore || typeof approvalStore.get !== 'function' || typeof approvalStore.canExecute !== 'function') {
    throw new TypeError('governance authorizer requires approvalStore.get and approvalStore.canExecute');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  return async function authorize({ connector_id, operation, risk_class, input = {} } = {}) {
    if (!hasString(connector_id) || !hasString(operation) || !hasString(risk_class)) {
      return { status: 'blocked', reason: 'governance_request_invalid' };
    }

    const authorizationId = input.authorization_id;
    if (!hasString(authorizationId)) return { status: 'blocked', reason: 'authorization_id_missing' };

    const request = {
      execution_id: input.execution_id,
      request_id: input.request_id,
      tool_id: input.tool_id,
      operation,
      risk_class,
    };
    const binding = {
      request_id: input.request_id,
      execution_id: input.execution_id,
      tool_id: input.tool_id,
      operation,
      risk_class,
      policy_version: input.policy_version,
      target: input.target
    };

    if (!hasString(request.execution_id) || !hasString(request.request_id) || !hasString(request.tool_id)) {
      return { status: 'blocked', reason: 'governance_binding_incomplete' };
    }
    if (!hasString(binding.policy_version) || !binding.target || typeof binding.target !== 'object' || Array.isArray(binding.target)) {
      return { status: 'blocked', reason: 'governance_binding_incomplete' };
    }

    const stored = await approvalStore.get(authorizationId);
    const authorization = toGovernanceAuthorization(stored);
    const evaluated = evaluateAuthorization(request, authorization, policy);
    if (evaluated.status !== 'approved') return evaluated;

    const executable = await approvalStore.canExecute(authorizationId, binding, now());
    if (executable !== true) return { status: 'blocked', reason: 'approval_not_executable', authorization_id: authorizationId };

    return evaluated;
  };
}

module.exports = { createGovernanceAuthorizer, toGovernanceAuthorization };
