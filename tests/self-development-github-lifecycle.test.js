'use strict';
const assert = require('node:assert/strict');
const { createGitHubBranchWorkspace } = require('../self-development/github-branch-workspace');

(async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/git/ref/heads/main')) return new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/git/refs')) return new Response(JSON.stringify({ ref: 'refs/heads/aria-selfdev-test' }), { status: 201, headers: { 'content-type': 'application/json' } });
    if (url.includes('/contents/safe.js?ref=aria-selfdev-test')) return new Response(JSON.stringify({ sha: 'old-sha', content: 'YmVmb3Jl' }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/contents/safe.js')) return new Response(JSON.stringify({ content: 'YQ==', sha: 'new-sha' }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/pulls')) return new Response(JSON.stringify({ number: 999, html_url: 'https://github.com/Robvg9/aria-worker/pull/999' }), { status: 201, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
  };

  const workspace = createGitHubBranchWorkspace({ token: 'test-token', fetchImpl: fakeFetch });
  await workspace.createBranch('aria-selfdev-test');
  const before = await workspace.read('safe.js', 'aria-selfdev-test');
  const applied = await workspace.apply({ branch: 'aria-selfdev-test', path: 'safe.js', content: 'after', after: 'after', risk_level: 'low' });
  const pr = await workspace.openPullRequest({ branch: 'aria-selfdev-test', title: 'test: governed self-development lifecycle', body: 'Disposable contract test.' });

  assert.equal(before.sha, 'old-sha');
  assert.equal(applied.status, 'succeeded');
  assert.equal(pr.number, 999);
  assert.equal(calls.filter(c => c.init.method === 'PUT').length, 1);
  assert.equal(calls.filter(c => c.init.method === 'POST').length, 2);
  assert.equal(calls.some(c => c.url.includes('/pulls')), true);
  console.log('SELF-DEVELOPMENT GITHUB LIFECYCLE: PASS — branch, read, governed low-risk write and PR boundary');
})().catch(error => { console.error(error); process.exit(1); });
