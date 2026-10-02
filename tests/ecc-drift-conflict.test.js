'use strict';

const assert = require('node:assert/strict');
const { analyzeDrift } = require('../scripts/ecc-drift-conflict');

const inventory = {
  schema: 'aria.ecc-live-inventory.v1',
  deterministic: true,
  complete_tree: true,
  digest_sha256: 'inv',
  source: { repository: 'ecc', tag: 'v2.2.3', commit_sha: 'commit' },
  entries: [
    { path: 'agents/a.md', type: 'blob', sha: 'aaa' },
    { path: 'skills/s/SKILL.md', type: 'blob', sha: 'bbb' },
  ],
};

const cleanRegistry = {
  schema: 'aria.ecc-capability-registry.v1',
  deterministic: true,
  source: { repository: 'ecc', tag: 'v2.2.3', commit_sha: 'commit', registry_digest_sha256: 'reg' },
  capabilities: [
    { capability_id: 'a1', kind: 'agent', name: 'a', source_path: 'agents/a.md', source_sha: 'aaa' },
    { capability_id: 's1', kind: 'skill', name: 's', source_path: 'skills/s/SKILL.md', source_sha: 'bbb' },
  ],
};

const clean = analyzeDrift(inventory, cleanRegistry);
assert.equal(clean.state, 'CLEAN');
assert.equal(clean.summary.total_findings, 0);

const collision = analyzeDrift(inventory, {
  ...cleanRegistry,
  capabilities: [
    ...cleanRegistry.capabilities,
    { capability_id: 'a2', kind: 'agent', name: 'a', source_path: 'agents/a2.md', source_sha: 'ccc' },
  ],
});
assert.equal(collision.state, 'DRIFT');
assert.equal(collision.summary.high, 1);
assert.equal(collision.findings[0].code, 'CAPABILITY_NAME_DRIFT');

const pathCollision = analyzeDrift(inventory, {
  ...cleanRegistry,
  capabilities: [
    { capability_id: 'a1', kind: 'agent', name: 'a', source_path: 'agents/a.md', source_sha: 'aaa' },
    { capability_id: 'x1', kind: 'hook', name: 'x', source_path: 'agents/a.md', source_sha: 'aaa' },
  ],
});
assert.ok(pathCollision.findings.some(f => f.code === 'SOURCE_PATH_COLLISION'));

const mismatch = analyzeDrift(inventory, {
  ...cleanRegistry,
  source: { ...cleanRegistry.source, commit_sha: 'other' },
});
assert.equal(mismatch.state, 'DRIFT');
assert.equal(mismatch.findings[0].code, 'SOURCE_COMMIT_MISMATCH');

const mutated = analyzeDrift(inventory, {
  ...cleanRegistry,
  capabilities: [{ ...cleanRegistry.capabilities[0], source_sha: 'wrong' }],
});
assert.ok(mutated.findings.some(f => f.code === 'REGISTRY_SOURCE_SHA_DRIFT'));

const reversed = analyzeDrift(inventory, {
  ...cleanRegistry,
  capabilities: [...cleanRegistry.capabilities].reverse(),
});
assert.deepEqual(clean, reversed);

console.log('ECC DRIFT/CONFLICT TEST: PASS');
