'use strict';

const RISK_CLASSES = new Set(['READ', 'LOW_RISK_WRITE', 'HIGH_RISK_WRITE', 'DESTRUCTIVE']);
const AUTH_DECISIONS = new Set(['approved']);
const EXECUTION_STATUSES = new Set(['succeeded', 'failed', 'blocked']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function result(status, reason, extra = {}) {
  return { status, reason, ...extra };
}

function requiresVerification(riskClass) {
  return riskClass === 'HIGH_RISK_WRITE' || riskClass === 'DESTRUCTIVE';
}

function validateRequest(request) {
  if (!isRecord(request)) return result('blocked', 'invalid_request');
  if (!hasString(request.request_id)) return result('blocked', 'missing_request_id');
  if (!hasString(request.execution_id)) return result('blocked', 'missing_execution_id');
  if (!hasString(request.tool_id)) return result('blocked', 'missing_tool_id');
  if (!hasString(request.operation)) return result('blocked', 'missing_operation');
  if (!isRecord(request.input)) return result('blocked', 'invalid_input');
  if (!hasString(request.authorization_id)) return result('blocked', 'missing_authorization_id');
  if (!RISK_CLASSES.has(request.risk_class)) return result('blocked', 'invalid_risk_class');
  return result('valid', null);
}

function validateRegisteredTool(tool) {
  if (!isRecord(tool)) return result('blocked', 'missing_tool');
  if (!hasString(tool.tool_id)) return result('blocked', 'invalid_tool_id');
  if (!hasString(tool.status)) return result('blocked', 'missing_tool_status');
  if (tool.status !== 'available') return result('blocked', `tool_${tool.status}`);
  if (!Array.isArray(tool.operations) || tool.operations.length === 0) {
    return result('blocked', 'missing_tool_operations');
  }
  return result('valid', null);
}

function validateOperation(tool, operation) {
  const toolCheck = validateRegisteredTool(tool);
  if (toolCheck.status !== 'valid') return toolCheck;
  if (!hasString(operation)) return result('blocked', 'missing_operation');
  if (!tool.operations.includes(operation)) return result('blocked', 'unknown_operation');
  return result('valid', null);
}

function validateAuthorization(request, authorization) {
  if (!isRecord(authorization)) return result('blocked', 'missing_authorization');
  if (!hasString(authorization.authorization_id)) return result('blocked', 'missing_authorization_id');
  if (!AUTH_DECISIONS.has(authorization.decision)) {
    return result('blocked', 'authorization_not_approved');
  }
  if (authorization.authorization_id !== request.authorization_id) {
    return result('blocked', 'authorization_id_mismatch');
  }
  if (authorization.execution_id !== request.execution_id) {
    return result('blocked', 'execution_scope_mismatch');
  }
  if ((authorization.request_id ?? null) !== (request.request_id ?? null)) {
    return result('blocked', 'request_scope_mismatch');
  }
  if ((authorization.tool_id ?? null) !== (request.tool_id ?? null)) {
    return result('blocked', 'tool_scope_mismatch');
  }
  if ((authorization.operation ?? null) !== (request.operation ?? null)) {
    return result('blocked', 'operation_scope_mismatch');
  }
  if (authorization.risk_class !== request.risk_class) {
    return result('blocked', 'risk_scope_mismatch');
  }
  if (!hasString(authorization.policy_version)) {
    return result('blocked', 'missing_policy_version');
  }
  if (!hasString(authorization.reviewed_by) || !hasString(authorization.reviewed_at)) {
    return result('blocked', 'missing_approval_evidence');
  }
  return result('valid', null);
}

function validateHumanVerification(request, verification = null) {
  if (!requiresVerification(request.risk_class)) return result('not_required', null);
  if (!isRecord(verification)) return result('blocked', 'human_verification_required');
  if (verification.status !== 'verified') return result('blocked', 'human_verification_not_verified');
  if (!hasString(verification.verification_ref)) return result('blocked', 'missing_verification_ref');
  if (typeof verification.secret !== 'undefined' || typeof verification.password !== 'undefined') {
    return result('blocked', 'plaintext_secret_forbidden');
  }
  return result('valid', null);
}

function planDispatch(request, tool, authorization, verification = null) {
  const requestCheck = validateRequest(request);
  if (requestCheck.status !== 'valid') return requestCheck;

  const toolCheck = validateRegisteredTool(tool);
  if (toolCheck.status !== 'valid') return toolCheck;

  if (tool.tool_id !== request.tool_id) return result('blocked', 'tool_id_mismatch');

  const operationCheck = validateOperation(tool, request.operation);
  if (operationCheck.status !== 'valid') return operationCheck;

  const authCheck = validateAuthorization(request, authorization);
  if (authCheck.status !== 'valid') return authCheck;

  const verificationCheck = validateHumanVerification(request, verification);
  if (verificationCheck.status === 'blocked') return verificationCheck;

  return result('dispatchable', null, {
    request_id: request.request_id,
    execution_id: request.execution_id,
    tool_id: request.tool_id,
    operation: request.operation,
    risk_class: request.risk_class,
    verification_required: requiresVerification(request.risk_class),
  });
}

function normalizeResult(output) {
  if (!isRecord(output)) {
    return {
      status: 'failed',
      result: null,
      error_code: 'invalid_adapter_result',
      metadata: {}
    };
  }

  const status = EXECUTION_STATUSES.has(output.status) ? output.status : 'failed';
  return {
    status,
    result: isRecord(output.result) ? output.result : null,
    error_code: hasString(output.error_code) ? output.error_code : null,
    metadata: isRecord(output.metadata) ? output.metadata : {}
  };
}

function containsForbiddenSecretText(value) {
  if (typeof value !== 'string') return false;
  return /(Bearer\s+\S+|api[_-]?key\s*[=:]\s*\S+|password\s*[=:]\s*\S+|secret\s*[=:]\s*\S+)/i.test(value);
}

module.exports = {
  RISK_CLASSES: [...RISK_CLASSES],
  EXECUTION_STATUSES: [...EXECUTION_STATUSES],
  isRecord,
  requiresVerification,
  validateRequest,
  validateRegisteredTool,
  validateOperation,
  validateAuthorization,
  validateHumanVerification,
  planDispatch,
  normalizeResult,
  containsForbiddenSecretText,
};
