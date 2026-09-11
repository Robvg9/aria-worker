'use strict';

const assert = require('node:assert/strict');
const {
  validateStep,
  buildSandboxPlan,
  createBattleCruiserSandboxWorkspace,
  normalizeSandboxBranch
} = require('../autonomy/battlecruiser/sandbox-controller');

(async () => {
  const branch = 'aria/sandbox/bc4-proof';

  assert.equal(normalizeSandboxBranch(branch), branch);
  assert.throws(() => normalizeSandboxBranch('main'), error => error.code === 'main_branch_forbidden');
  assert.throws(() => normalizeSandboxBranch('feature/random'), error => error.code === 'invalid_sandbox_branch');

  const inspect = validateStep({ phase: 'inspect', operation: 'repo_read', repo: 'Robvg9/battlecruiser' });
  assert.equal(inspect.mode, 'read_only');

  const modify = validateStep({ phase: 'modify', operation: 'file_write', repo: 'Robvg9/battlecruiser', branch });
  assert.equal(modify.mode, 'sandbox_write');
  assert.equal(modify.branch, branch);

  assert.throws(
    () => validateStep({ phase: 'modify', operation: 'file_write', repo: 'Robvg9/battlecruiser', branch: 'main' }),
    error => error.code === 'main_branch_forbidden'
  );
  assert.throws(
    () => validateStep({ phase: 'branch_sandbox', operation: 'file_write', repo: 'Robvg9/battlecruiser', branch }),
    error => error.code === 'branch_phase_requires_branch_create'
  );
  assert.throws(
    () => validateStep({ phase: 'inspect', operation: 'file_write', repo: 'Robvg9/battlecruiser' }),
    error => error.code === 'operation_not_allowed'
  );
  assert.throws(
    () => validateStep({ phase: 'modify', operation: 'file_write', repo: 'Robvg9/battlecruiser', branch: 'aria/sandbox/bc4/../../main' }),
    error => error.code === 'invalid_sandbox_branch' || error.code === 'main_branch_forbidden'
  );

  const plan = buildSandboxPlan({
    repository: 'Robvg9/battlecruiser',
    sandboxBranch: branch,
    files: ['docs/BC4_probe.md', 'test/bc4_probe.test.js']
  });
  assert.deepEqual(plan.map(step => step.phase), ['inspect', 'plan', 'branch_sandbox', 'modify', 'modify', 'regression', 'evaluate']);
  assert.equal(plan[2].operation, 'branch_create');

  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/git/ref/heads/main')) {
      return new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/git/refs')) {
      return new Response(JSON.stringify({ ref: 'refs/heads/aria/sandbox/bc4-proof' }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/contents/safe.js?ref=aria%2Fsandbox%2Fbc4-proof')) {
      return new Response(JSON.stringify({ sha: 'old-sha', content: 'YmVmb3Jl' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/contents/safe.js')) {
      return new Response(JSON.stringify({ sha: 'new-sha', content: 'YQ==' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/pulls')) {
      return new Response(JSON.stringify({ number: 44, html_url: 'https://github.com/Robvg9/battlecruiser/pull/44' }), { status: 201, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };

  const workspace = createBattleCruiserSandboxWorkspace({ token: 'test-token', fetchImpl: fakeFetch });
  await workspace.createBranch(branch);
  const before = await workspace.read('safe.js', branch);
  const applied = await workspace.apply({ branch, path: 'safe.js', content: 'after', risk_level: 'high' });
  const pr = await workspace.openPullRequest({ branch, title: 'BC-4 sandbox proof', body: 'Disposable sandbox proof.' });

  assert.equal(before.sha, 'old-sha');
  assert.equal(applied.status, 'succeeded');
  assert.equal(applied.branch, branch);
  assert.equal(pr.number, 44);
  assert.equal(calls.filter(call => call.init.method === 'PUT').length, 1);
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 2);
  assert.equal(calls.some(call => call.url.endsWith('/pulls')), true);

  console.log('BATTLECRUISER BC-4 SANDBOX CONTROLLER: PASS');
})().catch(error => { console.error(error); process.exit(1); });
