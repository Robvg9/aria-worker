'use strict';

const PROTOCOLS = new Set(['mcp', 'api']);
const RISKS = new Set(['READ', 'LOW_RISK_WRITE', 'HIGH_RISK_WRITE', 'DESTRUCTIVE']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function blocked(reason) {
  return { status: 'blocked', reason, result: null, error_code: reason };
}

function adapt(input) {
  if (!isRecord(input)) return blocked('invalid_request');
  const { adapter_id, protocol, request_id, execution_id, authorization_id, tool_id, operation, input: payload, risk_class } = input;
  if (typeof adapter_id !== 'string' || adapter_id.trim() === '') return blocked('missing_adapter_id');
  if (!PROTOCOLS.has(protocol)) return blocked('unsupported_protocol');
  if (typeof request_id !== 'string' || request_id.trim() === '') return blocked('missing_request_id');
  if (typeof execution_id !== 'string' || execution_id.trim() === '') return blocked('missing_execution_id');
  if (typeof authorization_id !== 'string' || authorization_id.trim() === '') return blocked('missing_authorization');
  if (typeof tool_id !== 'string' || tool_id.trim() === '') return blocked('missing_tool_id');
  if (typeof operation !== 'string' || operation.trim() === '') return blocked('missing_operation');
  if (!isRecord(payload)) return blocked('missing_input');
  if (!RISKS.has(risk_class)) return blocked('invalid_risk_class');

  return {
    adapter_id,
    request_id,
    execution_id,
    authorization_id,
    tool_id,
    operation,
    status: 'blocked',
    result: null,
    error_code: 'live_dispatch_disabled'
  };
}

module.exports = { adapt };
