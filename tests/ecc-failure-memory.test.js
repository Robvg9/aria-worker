'use strict';

const assert = require('node:assert/strict');
const {
  failureKey,
  recordFailure,
  buildFailureMemorySnapshot,
} = require('../scripts/ecc-failure-memory');

const event = {
  capability_id: 'a1',
  route: 'pc-pwa',
  error_code: 'CONTROL_NOT_REPRODUCIBLE',
  outcome: 'failure',
  evidence_refs: ['ev2', 'ev1'],
  observed_at: '2026-10-02T15:00:00Z',
};

assert.equal(
  failureKey(event),
  'a1|pc-pwa|CONTROL_NOT_REPRODUCIBLE',
);

let memory = {};
memory = recordFailure(memory, event);
assert.equal(memory[failureKey(event)].prevention_state, 'RETRY_ALLOWED');
memory = recordFailure(memory, event);
assert.equal(memory[failureKey(event)].prevention_state, 'RETRY_ALLOWED');
memory = recordFailure(memory, { ...event, evidence_refs: ['ev3'] });

const key = failureKey(event);
assert.equal(memory[key].failures, 3);
assert.equal(memory[key].prevention_state, 'ALTERNATIVE_REQUIRED');
assert.deepEqual(memory[key].evidence_refs, ['ev1', 'ev2', 'ev3']);

const snapshot = buildFailureMemorySnapshot(memory);
assert.equal(snapshot.schema, 'aria.ecc-failure-memory.v1');
assert.equal(snapshot.summary.patterns, 1);
assert.equal(snapshot.summary.alternative_required, 1);
assert.equal(snapshot.summary.retry_allowed, 0);
assert.equal(snapshot.memory_digest_sha256.length, 64);
assert.equal(snapshot.policy.auto_block, false);
assert.equal(snapshot.policy.auto_disable, false);

assert.throws(
  () => recordFailure({}, { outcome: 'success' }),
  /requires a failure event/,
);

console.log('ECC FAILURE MEMORY TEST: PASS');
