/**
 * Mission 10.14 — Universal Execution Integration
 * Composes Tool Registry, Observability, Lifecycle, Governance and Execution
 * into a single entry point. No live provider calls. No memory authority.
 */
const tools = require('../tools/lookup.js');
const obs = require('../observability/lookup.js');
const lifecycle = require('../lifecycle/lookup.js');
const gov = require('../governance/lookup.js');
const execution = require('../execution/lookup.js');

/**
 * planAndGuard(input) → { allowed, governance, reason }
 * Does not execute. Only evaluates governance + basic preconditions.
 */
function planAndGuard(input) {
  const req = input && typeof input === 'object' ? input : {};
  const govResult = gov.evaluateAuthorization({
    action_type: req.action_type || 'execute',
    authorization: req.authorization,
    impact: req.impact || { external_effect: true, cost_possible: true }
  });

  if (govResult.status !== gov.APPROVED) {
    return {
      allowed: false,
      governance: govResult,
      reason: govResult.reason,
      metadata: { memory_authority: 'none', live: false }
    };
  }

  return {
    allowed: true,
    governance: govResult,
    reason: 'authorized',
    metadata: { memory_authority: 'none', live: false }
  };
}

/**
 * executeGuarded(input, deps?) → Promise<ExecutionResult | blocked>
 * Requires approved authorization. Uses 10.8 execute under the hood.
 * Always mock-safe: does not force live transport.
 */
async function executeGuarded(input, deps) {
  const guard = planAndGuard(input);
  if (!guard.allowed) {
    return {
      status: 'blocked',
      reason: guard.reason,
      governance: guard.governance,
      metadata: { engine: 'universal-integration-v1', memory_authority: 'none' }
    };
  }
  return execution.execute(input, deps);
}

module.exports = {
  version: 'aria-universal-integration-v1.0.0',
  planAndGuard,
  executeGuarded,
  tools,
  obs,
  lifecycle,
  gov,
  execution
};
