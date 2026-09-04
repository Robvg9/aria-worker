'use strict';

const SECRET_KEY_PATTERN = /^(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|secret|password|credential)(_|$)/i;
const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bor-v1-[A-Za-z0-9_-]{16,}\b/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/
];

function targetIdentifier(step = {}) {
  const target = step.target || {};
  const type = step.executor_type || target.type;
  if (type === 'connector') return target.connector_id || step.connector_id || null;
  if (type === 'device') return target.device_id || step.device_id || null;
  if (type === 'agent') return target.agent_id || step.agent_id || null;
  return null;
}

function containsSensitive(value, seen = new Set()) {
  if (typeof value === 'string') return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => containsSensitive(item, seen));
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) return true;
    if (containsSensitive(child, seen)) return true;
  }
  return false;
}

function sanitizeResult(result) {
  if (containsSensitive(result)) return { status: 'blocked', reason: 'sensitive_output_rejected' };
  return result;
}

function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('adapter required');
  if (typeof adapter.adapter_id !== 'string' || !adapter.adapter_id) throw new Error('adapter_id_missing');
  if (typeof adapter.executor_type !== 'string' || !adapter.executor_type) throw new Error('executor_type_missing');
  if (typeof adapter.execute !== 'function') throw new TypeError('adapter.execute function required');
  if (adapter.status !== 'ready') throw new Error(`adapter_not_ready:${adapter.executor_type}`);
  if (adapter.operations != null && !Array.isArray(adapter.operations)) throw new Error('invalid_adapter_operations');
  return true;
}

function operationAllowed(adapter, operation) {
  if (!operation) return false;
  const operations = Array.isArray(adapter.operations) ? adapter.operations : ['*'];
  return operations.includes('*') || operations.includes(operation);
}

function scopeMatches(step = {}, adapter = {}) {
  const explicitType = step.executor_type || null;
  const targetType = step.target?.type || null;
  if (explicitType && explicitType !== adapter.executor_type) return false;
  if (targetType && targetType !== adapter.executor_type) return false;
  return true;
}

function createDispatchBoundary({ adapters } = {}) {
  if (!adapters || typeof adapters.get !== 'function') throw new TypeError('adapter registry required');

  async function dispatch({ missionId, mission, step, attempt = 1, policy, request = {}, selection } = {}) {
    if (!step || typeof step !== 'object') throw new TypeError('step required');

    const executorType = step.executor_type || step.target?.type;
    if (!executorType) return { status: 'blocked', reason: 'executor_type_missing' };

    const adapter = adapters.get(executorType);
    if (!adapter) return { status: 'blocked', reason: 'executor_adapter_unavailable', executor_type: executorType };

    try {
      validateAdapter(adapter);
    } catch (error) {
      return { status: 'blocked', executor_type: executorType, reason: error.message };
    }

    if (!scopeMatches(step, adapter)) return { status: 'blocked', executor_type: executorType, reason: 'scope_mismatch' };
    if (!operationAllowed(adapter, step.operation)) return { status: 'blocked', executor_type: executorType, reason: 'operation_not_supported' };

    const targetId = targetIdentifier(step);
    if (!targetId) return { status: 'blocked', executor_type: executorType, reason: `${executorType}_target_missing` };

    try {
      const result = await adapter.execute({
        missionId,
        mission,
        step,
        attempt,
        policy,
        request,
        selection,
        transport: request.transport
      });
      return sanitizeResult({
        ...result,
        adapter_id: adapter.adapter_id,
        executor_type: adapter.executor_type
      });
    } catch (_error) {
      return {
        status: 'failed',
        executor_type: executorType,
        adapter_id: adapter.adapter_id,
        error: { code: 'adapter_error', message: 'adapter dispatch failed' }
      };
    }
  }

  return Object.freeze({ dispatch });
}

module.exports = Object.freeze({
  createDispatchBoundary,
  containsSensitive,
  sanitizeResult,
  validateAdapter,
  operationAllowed,
  scopeMatches
});
