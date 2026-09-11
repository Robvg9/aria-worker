'use strict';

const assert = require('node:assert/strict');
const { createBattleCruiserBridge } = require('../autonomy/battlecruiser/runtime-bridge');

(async () => {
  const calls = [];
  const workspace = {
    async createBranch(branch) { calls.push(['branch', branch]); },
    async read(path, branch) { calls.push(['read', path, branch]); return { path, branch, content: 'base' }; },
    async apply(change) { calls.push(['apply', change]); return { status: 'succeeded' }; },
    async openPullRequest(input) { calls.push(['pr', input]); return { number: 321, html_url: 'https://github.com/Robvg9/battlecruiser/pull/321' }; }
  };
  const executor = {
    async execute({ step }) {
      calls.push(['execute', step.operation, step.target.connector_id, step.input.path]);
      return { status: 'succeeded', executor_type: 'connector' };
    }
  };

  const baseline = {
    status: 'passed', total: 1, passed: 1, failed: 0,
    results: [{ id: 'behavior', status: 'passed' }]
  };
  const bridge = createBattleCruiserBridge({ workspace, executor });
  const result = await bridge.run({
    repository: 'Robvg9/battlecruiser',
    branch: 'aria/sandbox/bc6-runtime-proof',
    files: ['docs/proof.md'],
    changes: [{ path: 'docs/proof.md', content: 'proof' }],
    evaluationCases: [{ id: 'behavior', run: async () => true, expect: value => value === true }],
    baseline
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.promotion.decision, 'open_pull_request');
  assert.equal(result.promotion.status, 'approved');
  assert.equal(calls.some(call => call[0] === 'branch'), true);
  assert.equal(calls.some(call => call[0] === 'execute'), true);

  const pr = await bridge.promote({ evaluation: result.evaluation, branch: result.branch });
  assert.equal(pr.pr.number, 321);
  assert.equal(calls.some(call => call[0] === 'pr'), true);

  console.log('BATTLECRUISER RUNTIME BRIDGE: PASS — universal executor → sandbox → evaluation → governed promotion');
})().catch(error => { console.error(error); process.exit(1); });
