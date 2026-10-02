'use strict';

const assert = require('node:assert/strict');
const { observationKey, updateLearningLedger, buildLearningSnapshot } = require('../scripts/ecc-learning-adapter');

const event = {
  capability_id: 'a1',
  route: 'pc-pwa',
  error_code: 'CONTROL_NOT_REPRODUCIBLE',
  outcome: 'failure',
  evidence_refs: ['ev2', 'ev1'],
};

assert.equal(
  observationKey(event),
  'a1|pc-pwa|CONTROL_NOT_REPRODUCIBLE|failure',
);

let ledger = {};
ledger = updateLearningLedger(ledger, event);
ledger = updateLearningLedger(ledger, { ...event, evidence_refs: ['ev3'] });
ledger = updateLearningLedger(ledger, { ...event, evidence_refs: ['ev1'] });

const key = observationKey(event);
assert.equal(ledger[key].observations, 3);
assert.equal(ledger[key].failures, 3);
assert.equal(ledger[key].proposal_state, 'CANDIDATE_FOR_REVIEW');
assert.deepEqual(ledger[key].evidence_refs, ['ev1', 'ev2', 'ev3']);

const snapshot = buildLearningSnapshot(ledger);
assert.equal(snapshot.schema, 'aria.ecc-learning-adapter.v1');
assert.equal(snapshot.summary.keys, 1);
assert.equal(snapshot.summary.candidates_for_review, 1);
assert.equal(snapshot.summary.auto_promoted, 0);
assert.equal(snapshot.summary.auto_disabled, 0);
assert.equal(snapshot.policy.auto_promote, false);
assert.equal(snapshot.snapshot_digest_sha256.length, 64);

const reversed = buildLearningSnapshot({ [key]: ledger[key] });
assert.equal(snapshot.snapshot_digest_sha256, reversed.snapshot_digest_sha256);

assert.throws(
  () => updateLearningLedger({}, {}),
  /outcome is required/,
);

console.log('ECC LEARNING ADAPTER TEST: PASS');
