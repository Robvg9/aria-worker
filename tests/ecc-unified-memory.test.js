'use strict';

const assert = require('node:assert/strict');
const { putMemory, buildUnifiedMemory, canonicalNamespace } = require('../scripts/ecc-unified-memory');

let envelope = {};
envelope = putMemory(envelope, 'context', 'session-1', { objective: 'test' });
envelope = putMemory(envelope, 'learning', 'pattern-1', { observations: 3 });
envelope = putMemory(envelope, 'failure', 'route-1', { prevention_state: 'ALTERNATIVE_REQUIRED' });

const unified = buildUnifiedMemory(envelope, {
  context_digest_sha256: 'ctx',
  learning_digest_sha256: 'learn',
  failure_digest_sha256: 'fail',
});

assert.equal(unified.schema, 'aria.ecc-unified-memory.v1');
assert.equal(unified.deterministic, true);
assert.equal(unified.policy.namespace_isolation, true);
assert.equal(unified.policy.overwrite_conflict, 'REJECT');
assert.equal(unified.namespaces.context['session-1'].objective, 'test');
assert.equal(unified.namespaces.learning['pattern-1'].observations, 3);
assert.equal(unified.namespaces.failure['route-1'].prevention_state, 'ALTERNATIVE_REQUIRED');
assert.equal(unified.unified_memory_digest_sha256.length, 64);

assert.deepEqual(
  buildUnifiedMemory({ ...envelope }).namespaces,
  unified.namespaces,
);

assert.throws(
  () => putMemory(envelope, 'context', 'session-1', { objective: 'different' }),
  /Memory conflict/,
);

assert.throws(
  () => canonicalNamespace('secret'),
  /Unsupported memory namespace/,
);

console.log('ECC UNIFIED MEMORY TEST: PASS');
