'use strict';
const assert = require('node:assert/strict');
const { assertBranch, createGitHubBranchWorkspace } = require('../self-development/github-branch-workspace');

assert.throws(() => assertBranch('main'), /protected_branch_forbidden/);
assert.throws(() => assertBranch('master'), /protected_branch_forbidden/);
assert.throws(() => assertBranch('../escape'), /invalid_branch/);
assert.throws(() => assertBranch('aria/other/proof', { requiredPrefix: 'aria/self-development/battlecruiser/' }), /sandbox_branch_required/);
assert.equal(assertBranch('aria/self-development/battlecruiser/proof'), 'aria/self-development/battlecruiser/proof');

(async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/git/ref/heads/main')) return new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200 });
    if (String(url).includes('/contents/proof.txt?ref=')) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    if (String(url).endsWith('/git/refs')) return new Response(JSON.stringify({ ref: 'refs/heads/aria/self-development/battlecruiser/proof' }), { status: 201 });
    if (String(url).endsWith('/contents/proof.txt')) return new Response(JSON.stringify({ commit: { sha: 'proof-commit' } }), { status: 201 });
    if (String(url).endsWith('/pulls')) return new Response(JSON.stringify({ number: 99, state: 'open', head: { ref: 'aria/self-development/battlecruiser/proof' } }), { status: 201 });
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const ws = createGitHubBranchWorkspace({ token: 'test-token', owner: 'Robvg9', repo: 'battlecruiser', fetchImpl });
  await ws.createBranch('aria/self-development/battlecruiser/proof');
  const result = await ws.apply({ branch: 'aria/self-development/battlecruiser/proof', path: 'proof.txt', content: 'ARIA_BC4_SANDBOX_OK\n', risk_level: 'low' });
  assert.equal(result.status, 'succeeded');
  const pr = await ws.openPullRequest({ branch: 'aria/self-development/battlecruiser/proof', title: 'test' });
  assert.equal(pr.number, 99);
  assert.equal(calls.some(x => x.url.endsWith('/contents/proof.txt?ref=main')), false);
  assert.equal(calls.some(x => x.init?.body?.includes('aria/self-development/battlecruiser/proof')), true);

  await assert.rejects(
    () => ws.apply({ branch: 'feature/not-sandboxed', path: 'proof.txt', content: 'x', risk_level: 'low' }),
    /sandbox_branch_required/
  );

  console.log('GITHUB BATTLECRUISER SANDBOX TESTS PASS');
})();
