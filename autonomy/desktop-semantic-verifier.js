'use strict';

const VERSION = 'aria-desktop-semantic-verifier-v1';

function normalizeObservation(observation) {
  if (!observation || typeof observation !== 'object') return null;
  const nodes = Array.isArray(observation.nodes) ? observation.nodes : [];
  return Object.freeze({
    status: observation.status || null,
    focused_process: observation.focused_process || null,
    focused_title: observation.focused_title || null,
    nodes: Object.freeze(nodes.map(node => Object.freeze({
      role: node?.role || null,
      name: node?.name || null,
      value: node?.value || null,
      enabled: node?.enabled ?? null,
      visible: node?.visible ?? null,
      bounds: node?.bounds || null
    })))
  });
}

function nodeMatches(node, expected = {}) {
  if (!node) return false;
  return Object.entries(expected).every(([key, value]) => value == null || node[key] === value);
}

function verifyObservation(observation, expectation = {}) {
  const normalized = normalizeObservation(observation);
  if (!normalized) return Object.freeze({ ok: false, reason: 'observation_missing', confidence: 0 });
  const expectedProcess = expectation.focused_process || null;
  if (expectedProcess && normalized.focused_process !== expectedProcess) {
    return Object.freeze({ ok: false, reason: 'focused_process_mismatch', confidence: 0.2, evidence: normalized });
  }
  if (Array.isArray(expectation.required_nodes)) {
    for (const expected of expectation.required_nodes) {
      if (!normalized.nodes.some(node => nodeMatches(node, expected))) {
        return Object.freeze({ ok: false, reason: 'required_node_missing', confidence: 0.3, missing: expected, evidence: normalized });
      }
    }
  }
  if (Array.isArray(expectation.forbidden_nodes)) {
    for (const forbidden of expectation.forbidden_nodes) {
      if (normalized.nodes.some(node => nodeMatches(node, forbidden))) {
        return Object.freeze({ ok: false, reason: 'forbidden_node_present', confidence: 0.95, forbidden, evidence: normalized });
      }
    }
  }
  return Object.freeze({ ok: true, reason: 'semantic_expectation_satisfied', confidence: 0.95, evidence: normalized });
}

function inferExpectation(step) {
  const input = step?.input || {};
  if (step?.operation !== 'computer.use') return Object.freeze({});
  if (input.action === 'focus' && input.process) return Object.freeze({ focused_process: input.process });
  if (input.action === 'open' && input.target) return Object.freeze({ focused_title: input.target });
  return Object.freeze({});
}

function verifyDesktopResult({ step, result, observation = null } = {}) {
  const expectation = step?.verify && typeof step.verify === 'object' && Object.keys(step.verify).length
    ? step.verify
    : inferExpectation(step);
  if (result?.status && !['succeeded', 'completed'].includes(result.status)) {
    return Object.freeze({ ok: false, reason: 'action_not_succeeded', confidence: 1, result_status: result.status });
  }
  if (!observation || Object.keys(expectation).length === 0) {
    return Object.freeze({ ok: result?.status === 'succeeded' || result?.status === 'completed' || result?.status == null, reason: 'result_only', confidence: 0.6 });
  }
  return verifyObservation(observation, expectation);
}

module.exports = Object.freeze({ VERSION, normalizeObservation, verifyObservation, inferExpectation, verifyDesktopResult });
