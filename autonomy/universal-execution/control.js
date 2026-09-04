'use strict';

const { evaluateAuthorization, requiresHumanGate } = require('../../governance/lookup');
const { createEvent, emitSafe } = require('../../observability/lookup');

function createExecutionControl({
  governancePolicy = { enabled: true, readRequiresHuman: false },
  onEvent = null,
  enforceGovernance = false,
  eventFactory = createEvent,
  eventEmitter = emitSafe
} = {}) {
  function preflight(request, authorization = null) {
    if (!enforceGovernance) return { status: 'allowed', governance_enforced: false };
    const risk = request?.risk_class || 'READ';
    if (requiresHumanGate(risk, governancePolicy) && !authorization) {
      return { status: 'blocked', reason: 'human_gate_required' };
    }
    const decision = evaluateAuthorization(request, authorization, governancePolicy);
    if (decision.approved_to_execute === true) return { ...decision, governance_enforced: true };
    return { ...decision, governance_enforced: true };
  }

  function observe(partial) {
    const event = eventFactory(partial);
    eventEmitter(onEvent, event);
    return event;
  }

  return Object.freeze({ preflight, observe, governancePolicy: Object.freeze({ ...governancePolicy }), enforceGovernance });
}

module.exports = Object.freeze({ createExecutionControl });
