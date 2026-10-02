'use strict';

const crypto = require('node:crypto');

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function canonicalCase(testCase) {
  if (!testCase || !testCase.id) throw new Error('Regression case id is required');
  if (!Array.isArray(testCase.expected_tools)) throw new Error('Regression case expected_tools is required');

  return {
    id: String(testCase.id),
    input_hash: digest(testCase.input ?? null),
    expected_tools: [...testCase.expected_tools].map(String),
    expected_output_hash: testCase.expected_output_hash || null,
    risk_class: testCase.risk_class || 'READ',
  };
}

function buildRegressionSuite(cases = [], provenance = {}) {
  const normalized = cases.map(canonicalCase).sort((a, b) => a.id.localeCompare(b.id));
  const canonical = {
    schema: 'aria.ecc-ai-regression-suite.v1',
    deterministic: true,
    source: provenance,
    cases: normalized,
    policy: {
      promotion_requires_independent_review: true,
      ai_judge_optional: true,
      exact_tool_sequence_required: true,
      output_hash_comparison_supported: true,
      auto_promotion: false,
    },
  };

  return {
    ...canonical,
    suite_digest_sha256: digest(canonical),
  };
}

function evaluateSnapshot(suite, snapshot = {}) {
  if (!suite || suite.schema !== 'aria.ecc-ai-regression-suite.v1') {
    throw new Error('Unsupported regression suite schema');
  }

  const actual = new Map((snapshot.cases || []).map(c => [c.id, c]));
  const results = [];

  for (const expected of suite.cases) {
    const got = actual.get(expected.id);
    const toolSequencePass = Boolean(
      got &&
      JSON.stringify(got.actual_tools || []) === JSON.stringify(expected.expected_tools),
    );
    const outputPass = expected.expected_output_hash
      ? Boolean(got && got.actual_output_hash === expected.expected_output_hash)
      : true;

    results.push({
      id: expected.id,
      tool_sequence_pass: toolSequencePass,
      output_hash_pass: outputPass,
      passed: toolSequencePass && outputPass,
    });
  }

  const passed = results.length > 0 && results.every(r => r.passed);

  return {
    schema: 'aria.ecc-ai-regression-result.v1',
    deterministic: true,
    suite_digest_sha256: suite.suite_digest_sha256,
    passed,
    results,
    promotion_state: passed ? 'REVIEW_REQUIRED' : 'BLOCKED',
  };
}

function recordIndependentReview(result, review = {}) {
  if (!result || result.schema !== 'aria.ecc-ai-regression-result.v1') {
    throw new Error('Unsupported regression result schema');
  }
  if (!review || !review.reviewer_id) throw new Error('Independent reviewer id is required');

  const approved = review.decision === 'approve';
  return {
    schema: 'aria.ecc-ai-independent-review.v1',
    deterministic: true,
    suite_digest_sha256: result.suite_digest_sha256,
    regression_passed: result.passed,
    reviewer_id: String(review.reviewer_id),
    decision: approved ? 'APPROVED' : 'REJECTED',
    evidence_refs: [...new Set(review.evidence_refs || [])].sort(),
    promotion_allowed: Boolean(result.passed && approved),
  };
}

module.exports = { digest, canonicalCase, buildRegressionSuite, evaluateSnapshot, recordIndependentReview };
