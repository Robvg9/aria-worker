'use strict';

const { listExecutors } = require('./lookup');

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function operationsFor(executor) {
  return Array.isArray(executor.operations) ? executor.operations : [];
}

function supportsOperation(executor, operation) {
  const ops = operationsFor(executor);
  return ops.includes('*') || ops.includes(operation);
}

function descriptorFor(executor) {
  return {
    executor_id: executor.executor_id,
    type: executor.type,
    status: executor.status,
    operations: [...operationsFor(executor)]
  };
}

function resolveAgainstEntry(step, executor) {
  const target = step.target && typeof step.target === 'object' ? step.target : {};
  const requiredKey = executor.type === 'connector'
    ? 'connector_id'
    : executor.type === 'device'
      ? 'device_id'
      : 'agent_id';

  if (typeof target[requiredKey] !== 'string' || target[requiredKey].trim() === '') {
    fail('executor_target_missing', `${executor.type} target ${requiredKey} missing`);
  }

  const operation = step.operation;
  if (typeof operation !== 'string' || operation.trim() === '') {
    fail('operation_missing', 'step operation missing');
  }

  if (!supportsOperation(executor, operation)) {
    fail('operation_not_registered', `${executor.type} operation not registered: ${operation}`);
  }

  return Object.freeze({
    executor_id: executor.executor_id,
    type: executor.type,
    operation,
    target: Object.freeze({ ...target })
  });
}

/**
 * Select exactly one executor for a mission step.
 *
 * Precedence:
 * 1. explicit executor_type
 * 2. explicit target.type
 * 3. unique operation match across registered executors
 * 4. otherwise fail closed (ambiguous / unavailable / unsupported)
 *
 * This layer does not select providers, models, accounts or credentials.
 */
function selectExecutor(step, registry = { list: listExecutors }) {
  if (!step || typeof step !== 'object') {
    fail('step_required', 'step required');
  }

  const operation = typeof step.operation === 'string' ? step.operation : null;
  if (!operation) fail('operation_required', 'step operation required');

  const executors = typeof registry.list === 'function' ? registry.list() : listExecutors();
  if (!Array.isArray(executors) || executors.length === 0) {
    fail('executor_registry_empty', 'executor registry is empty');
  }

  const explicitType = step.executor_type || null;
  const targetType = step.target && typeof step.target.type === 'string' ? step.target.type : null;
  const requestedType = explicitType || targetType || null;

  if (explicitType && targetType && explicitType !== targetType) {
    fail('executor_type_conflict', 'executor_type conflicts with target.type', {
      executor_type: explicitType,
      target_type: targetType
    });
  }

  if (requestedType) {
    const candidates = executors.filter(e => e.type === requestedType);
    if (candidates.length === 0) {
      fail('unknown_executor_type', `unknown executor type: ${requestedType}`);
    }
    if (candidates.length > 1) {
      fail('ambiguous_executor_type', `multiple executors registered for type: ${requestedType}`);
    }

    const selected = candidates[0];
    if (selected.status !== 'registered' && selected.status !== 'ready') {
      fail('executor_unavailable', `executor unavailable: ${requestedType}`);
    }

    const resolved = resolveAgainstEntry(step, selected);
    return Object.freeze({
      ...resolved,
      selection_reason: explicitType ? 'explicit_executor_type' : 'explicit_target_type',
      selection_confidence: 'explicit',
      descriptor: descriptorFor(selected)
    });
  }

  const matches = executors.filter(e =>
    (e.status === 'registered' || e.status === 'ready') && supportsOperation(e, operation)
  );

  if (matches.length === 0) {
    fail('no_executor_for_operation', `no executor supports operation: ${operation}`);
  }

  if (matches.length > 1) {
    fail('ambiguous_executor_selection', `operation is supported by multiple executors: ${operation}`,
      { candidates: matches.map(descriptorFor) });
  }

  const selected = matches[0];
  const resolved = resolveAgainstEntry({
    ...step,
    executor_type: selected.type,
    target: { ...(step.target || {}), type: selected.type }
  }, selected);

  return Object.freeze({
    ...resolved,
    selection_reason: 'unique_operation_match',
    selection_confidence: 'deterministic',
    descriptor: descriptorFor(selected)
  });
}

module.exports = Object.freeze({ selectExecutor, supportsOperation, descriptorFor });
