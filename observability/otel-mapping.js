'use strict';
const ALLOWED_STAGES = new Set(['ingress','planning','routing','execution','verification','recovery','result']);
function toOtelEvent(event = {}) {
  const stage = String(event.stage || 'execution');
  if (!ALLOWED_STAGES.has(stage)) throw new Error('stage_invalid');
  return { name: `aria.${stage}`, time_unix_nano: event.timestamp ? String(Date.parse(event.timestamp) * 1000000) : undefined, attributes: {
    'gen_ai.operation.name': stage,
    'gen_ai.system': event.provider_id || event.upstream_provider_id || undefined,
    'gen_ai.request.model': event.model_id || undefined,
    'aria.mission_id': event.mission_id || undefined,
    'aria.execution_id': event.execution_id || undefined,
    'aria.task_id': event.task_id || undefined,
    'aria.tool.capability_id': event.capability_id || undefined,
    'aria.router.decision_id': event.router_decision_id || undefined,
    'aria.fallback.decision_id': event.fallback_decision_id || undefined,
    'error.type': event.error_type || undefined,
  }, sensitive_content_included: false };
}
module.exports = { toOtelEvent };
