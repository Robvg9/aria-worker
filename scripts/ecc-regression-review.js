'use strict';

const crypto = require('node:crypto');

function normalizeCase(testCase) {
  if (!testCase || typeof testCase.id !== 'string') throw new Error('Regression test id is required');
  if (!Array.isArray(testCase.assertions)) throw new Error(`Regression assertions missing: ${testCase.id}`);
  return {
    id: testCase.id,
    capability_id: testCase.capability_id || null,
    assertions: [...testCase.assertions].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

function evaluateAssertions(result, assertions) {
  return assertions.map(assertion => {
    if (assertion.type === 'equals') {
      return { ...assertion, passed: JSON.stringify(result?.[assertion.path]) === JSON.stringify(assertion.expected) };
    }
    if (assertion.type === 'contains') {
      const value = String(result?.[assertion.path] ?? '');
      return { ...assertion, passed: value.includes(String(assertion.expected)) };
    }
    if (assertion.type === 'exists') {
      const value = result?.[assertion.path];
      return { ...assertion, passed: value !== undefined && value !== null };
    }
    return { ...assertion, passed: false, unsupported: true };
  });
}

function reviewRegressionSuite(suite, runA, runB) {
  if (!suite || suite.schema !== 'aria.ecc-regression-suite.v1') {
    throw new Error('Unsupported regression suite schema');
  }
  if (!runA || !runB) throw new Error('Two independent regression runs are required');

  const cases = suite.tests.map(normalizeCase);
  const byId = run => new Map((run.results || []).map(r => [r.id, r]));

  const a = byId(runA);
  const b = byId(runB);
  const reviews = [];

  for (const test of cases) {
    const ra = a.get(test.id);
    const rb = b.get(test.id);
    if (!ra || !rb) {
      reviews.push({ id: test.id, state: 'MISSING_EVIDENCE', agreed: false });
      continue;
    }

    const evalA = evaluateAssertions(ra.output, test.assertions);
    const evalB = evaluateAssertions(rb.output, test.assertions);
    const passA = evalA.every(x => x.passed);
    const passB = evalB.every(x => x.passed);
    const sameOutput = JSON.stringify(ra.output) === JSON.stringify(rb.output);
    reviews.push({
      id: test.id,
      state: passA && passB ? 'PASS' : 'FAIL',
      agreed: passA === passB,
      independent_outputs_match: sameOutput,
      run_a_passed: passA,
      run_b_passed: passB,
      assertions_a: evalA,
      assertions_b: evalB,
    });
  }

  const disagreement = reviews.filter(r => !r.agreed || r.state === 'MISSING_EVIDENCE').length;
  const failures = reviews.filter(r => r.state === 'FAIL').length;

  const canonical = {
    schema: 'aria.ecc-independent-review.v1',
    deterministic: true,
    suite_version: suite.version || 'unknown',
    tests: reviews,
    policy: {
      independent_runs_required: true,
      disagreement_action: 'BLOCK_PROMOTION',
      failure_action: 'BLOCK_PROMOTION',
      scoring: 'NONE',
      auto_promote: false,
    },
    summary: {
      total_tests: reviews.length,
      passed: reviews.filter(r => r.state === 'PASS').length,
      failed: failures,
      disagreements: disagreement,
      promotion_allowed: failures === 0 && disagreement === 0 && reviews.length === cases.length,
    },
  };

  return {
    ...canonical,
    review_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
  };
}

module.exports = { normalizeCase, evaluateAssertions, reviewRegressionSuite };
