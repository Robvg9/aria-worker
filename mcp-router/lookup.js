'use strict';

const RISK_CLASSES = new Set(['READ', 'LOW_RISK_WRITE', 'HIGH_RISK_WRITE', 'DESTRUCTIVE', 'read', 'low_risk_write', 'high_risk_write', 'destructive']);
const RISK_MAP = { read: 'READ', low_risk_write: 'LOW_RISK_WRITE', high_risk_write: 'HIGH_RISK_WRITE', destructive: 'DESTRUCTIVE' };

function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function hasString(value) { return typeof value === 'string' && value.trim().length > 0; }
function blocked(reason) { return { status: 'no_route', reason }; }
function routed(task, plan) { return { status: 'route', task_id: task.task_id, request_id: task.request_id, plan }; }

function validateTask(task) {
  if (!isRecord(task)) return blocked('invalid_task');
  if (!hasString(task.task_id)) return blocked('missing_task_id');
  if (!hasString(task.request_id)) return blocked('missing_request_id');
  if (!hasString(task.intent)) return blocked('missing_intent');
  if (!hasString(task.operation) && !hasString(task.preferred_operation) && !hasString(task.preferred_tool_id) && !hasString(task.required_capability)) return blocked('insufficient_selection_intent');
  return null;
}

function validateRegistry(registry) {
  if (!isRecord(registry) || !Array.isArray(registry.tools)) return blocked('invalid_registry');
  return null;
}

function normalizeRisk(value) { return RISK_MAP[value] || value; }

function normalizeTools(registry) {
  return registry.tools.filter(isRecord).flatMap((tool) => {
    if (!hasString(tool.tool_id) || tool.status !== 'available' || !Array.isArray(tool.operations)) return [];
    return tool.operations.filter((operation) => hasString(operation)).map((operation) => ({
      tool_id: tool.tool_id,
      operation,
      risk_class: normalizeRisk(tool.risk_level),
      capabilities: Array.isArray(tool.capabilities) ? tool.capabilities : []
    }));
  });
}

function candidateAllowed(candidate, task) {
  if (!RISK_CLASSES.has(candidate.risk_class)) return false;
  if (hasString(task.operation) && candidate.operation !== task.operation) return false;
  if (hasString(task.preferred_operation) && candidate.operation !== task.preferred_operation) return false;
  if (hasString(task.preferred_tool_id) && candidate.tool_id !== task.preferred_tool_id) return false;
  if (hasString(task.required_capability) && !candidate.capabilities.includes(task.required_capability)) return false;
  return true;
}

function route(task, registry) {
  const taskError = validateTask(task);
  if (taskError) return taskError;
  const registryError = validateRegistry(registry);
  if (registryError) return registryError;

  const candidates = normalizeTools(registry)
    .filter((candidate) => candidateAllowed(candidate, task))
    .sort((a, b) => a.tool_id.localeCompare(b.tool_id) || a.operation.localeCompare(b.operation));

  if (candidates.length === 0) return blocked('no_route');
  if (candidates.length > 1 && !hasString(task.operation) && !hasString(task.preferred_operation) && !hasString(task.preferred_tool_id)) return blocked('ambiguous_selection');

  const preferred = hasString(task.preferred_tool_id) || hasString(task.preferred_operation);
  const plan = candidates.map((candidate) => ({
    tool_id: candidate.tool_id,
    operation: candidate.operation,
    risk_class: candidate.risk_class,
    selection_reason: preferred ? 'preferred_candidate' : 'deterministic_exact_match'
  }));
  return routed(task, plan);
}

function routePlan(task, registry) {
  if (!isRecord(task) || !Array.isArray(task.steps)) return route(task, registry);
  const base = { task_id: task.task_id, request_id: task.request_id, intent: task.intent };
  if (!hasString(base.task_id) || !hasString(base.request_id) || !hasString(base.intent)) return blocked('invalid_task');
  if (task.steps.length === 0) return blocked('empty_steps');

  const plan = [];
  for (const step of task.steps) {
    if (!isRecord(step)) return blocked('invalid_step');
    const result = route({ ...base, ...step }, registry);
    if (result.status !== 'route' || result.plan.length !== 1) return blocked(`step_${result.reason || 'no_route'}`);
    plan.push(result.plan[0]);
  }
  return routed(base, plan);
}

module.exports = { route, routePlan, validateTask, normalizeTools };
