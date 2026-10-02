'use strict';

const assert = require('node:assert/strict');
const { reviewRegressionSuite } = require('../scripts/ecc-regression-review');

const suite = {
  schema: 'aria.ecc-regression-suite.v1',
  version: '1',
  tests: [
    {
      id: 'tool-read',
      capability_id: 'a1',
      assertions: [
        { type: 'equals', path: 'status', expected: 'ok' },
        { type: 'contains', path: 'message', expected: 'ready' },
      ],
    },
    {
      id: 'tool-write',
      capability_id: 'a2',
      assertions: [
        { type: 'equals', path: 'approved', expected: false },
      ],
    },
  ],
};

const runA = {
  results: [
    { id: 'tool-read', output: { status: 'ok', message: 'ready now' } },
    { id: 'tool-write', output: { approved: false } },
  ],
};

const runB = {
  results: [
    { id: 'tool-read', output: { status: 'ok', message: 'ready now' } },
    { id: 'tool-write', output: { approved: false } },
  ],
};

const pass = reviewRegressionSuite(suite, runA, runB);
assert.equal(pass.schema, 'aria.ecc-independent-review.v1');
assert.equal(pass.summary.total_tests, 2);
assert.equal(pass.summary.passed, 2);
assert.equal(pass.summary.failed, 0);
assert.equal(pass.summary.disagreements, 0);
assert.equal(pass.summary.promotion_allowed, true);
assert.equal(pass.policy.auto_promote, false);
assert.equal(pass.review_digest_sha256.length, 64);

const disagreement = reviewRegressionSuite(suite, runA, {
  results: [
    { id: 'tool-read', output: { status: 'ok', message: 'ready now' } },
    { id: 'tool-write', output: { approved: true } },
  ],
});
assert.equal(disagreement.summary.disagreements, 1);
assert.equal(disagreement.summary.promotion_allowed, false);

const missing = reviewRegressionSuite(suite, runA, { results: [] });
assert.equal(missing.summary.disagreements, 2);
assert.equal(missing.summary.promotion_allowed, false);

const failure = reviewRegressionSuite(suite, runA, {
  results: [
    { id: 'tool-read', output: { status: 'error', message: 'not ready' } },
    { id: 'tool-write', output: { approved: false } },
  ],
});
assert.equal(failure.summary.failed, 1);
assert.equal(failure.summary.promotion_allowed, false);

console.log('ECC REGRESSION + INDEPENDENT REVIEW TEST: PASS');
