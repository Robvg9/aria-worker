'use strict';

const assert = require('node:assert/strict');
const { evaluateSandbox, requireBranch } = require('../autonomy/battlecruiser/regression-gate');

(async () => {
  assert.equal(requireBranch('aria/sandbox/bc5-proof'), 'aria/sandbox/bc5-proof');
  assert.throws(() => requireBranch('main'), /sandbox_branch_required/);

  const cases = [
    { id: 'required-behavior', run: async ctx => ctx.after, expect: value => value === 'ok' },
    { id: 'security-check', run: async ctx => ctx.safe, expect: value => value === true }
  ];

  const baseline = {
    status: 'passed',
    total: 2,
    passed: 2,
    failed: 0,
    results: [
      { id: 'required-behavior', status: 'passed' },
      { id: 'security-check', status: 'passed' }
    ]
  };

  const passed = await evaluateSandbox({
    branch: 'aria/sandbox/bc5-proof',
    baseline,
    cases,
    context: { after: 'ok', safe: true }
  });
  assert.equal(passed.status, 'passed');
  assert.equal(passed.decision, 'keep_candidate');
  assert.equal(passed.comparison.regression_free, true);

  const failed = await evaluateSandbox({
    branch: 'aria/sandbox/bc5-proof',
    baseline,
    cases,
    context: { after: 'broken', safe: false }
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.decision, 'reject_candidate');
  assert.equal(failed.suite.failed, 2);

  console.log('BATTLECRUISER REGRESSION GATE: PASS — sandbox-only evaluation, regression comparison, keep/reject decision');
})().catch(error => { console.error(error); process.exit(1); });
