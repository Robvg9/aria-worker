'use strict';

const assert = require('node:assert/strict');
const { resolveContext } = require('../scripts/ecc-context-resolver');

const input = {
  mission: {
    id: ' M-1 ',
    objective: '  Verify ECC integration  ',
    acceptance: ' Evidence persisted ',
  },
  project: { id: 'P-1', name: ' ARIA ' },
  session: { id: 'S-1', continuation_key: 'C-1' },
  runtime: {
    platform: 'PC',
    device_ids: ['pc-2', 'pc-1', 'pc-1'],
    network_state: 'ONLINE',
  },
  constraints: {
    required_capability_kinds: ['skill', 'agent', 'skill'],
    preferred_surfaces: ['codex', 'codex'],
    forbidden_surfaces: ['legacy'],
    execution_allowed: true,
    require_human_approval: false,
  },
  provenance: {
    inventory_digest_sha256: 'inv',
    registry_digest_sha256: 'reg',
    compile_digest_sha256: 'comp',
  },
};

const resolved = resolveContext(input);
assert.equal(resolved.schema, 'aria.ecc-context.v1');
assert.equal(resolved.state, 'CONFLICT');
assert.equal(resolved.runtime.platform, 'pc');
assert.deepEqual(resolved.runtime.device_ids, ['pc-1', 'pc-2']);
assert.deepEqual(resolved.constraints.required_capability_kinds, ['agent', 'skill']);
assert.deepEqual(resolved.constraints.preferred_surfaces, ['codex']);
assert.equal(resolved.constraints.execution_allowed, false);
assert.equal(resolved.constraints.require_human_approval, true);
assert.ok(resolved.conflicts.some(x => x.code === 'UNSAFE_AUTONOMOUS_EXECUTION_REQUEST'));

const clean = resolveContext({
  mission: { objective: 'test' },
  runtime: { platform: 'android' },
});
assert.equal(clean.state, 'RESOLVED');
assert.equal(clean.constraints.execution_allowed, false);
assert.equal(clean.context_digest_sha256.length, 64);

const reversed = resolveContext({
  mission: { objective: 'test' },
  runtime: { platform: 'android' },
});
assert.equal(clean.context_digest_sha256, reversed.context_digest_sha256);

assert.throws(
  () => resolveContext({ mission: { objective: 'test' }, runtime: { platform: 'quantum' } }),
  /Unsupported context platform/,
);

assert.throws(
  () => resolveContext({ mission: {}, runtime: { platform: 'pc' } }),
  /Context objective is required/,
);

console.log('ECC CONTEXT RESOLVER TEST: PASS');
