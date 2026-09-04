'use strict';

const registry = require('./registry.json');

function fail(message, code) {
  const error = new TypeError(message);
  error.code = code;
  throw error;
}

function listExecutors() {
  return registry.executors.map((entry) => Object.freeze({ ...entry }));
}

function resolveExecutor(step) {
  if (!step || typeof step !== 'object') fail('step required', 'step_required');

  const type = step.executor_type || step.target?.type || step.target?.executor_type || null;
  if (!type) fail('executor type missing', 'executor_type_missing');

  const entry = registry.executors.find((item) => item.type === type);
  if (!entry) fail(`unknown executor type: ${type}`, 'unknown_executor_type');

  const target = step.target || {};
  const requiredKey = type === 'connector'
    ? 'connector_id'
    : type === 'device'
      ? 'device_id'
      : 'agent_id';

  if (typeof target[requiredKey] !== 'string' || target[requiredKey].trim() === '') {
    fail(`${type} target ${requiredKey} missing`, 'executor_target_missing');
  }

  const operation = step.operation;
  if (typeof operation !== 'string' || operation.trim() === '') {
    fail('step operation missing', 'operation_missing');
  }

  const allowed = entry.operations.includes('*') || entry.operations.includes(operation);
  if (!allowed) fail(`${type} operation not registered: ${operation}`, 'operation_not_registered');

  return Object.freeze({
    executor_id: entry.executor_id,
    type: entry.type,
    operation,
    target: Object.freeze({ ...target })
  });
}

module.exports = Object.freeze({ listExecutors, resolveExecutor });
