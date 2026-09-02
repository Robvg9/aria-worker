'use strict';

const RISK_CLASSES = new Set(['READ', 'LOW_RISK_WRITE', 'HIGH_RISK_WRITE', 'DESTRUCTIVE']);
const SECRET_KEYS = /(?:api[_-]?key|secret|token|password|private[_-]?key|service[_-]?role|authorization|bearer)/i;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function blocked(reason) {
  return { status: 'no_plan', reason };
}

function containsSecretKey(value) {
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, entry]) => {
    if (SECRET_KEYS.test(key)) return true;
    if (isRecord(entry)) return containsSecretKey(entry);
    if (Array.isArray(entry)) return entry.some(containsSecretKey);
    return false;
  });
}

function normalize(routeResult) {
  if (!isRecord(routeResult) || routeResult.status !== 'route') return blocked('invalid_route_result');
  if (!nonEmptyString(routeResult.task_id)) return blocked('missing_task_id');
  if (!nonEmptyString(routeResult.request_id)) return blocked('missing_request_id');
  if (!Array.isArray(routeResult.plan) || routeResult.plan.length === 0) return blocked('empty_plan');
  if (containsSecretKey(routeResult)) return blocked('secret_like_field');

  const seen = new Set();
  const steps = [];

  for (let index = 0; index < routeResult.plan.length; index += 1) {
    const candidate = routeResult.plan[index];
    if (!isRecord(candidate)) return blocked(`invalid_step_${index}`);

    const { tool_id, operation, risk_class, selection_reason } = candidate;
    if (!nonEmptyString(tool_id)) return blocked(`missing_tool_id_${index}`);
    if (!nonEmptyString(operation)) return blocked(`missing_operation_${index}`);
    if (!RISK_CLASSES.has(risk_class)) return blocked(`invalid_risk_class_${index}`);
    if (!nonEmptyString(selection_reason)) return blocked(`missing_selection_reason_${index}`);

    const key = `${tool_id}|${operation}`;
    if (seen.has(key)) return blocked(`duplicate_operation_${index}`);
    seen.add(key);

    steps.push({
      step_id: `step-${index + 1}`,
      index,
      tool_id,
      operation,
      risk_class,
      selection_reason
    });
  }

  return {
    status: 'plan',
    task_id: routeResult.task_id,
    request_id: routeResult.request_id,
    steps,
    authorization_required: true
  };
}

module.exports = { normalize, containsSecretKey };
