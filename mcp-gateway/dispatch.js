'use strict';

const gateway = require('./lookup');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function containsForbiddenDeep(value) {
  if (typeof value === 'string') return gateway.containsForbiddenSecretText(value);
  if (Array.isArray(value)) return value.some(containsForbiddenDeep);
  if (isRecord(value)) return Object.values(value).some(containsForbiddenDeep);
  return false;
}

function blocked(reason, context = {}) {
  return {
    status: 'blocked',
    reason,
    result: null,
    error_code: reason,
    metadata: {
      gateway_version: 'aria-tool-mcp-gateway-v1.1.0',
      dispatch_attempted: false,
      ...context
    }
  };
}

/**
 * Controlled Gateway dispatch boundary.
 * The gateway owns validation and scope preservation; the injected adapter
 * owns protocol-specific execution. No network client is created here.
 */
async function dispatchAuthorized({ request, tool, authorization, verification = null, adapter }) {
  const plan = gateway.planDispatch(request, tool, authorization, verification);
  if (plan.status !== 'dispatchable') return plan;

  if (!adapter || typeof adapter.execute !== 'function') {
    return blocked('adapter_unavailable', { tool_id: request.tool_id, operation: request.operation });
  }

  const adapterInput = Object.freeze({
    request_id: request.request_id,
    task_id: request.task_id ?? null,
    execution_id: request.execution_id,
    authorization_id: request.authorization_id,
    tool_id: request.tool_id,
    operation: request.operation,
    input: request.input,
    risk_class: request.risk_class
  });

  let output;
  try {
    output = await adapter.execute(adapterInput);
  } catch {
    return blocked('adapter_error', { tool_id: request.tool_id, operation: request.operation });
  }

  if (containsForbiddenDeep(output)) {
    return blocked('sensitive_output_rejected', { tool_id: request.tool_id, operation: request.operation });
  }

  const normalized = gateway.normalizeResult(output);
  return {
    request_id: request.request_id,
    execution_id: request.execution_id,
    tool_id: request.tool_id,
    operation: request.operation,
    status: normalized.status,
    result: normalized.result,
    error_code: normalized.error_code,
    metadata: {
      gateway_version: 'aria-tool-mcp-gateway-v1.1.0',
      dispatch_attempted: true,
      verification_required: plan.verification_required,
      ...(normalized.metadata || {})
    }
  };
}

module.exports = { dispatchAuthorized, containsForbiddenDeep };
