'use strict';

const VERSION = 'aria-desktop-semantic-verifier-v1';

function normalizeObservation(observation) {
  if (!observation || typeof observation !== 'object') return null;
  const source = observation.ui && typeof observation.ui === 'object' ? observation.ui : observation;
  const nodes = Array.isArray(source.nodes) ? source.nodes : [];
  return Object.freeze({
    status: observation.status || source.status || null,
    focused_process: observation.focused_process || source.focused_process || null,
    focused_title: observation.focused_title || source.focused_title || source.title || null,
    focused_id: source.focused_id || null,
    nodes: Object.freeze(nodes.map(node => Object.freeze({
      role: node?.role || null,
      name: node?.name || null,
      value: node?.value || node?.text || null,
      enabled: node?.enabled ?? null,
      visible: node?.visible ?? null,
      bounds: node?.bounds || node?.attributes?.bounding_rectangle || null,
      attributes: node?.attributes || null
    })))
  });
}

function textMatches(actual, expected) {
  if (expected == null) return true;
  if (typeof actual !== 'string' || typeof expected !== 'string') return actual === expected;
  const a = actual.trim().toLowerCase();
  const e = expected.trim().toLowerCase();
  return a === e || a.includes(e);
}

function nodeMatches(node, expected = {}) {
  if (!node) return false;
  return Object.entries(expected).every(([key, value]) => {
    if (value == null) return true;
    if (key === 'name' || key === 'value' || key === 'role') return textMatches(node[key], value);
    return node[key] === value;
  });
}

function verifyObservation(observation, expectation = {}) {
  const normalized = normalizeObservation(observation);
  if (!normalized) return Object.freeze({ ok: false, reason: 'observation_missing', confidence: 0 });

  const expectedProcess = expectation.focused_process || null;
  if (expectedProcess) {
    const directMatch = textMatches(normalized.focused_process, expectedProcess);
    const windowMatch = normalized.nodes.some(node => node.role === 'window' && textMatches(node.name, expectedProcess));
    if (!directMatch && !windowMatch) {
      return Object.freeze({ ok: false, reason: 'focused_process_mismatch', confidence: 0.2, evidence: normalized });
    }
  }

  if (expectation.focused_title) {
    const directMatch = textMatches(normalized.focused_title, expectation.focused_title);
    const windowMatch = normalized.nodes.some(node => node.role === 'window' && textMatches(node.name, expectation.focused_title));
    if (!directMatch && !windowMatch) {
      return Object.freeze({ ok: false, reason: 'focused_title_mismatch', confidence: 0.25, evidence: normalized });
    }
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

module.exports = Object.freeze({ VERSION, normalizeObservation, textMatches, nodeMatches, verifyObservation, inferExpectation, verifyDesktopResult });
