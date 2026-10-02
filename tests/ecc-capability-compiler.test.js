'use strict';

const assert = require('node:assert/strict');
const { bindingFor, compileCapabilityRegistry } = require('../scripts/ecc-capability-compiler');

const registry = {
  schema: 'aria.ecc-capability-registry.v1',
  source: {
    repository: 'https://github.com/affaan-m/ECC',
    tag: 'v2.2.3',
    commit_sha: 'commit',
    registry_digest_sha256: 'registry',
  },
  capabilities: [
    {
      capability_id: 'ecc.agent.a',
      kind: 'agent',
      name: 'reviewer',
      source_path: 'agents/reviewer.md',
      source_sha: 'a',
      source_commit: 'commit',
      source_tag: 'v2.2.3',
      target_surfaces: ['codex'],
      status: 'DISCOVERED',
      verification_contract: { state: 'NOT_VERIFIED' },
    },
    {
      capability_id: 'ecc.skill.b',
      kind: 'skill',
      name: 'verification-loop',
      source_path: 'skills/verification-loop/SKILL.md',
      source_sha: 'b',
      source_commit: 'commit',
      source_tag: 'v2.2.3',
      target_surfaces: [],
      status: 'DISCOVERED',
      verification_contract: { state: 'NOT_VERIFIED' },
    },
    {
      capability_id: 'ecc.mcp.c',
      kind: 'mcp',
      name: 'mcp.json',
      source_path: 'mcp-configs/mcp.json',
      source_sha: 'c',
      source_commit: 'commit',
      source_tag: 'v2.2.3',
      target_surfaces: [],
      status: 'DISCOVERED',
      verification_contract: { state: 'NOT_VERIFIED' },
    },
  ],
};

const clean = {
  schema: 'aria.ecc-drift-report.v1',
  state: 'CLEAN',
  source: { commit_sha: 'commit' },
};

const compiled = compileCapabilityRegistry(registry, clean);
assert.equal(compiled.schema, 'aria.ecc-compiled-capabilities.v1');
assert.equal(compiled.deterministic, true);
assert.equal(compiled.summary.total_compiled, 3);
assert.equal(compiled.summary.total_bound, 0);
assert.equal(compiled.summary.total_disabled, 3);
assert.equal(compiled.summary.kind_counts.agent, 1);
assert.equal(compiled.summary.kind_counts.skill, 1);
assert.equal(compiled.compiled_capabilities[0].runtime_binding.state, 'UNBOUND');
assert.equal(compiled.compiled_capabilities[0].runtime_binding.entrypoint, null);
assert.deepEqual(compiled.compiled_capabilities[0].permissions, []);
assert.equal(compiled.compile_digest_sha256.length, 64);

const reversed = compileCapabilityRegistry({
  ...registry,
  capabilities: [...registry.capabilities].reverse(),
}, clean);
assert.equal(compiled.compile_digest_sha256, reversed.compile_digest_sha256);

assert.equal(bindingFor('agent'), 'aria.agent-runtime');
assert.equal(bindingFor('mcp'), 'aria.mcp-gateway');

assert.throws(
  () => compileCapabilityRegistry(registry, { ...clean, state: 'DRIFT' }),
  /refuses non-clean drift report/,
);

assert.throws(
  () => compileCapabilityRegistry(registry, { ...clean, source: { commit_sha: 'other' } }),
  /source commit mismatch/,
);

console.log('ECC CAPABILITY COMPILER TEST: PASS');
