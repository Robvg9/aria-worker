'use strict';

const { runEvalSuite, compareSuites } = require('../../evaluation/engine');

function requireBranch(branch) {
  if (typeof branch !== 'string' || !branch.startsWith('aria/sandbox/')) {
    const error = new Error('sandbox_branch_required');
    error.code = 'sandbox_branch_required';
    throw error;
  }
  return branch;
}

async function evaluateSandbox({ branch, baseline = null, cases = [], context = {}, failFast = false } = {}) {
  requireBranch(branch);
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('evaluation_cases_required');

  const suite = await runEvalSuite({ cases, context, failFast });
  const comparison = baseline ? compareSuites(baseline, suite) : { regression_free: true, regressions: [] };
  const decision = suite.status === 'passed' && comparison.regression_free ? 'keep_candidate' : 'reject_candidate';

  return Object.freeze({
    status: decision === 'keep_candidate' ? 'passed' : 'failed',
    decision,
    branch,
    suite,
    comparison,
    gate: 'battlecruiser-regression-v1'
  });
}

module.exports = Object.freeze({ evaluateSandbox, requireBranch });
