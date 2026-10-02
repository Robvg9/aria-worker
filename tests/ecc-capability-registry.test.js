'use strict';

const assert = require('node:assert/strict');
const {
  capabilityId,
  buildCapabilityRegistry,
} = require('../scripts/ecc-capability-registry');

const inventory = {
  schema: 'aria.ecc-live-inventory.v1',
  deterministic: true,
  complete_tree: true,
  digest_sha256: 'inventory-digest',
  source: {
    repository: 'https://github.com/affaan-m/ECC',
    tag: 'v2.2.3',
    commit_sha: 'commit',
  },
  entries: [
    { path: 'agents/code-reviewer.md', type: 'blob', sha: 'a', target_surfaces: [] },
    { path: 'skills/verification-loop/SKILL.md', type: 'blob', sha: 'b', target_surfaces: [] },
    { path: 'commands/code-review.md', type: 'blob', sha: 'c', target_surfaces: [] },
    { path: 'workflows/orch-review.workflow.js', type: 'blob', sha: 'd', target_surfaces: [] },
    { path: 'hooks/hooks.json', type: 'blob', sha: 'e', target_surfaces: [] },
    { path: '.mcp.json', type: 'blob', sha: 'f', target_surfaces: [] },
    { path: 'ecc2', type: 'tree', sha: 'g', target_surfaces: [] },
    { path: '.codex-plugin', type: 'tree', sha: 'h', target_surfaces: ['codex-plugin'] },
    { path: 'docs/README.md', type: 'blob', sha: 'ignored', target_surfaces: [] },
  ],
};

const registry = buildCapabilityRegistry(inventory);
assert.equal(registry.schema, 'aria.ecc-capability-registry.v1');
assert.equal(registry.deterministic, true);
assert.equal(registry.summary.total_capabilities, 8);
assert.equal(registry.summary.activation_count, 0);
assert.equal(registry.summary.enabled_count, 0);
assert.equal(registry.summary.kind_counts.agent, 1);
assert.equal(registry.summary.kind_counts.skill, 1);
assert.equal(registry.summary.kind_counts.command, 1);
assert.equal(registry.summary.kind_counts.workflow, 1);
assert.equal(registry.summary.kind_counts.hook, 1);
assert.equal(registry.summary.kind_counts.mcp, 1);
assert.equal(registry.summary.kind_counts['control-plane'], 1);
assert.equal(registry.summary.kind_counts.adapter, 1);
assert.ok(registry.capabilities.every(c => c.status === 'DISCOVERED'));
assert.ok(registry.capabilities.every(c => c.permissions.length === 0));
assert.equal(new Set(registry.capabilities.map(c => c.capability_id)).size, 8);
assert.equal(registry.registry_digest_sha256.length, 64);

const reversed = buildCapabilityRegistry({
  ...inventory,
  entries: [...inventory.entries].reverse(),
});
assert.equal(registry.registry_digest_sha256, reversed.registry_digest_sha256);
assert.equal(registry.capabilities.length, reversed.capabilities.length);

assert.equal(capabilityId('skill', 'verification-loop', 'b'), capabilityId('skill', 'verification-loop', 'b'));
assert.notEqual(capabilityId('skill', 'verification-loop', 'b'), capabilityId('skill', 'verification-loop', 'c'));

(async () => {
  await assert.rejects(
    () => buildCapabilityRegistry({
      ...inventory,
      deterministic: false,
    }),
    /complete deterministic inventory/,
  );

  console.log('ECC CAPABILITY REGISTRY TEST: PASS');
})();
