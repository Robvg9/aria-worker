'use strict';

const assert = require('node:assert/strict');
const { createBattleCruiserBridge } = require('../autonomy/battlecruiser/runtime-bridge');

(async () => {
  const calls = [];
  const applied = [];
  const workspace = {
    async createBranch(branch) { calls.push(['branch', branch]); },
    async read(path, branch) { calls.push(['read', path, branch]); return { path, branch, content: 'base' }; },
    async apply(change) { applied.push(change); calls.push(['apply', change]); return { status: 'succeeded', path: change.path, branch: change.branch }; },
    async openPullRequest(input) { calls.push(['pr', input]); return { number: 321, html_url: 'https://github.com/Robvg9/battlecruiser/pull/321' }; }
  };
  const executor = {
    async execute({ step }) {
      calls.push(['execute', step.operation, step.target.connector_id, step.input.path]);
      const write = await workspace.apply({ ...step.input, branch: step.input.branch || 'aria/sandbox/bc6-runtime-proof' });
      return { status: write.status, executor_type: 'connector', data: write };
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
    changes: [{ path: 'docs/proof.md', content: 'proof', branch: 'aria/sandbox/bc6-runtime-proof' }],
    evaluationCases: [{ id: 'behavior', run: async () => true, expect: value => value === true }],
    baseline,
    autoPromote: true
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.promotion.decision, 'open_pull_request');
  assert.equal(result.promotion.status, 'approved');
  assert.equal(result.pr.number, 321);
  assert.equal(calls.some(call => call[0] === 'branch'), true);
  assert.equal(calls.some(call => call[0] === 'execute'), true);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].path, 'docs/proof.md');
  assert.equal(applied[0].branch, 'aria/sandbox/bc6-runtime-proof');
  assert.equal(calls.some(call => call[0] === 'apply'), true);

  const pr = await bridge.promote({ evaluation: result.evaluation, branch: result.branch });
  assert.equal(pr.pr.number, 321);
  assert.equal(calls.some(call => call[0] === 'pr'), true);

  console.log('BATTLECRUISER RUNTIME BRIDGE: PASS — universal executor → sandbox write → evaluation → automatic PR promotion contract');
})().catch(error => { console.error(error); process.exit(1); });
