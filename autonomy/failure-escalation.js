'use strict';

const DEFAULTS = Object.freeze({ repeat_threshold: 3, hard_limit: 5, require_new_evidence_after: 2 });
const OPTIONS = Object.freeze(['continue_with_same_path','change_path','park_optional_feature','escalate_to_another_ai','request_human_decision']);

function normalizeFailureContext(input = {}) {
  const failures = Number.isInteger(input.consecutive_failures) && input.consecutive_failures >= 0 ? input.consecutive_failures : 0;
  const evidence = Array.isArray(input.new_evidence) ? input.new_evidence : [];
  return Object.freeze({ consecutive_failures: failures, new_evidence_count: evidence.length, external_dependency: input.external_dependency === true, optional: input.optional === true, critical: input.critical === true });
}

function decideFailureEscalation(input = {}, policy = {}) {
  const p = { ...DEFAULTS, ...policy };
  const ctx = normalizeFailureContext(input);
  if (ctx.consecutive_failures < p.repeat_threshold) return Object.freeze({ mode:'continue', action:'continue_with_same_path', user_decision_required:false, reason:'below_escalation_threshold' });
  if (ctx.new_evidence_count === 0 && ctx.consecutive_failures >= p.repeat_threshold) {
    if (ctx.external_dependency && ctx.optional && !ctx.critical) return Object.freeze({ mode:'escalate', action:'request_human_decision', user_decision_required:true, reason:'repeated_external_optional_failure' });
    return Object.freeze({ mode:'escalate', action:'change_path', user_decision_required:false, reason:'repeated_failure_without_new_evidence' });
  }
  if (ctx.consecutive_failures >= p.hard_limit) return Object.freeze({ mode:'escalate', action:ctx.critical?'change_path':'request_human_decision', user_decision_required:!ctx.critical, reason:'hard_failure_limit_reached' });
  return Object.freeze({ mode:'escalate', action:'change_path', user_decision_required:false, reason:'threshold_reached_with_new_evidence' });
}

function buildFailureDecisionMessage(input = {}, decision = decideFailureEscalation(input)) {
  const ctx = normalizeFailureContext(input);
  return [
    'ARIA encontró fallos repetidos en la misma ruta.',
    `Fallos consecutivos: ${ctx.consecutive_failures}.`,
    ctx.external_dependency ? 'Dependencia externa: sí.' : 'Dependencia externa: no.',
    ctx.optional ? 'Capacidad opcional: sí.' : 'Capacidad opcional: no.',
    `Decisión recomendada: ${decision.action}.`,
    decision.action === 'request_human_decision' ? 'Robert puede decidir: continuar por otra ruta, escalar a otra IA/proveedor o dejar esta capacidad fuera por ahora.' : 'ARIA debe cambiar la estrategia antes de seguir repitiendo el mismo intento.',
    'All For One no forma parte de esta decisión: es un mecanismo de sondeo/auditoría independiente.'
  ].join(' ');
}

module.exports = Object.freeze({ DEFAULTS, OPTIONS, normalizeFailureContext, decideFailureEscalation, buildFailureDecisionMessage });