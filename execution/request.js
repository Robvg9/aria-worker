'use strict';

const { canonicalJson, executionId } = require('./lookup.js');

const VERSION = '1';
const RISK_CLASSES = Object.freeze(['READ', 'LOW_RISK_WRITE', 'HIGH_RISK_WRITE', 'DESTRUCTIVE']);
const ROUTE_STATUSES = Object.freeze(['selected', 'primary', 'fallback']);

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a non-empty string`);
}
function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
}
function normalizeExecutionRequest(input) {
  plainObject(input, 'request');
  nonEmptyString(input.execution_version, 'execution_version');
  if (input.execution_version !== VERSION) throw new TypeError(`unsupported execution_version: ${input.execution_version}`);
  nonEmptyString(input.request_id, 'request_id');
  nonEmptyString(input.capability, 'capability');
  plainObject(input.input, 'input');
  plainObject(input.authorization, 'authorization');
  const validAuth = ['approved', 'pending', 'rejected', 'blocked'];
  if (!validAuth.includes(input.authorization.status)) throw new TypeError(`invalid authorization status: ${input.authorization.status}`);
  const route = input.selected_route ?? null;
  if (route !== null) {
    plainObject(route, 'selected_route');
    if (!ROUTE_STATUSES.includes(route.status)) throw new TypeError(`invalid selected_route.status: ${route.status}`);
    for (const field of ['provider_id', 'account_id', 'model_id', 'capability']) nonEmptyString(route[field], `selected_route.${field}`);
    if (route.capability !== input.capability) throw new TypeError('selected_route.capability must match capability');
  }
  const riskClass = input.authorization.risk_class ?? 'READ';
  if (!RISK_CLASSES.includes(riskClass)) throw new TypeError(`invalid authorization.risk_class: ${riskClass}`);
  const normalized = {
    execution_version: VERSION,
    request_id: input.request_id,
    task_id: input.task_id ?? null,
    capability: input.capability,
    selected_route: route,
    authorization: { status: input.authorization.status, risk_class: riskClass, evidence_ref: input.authorization.evidence_ref ?? null },
    input: input.input,
    policy: input.policy && typeof input.policy === 'object' && !Array.isArray(input.policy) ? input.policy : {},
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {}
  };
  normalized.execution_id = input.execution_id ?? executionId({ request_id: normalized.request_id, task_id: normalized.task_id, capability: normalized.capability, selected_route: normalized.selected_route, input: normalized.input });
  nonEmptyString(normalized.execution_id, 'execution_id');
  return normalized;
}
function requestFingerprint(request) {
  const normalized = normalizeExecutionRequest(request);
  return canonicalJson({ execution_version: normalized.execution_version, request_id: normalized.request_id, task_id: normalized.task_id, capability: normalized.capability, selected_route: normalized.selected_route, input: normalized.input });
}
module.exports = Object.freeze({ VERSION, RISK_CLASSES, ROUTE_STATUSES, normalizeExecutionRequest, requestFingerprint });
