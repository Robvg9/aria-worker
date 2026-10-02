'use strict';

const assert = require('node:assert/strict');
const { buildAgentAdapterLayer } = require('../scripts/ecc-agent-adapter-layer');

const compiled = {
  schema: 'aria.ecc-compiled-capabilities.v1',
  source: { repository: 'ecc', tag: 'v2.2.3', commit_sha: 'commit', compile_digest_sha256: 'compile' },
  compiled_capabilities: [
    {
      capability_id: 'a1',
      kind: 'agent',
      name: 'reviewer',
      source: { path: 'agents/reviewer.md', sha: 'sha', commit_sha: 'commit', tag: 'v2.2.3' },
      target_surfaces: ['codex'],
      lifecycle: { source_state: 'DISCOVERED', compile_state: 'COMPILED' },
      verification: { state: 'NOT_VERIFIED' },
    },
    {
      capability_id: 's1',
      kind: 'skill',
      name: 'verification-loop',
      source: { path: 'skills/verification-loop/SKILL.md', sha: 's', commit_sha: 'commit', tag: 'v2.2.3' },
      target_surfaces: [],
      lifecycle: { source_state: 'DISCOVERED', compile_state: 'COMPILED' },
      verification: { state: 'NOT_VERIFIED' },
    },
  ],
};

const layer = buildAgentAdapterLayer(compiled);
assert.equal(layer.schema, 'aria.ecc-agent-adapter-layer.v1');
assert.equal(layer.summary.total_agents, 1);
assert.equal(layer.summary.bound, 0);
assert.equal(layer.summary.enabled, 0);
assert.equal(layer.summary.execution_grants, 0);
assert.equal(layer.agents[0].adapter.key, 'aria.agent-runtime');
assert.equal(layer.agents[0].adapter.state, 'UNBOUND');
assert.equal(layer.agents[0].invocation.mode, 'DEFERRED');
assert.equal(layer.agents[0].invocation.requires_context, true);
assert.equal(layer.agents[0].invocation.requires_selection, true);
assert.equal(layer.agents[0].invocation.requires_verification, true);
assert.equal(layer.agents[0].invocation.execution_grants, 0);
assert.deepEqual(layer.agents[0].permissions, []);
assert.equal(layer.adapter_digest_sha256.length, 64);

const reversed = buildAgentAdapterLayer({
  ...compiled,
  compiled_capabilities: [...compiled.compiled_capabilities].reverse(),
});
assert.equal(layer.adapter_digest_sha256, reversed.adapter_digest_sha256);

assert.throws(
  () => buildAgentAdapterLayer({ schema: 'wrong' }),
  /Unsupported compiled capability schema/,
);

console.log('ECC AGENT ADAPTER LAYER TEST: PASS');
