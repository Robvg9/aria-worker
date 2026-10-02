'use strict';

const assert = require('node:assert/strict');
const {
  buildRegressionSuite,
  evaluateSnapshot,
  recordIndependentReview,
} = require('../scripts/ecc-ai-regression');

const suite = buildRegressionSuite([
  {
    id: 'case-b',
    input: { prompt: 'B' },
    expected_tools: ['tool.search', 'tool.answer'],
    expected_output_hash: 'out-b',
  },
  {
    id: 'case-a',
    input: { prompt: 'A' },
    expected_tools: ['tool.read'],
  },
], {
  repository: 'ecc',
  tag: 'v2.2.3',
  commit_sha: 'commit',
});

assert.equal(suite.schema, 'aria.ecc-ai-regression-suite.v1');
assert.equal(suite.deterministic, true);
assert.equal(suite.cases[0].id, 'case-a');
assert.equal(suite.suite_digest_sha256.length, 64);
assert.equal(suite.policy.auto_promotion, false);

const passed = evaluateSnapshot(suite, {
  cases: [
    { id: 'case-a', actual_tools: ['tool.read'] },
    { id: 'case-b', actual_tools: ['tool.search', 'tool.answer'], actual_output_hash: 'out-b' },
  ],
});
assert.equal(passed.passed, true);
assert.equal(passed.promotion_state, 'REVIEW_REQUIRED');
assert.ok(passed.results.every(x => x.passed));

const failed = evaluateSnapshot(suite, {
  cases: [
    { id: 'case-a', actual_tools: ['tool.read'] },
    { id: 'case-b', actual_tools: ['tool.search'] },
  ],
});
assert.equal(failed.passed, false);
assert.equal(failed.promotion_state, 'BLOCKED');

const review = recordIndependentReview(passed, {
  reviewer_id: 'reviewer-1',
  decision: 'approve',
  evidence_refs: ['ev-2', 'ev-1'],
});
assert.equal(review.decision, 'APPROVED');
assert.equal(review.promotion_allowed, true);
assert.deepEqual(review.evidence_refs, ['ev-1', 'ev-2']);

assert.throws(
  () => recordIndependentReview(passed, { decision: 'approve' }),
  /reviewer id is required/,
);

console.log('ECC AI REGRESSION TEST: PASS');
