'use strict';

const assert = require('node:assert/strict');
const {
  classifyPath,
  canonicalName,
  targetSurfaces,
  stableEntries,
  digestEntries,
  summarize,
  compileEccInventory,
} = require('../scripts/ecc-inventory-compiler');

const fixture = [
  { path: 'skills/verification-loop/SKILL.md', type: 'blob', sha: 'a', size: 1 },
  { path: 'agents/code-reviewer.md', type: 'blob', sha: 'b', size: 2 },
  { path: 'commands/code-review.md', type: 'blob', sha: 'c', size: 3 },
  { path: 'hooks/hooks.json', type: 'blob', sha: 'd', size: 4 },
  { path: 'mcp-configs/mcp-servers.json', type: 'blob', sha: 'e', size: 5 },
  { path: 'ecc2/src/main.rs', type: 'blob', sha: 'f', size: 6 },
  { path: '.codex-plugin/plugin.json', type: 'blob', sha: 'g', size: 7 },
  { path: 'workflows/orch-review.workflow.js', type: 'blob', sha: 'h', size: 8 },
  { path: 'tests/example.test.js', type: 'blob', sha: 'i', size: 9 },
  { path: 'VERSION', type: 'blob', sha: 'j', size: 10 },
  { path: 'skills', type: 'tree', sha: 'k' },
];

assert.equal(classifyPath('skills/verification-loop/SKILL.md'), 'skills');
assert.equal(classifyPath('agents/code-reviewer.md'), 'agents');
assert.equal(classifyPath('commands/code-review.md'), 'commands');
assert.equal(classifyPath('hooks/hooks.json'), 'hooks');
assert.equal(classifyPath('mcp-configs/mcp-servers.json'), 'mcp');
assert.equal(classifyPath('ecc2/src/main.rs'), 'ecc2');
assert.equal(classifyPath('.codex-plugin/plugin.json'), 'harness-surface');
assert.equal(classifyPath('workflows/orch-review.workflow.js'), 'workflows');

assert.equal(canonicalName('skills/verification-loop/SKILL.md', 'skills'), 'verification-loop');
assert.equal(canonicalName('agents/code-reviewer.md', 'agents'), 'code-reviewer');
assert.deepEqual(targetSurfaces('.codex-plugin/plugin.json'), ['codex-plugin']);

const first = stableEntries(fixture);
const shuffled = stableEntries([...fixture].reverse());
assert.deepEqual(first, shuffled);
assert.equal(digestEntries(first), digestEntries(shuffled));

const summary = summarize(first);
assert.equal(summary.total_entries, 11);
assert.equal(summary.files, 10);
assert.equal(summary.directories, 1);
assert.equal(summary.category_counts.agents, 1);
assert.equal(summary.category_counts.skills, 2);
assert.equal(summary.category_counts['harness-surface'], 1);
assert.equal(summary.category_counts.ecc2, 1);

const mockLock = {
  schema: 'aria.ecc-source-lock.v1',
  upstream: {
    repository: 'https://github.com/affaan-m/ECC',
    tag: 'v2.2.3',
    commit_sha: 'commit-sha',
    tag_signature_verified: true,
  },
  snapshot: {
    files: {
      'package.json': { git_blob_sha: 'pkg' },
    },
  },
};

const fakeFetch = async (url) => {
  if (url.includes('/git/commits/')) {
    return new Response(JSON.stringify({
      sha: 'commit-sha',
      tree: { sha: 'tree-sha' },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    sha: 'tree-sha',
    truncated: false,
    tree: [
      { path: 'package.json', type: 'blob', sha: 'pkg' },
      { path: 'agents/example.md', type: 'blob', sha: 'agent' },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

(async () => {
  const inventory = await compileEccInventory({ lockPath: undefined, fetchImpl: fakeFetch });
  assert.equal(inventory.source.commit_sha, 'commit-sha');
  assert.equal(inventory.complete_tree, true);
  assert.equal(inventory.summary.total_entries, 2);
  assert.equal(inventory.digest_sha256.length, 64);
  console.log('ECC INVENTORY COMPILER TEST: PASS');
})();
