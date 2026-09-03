'use strict';

const RISKS = { low: 0, medium: 1, high: 2, destructive: 3 };

function authorizeAgentAction({ agent, request, approved = false } = {}) {
  if (!agent || agent.status !== 'available') return { allowed: false, reason: 'agent_unavailable' };
  if (!request || !Object.prototype.hasOwnProperty.call(RISKS, request.risk)) return { allowed: false, reason: 'invalid_risk' };
  const maxRisk = Object.prototype.hasOwnProperty.call(RISKS, agent.max_risk) ? agent.max_risk : 'low';
  if (RISKS[request.risk] > RISKS[maxRisk]) return { allowed: false, reason: 'risk_exceeded' };
  if (RISKS[request.risk] >= RISKS.high && approved !== true) return { allowed: false, reason: 'approval_required' };
  return { allowed: true };
}

function auditAgentEvent(event = {}) {
  if (!event || typeof event !== 'object' || typeof event.task_id !== 'string' || !event.task_id || typeof event.type !== 'string') return { valid: false };
  const forbidden = /(secret|api[_-]?key|token|password|authorization)/i;
  const text = JSON.stringify(event);
  if (forbidden.test(text)) return { valid: false, reason: 'sensitive_output' };
  return { valid: true };
}

module.exports = { authorizeAgentAction, auditAgentEvent, RISKS };