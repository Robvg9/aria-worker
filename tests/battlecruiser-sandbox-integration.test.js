'use strict';
const assert = require('node:assert/strict');
const { createSelfDevelopmentSandbox } = require('../self-development/sandbox-v2');

(async () => {
  const calls = [];
  const workspace = {
    requiredBranchPrefix: 'aria/self-development/battlecruiser/',
    async createBranch(branch, base) { calls.push({ op: 'createBranch', branch, base }); },
    async read(path, branch) { calls.push({ op: 'read', path, branch }); return { path, branch, sha: 'before' }; },
    async apply(change) { calls.push({ op: 'apply', ...change }); return { status: 'succeeded', commit_sha: 'commit-1' }; },
    async openPullRequest(input) { calls.push({ op: 'openPullRequest', ...input }); return { number: 111 }; }
  };

  const sandbox = createSelfDevelopmentSandbox({ workspace });
  const session = await sandbox.create({ objective: 'BattleCruiser safe change', seed: 'bc4' });
  assert.equal(session.branch.startsWith('aria/self-development/battlecruiser/'), true);
  assert.equal(session.base_branch, 'main');

  await assert.rejects(
    () => sandbox.stage(session.id, { path: 'x.js', content: 'x', risk_level: 'medium' }),
    /risk_not_allowed/
  );

  await sandbox.stage(session.id, { type: 'modify_file', path: 'x.js', content: 'x', risk_level: 'low' });
  const dry = await sandbox.run(session.id, { apply: false });
  assert.equal(dry.mode, 'dry_run');
  const applied = await sandbox.run(session.id, { apply: true });
  assert.equal(applied.results[0].result.status, 'succeeded');
  assert.equal(calls.some(c => c.op === 'apply' && c.branch === session.branch), true);
  assert.equal(calls.some(c => c.op === 'apply' && c.branch === 'main'), false);

  const promoted = await sandbox.promote(session.id, { verifier: async () => ({ passed: true }) });
  assert.equal(promoted.status, 'promotion_pending');
  assert.equal(calls.some(c => c.op === 'openPullRequest' && c.branch === session.branch && c.base === 'main'), true);

  console.log('BATTLECRUISER SANDBOX INTEGRATION PASS');
})();
