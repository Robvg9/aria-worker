'use strict';

const crypto = require('crypto');

function stable(value) { return JSON.stringify(value, Object.keys(value || {}).sort()); }

function buildRegression({ capability, procedure, evidence = {}, assertions = [] } = {}) {
  const capabilityId = typeof capability === 'string' ? capability.trim() : String(capability?.id || '').trim();
  if (!capabilityId) throw new TypeError('capability_required');
  if (!procedure || typeof procedure !== 'object') throw new TypeError('procedure_required');
  const sourceAssertions = Array.isArray(assertions) && assertions.length ? assertions : [
    { code: 'capability_status', type: 'equals', path: 'capability.status', expected: 'verified' },
    { code: 'procedure_present', type: 'array_nonempty', path: 'procedure.steps' }
  ];
  const seed = stable({ capability: capabilityId, procedure, evidence, assertions: sourceAssertions });
  const testId = `reg_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20)}`;
  return Object.freeze({
    status: 'generated',
    test_id: testId,
    capability_id: capabilityId,
    source_evidence: evidence,
    assertions: Object.freeze(sourceAssertions.map(assertion => Object.freeze({ ...assertion }))),
    procedure_snapshot: structuredClone(procedure),
    generated_at: new Date().toISOString(),
    builder_version: 'regression-builder-v2.0.0'
  });
}

function evaluateRegression(regression, context = {}) {
  if (!regression || !Array.isArray(regression.assertions)) throw new TypeError('regression_required');
  const results = regression.assertions.map(assertion => {
    const actual = String(assertion.path || '').split('.').reduce((acc, key) => acc == null ? undefined : acc[key], context);
    let passed = false;
    if (assertion.type === 'equals') passed = actual === assertion.expected;
    else if (assertion.type === 'array_nonempty') passed = Array.isArray(actual) && actual.length > 0;
    else if (assertion.type === 'exists') passed = actual !== undefined && actual !== null;
    return { code: assertion.code, passed, actual: passed ? actual : undefined };
  });
  return Object.freeze({ status: results.every(result => result.passed) ? 'passed' : 'failed', test_id: regression.test_id, results });
}

module.exports = Object.freeze({ buildRegression, evaluateRegression });
