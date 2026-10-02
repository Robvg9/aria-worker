'use strict';

const assert = require('node:assert/strict');
const { verifyMission } = require('../scripts/ecc-verification-loop');

const graph = {
  schema: 'aria.ecc-mission-graph.v1',
  state: 'PLANNED',
  execution_state: 'DISABLED',
  graph_digest_sha256: 'graph',
  nodes: [
    { id: 'context', type: 'CONTEXT' },
    { id: 'verify', type: 'VERIFY' },
    { id: 'evidence', type: 'EVIDENCE' },
  ],
};

const loop = {
  schema: 'aria.ecc-autonomous-loop.v1',
  graph_digest_sha256: 'graph',
  loop_id: 'loop.123',
  state: 'COMPLETED',
  permission_grants: 0,
};

const passed = verifyMission(
  graph,
  loop,
  { status: 'SUCCEEDED', output: 'ok' },
  ['evidence-1'],
);

assert.equal(passed.schema, 'aria.ecc-verification-loop.v1');
assert.equal(passed.state, 'VERIFIED');
assert.equal(passed.passed, true);
assert.ok(passed.checks.every(c => c.passed));
assert.deepEqual(passed.evidence_refs, ['evidence-1']);
assert.equal(passed.verification_digest_sha256.length, 64);

const failedEvidence = verifyMission(
  graph,
  loop,
  { status: 'SUCCEEDED' },
  [],
);
assert.equal(failedEvidence.state, 'FAILED');
assert.equal(failedEvidence.passed, false);
assert.ok(failedEvidence.checks.some(c => c.code === 'evidence_present' && c.passed === false));

const secret = verifyMission(
  graph,
  loop,
  { status: 'SUCCEEDED', api_key: 'abcdefghijklmnop' },
  ['ev'],
);
assert.equal(secret.state, 'FAILED');
assert.ok(secret.checks.some(c => c.code === 'security_no_secrets' && c.passed === false));

const mismatch = verifyMission(
  { ...graph, graph_digest_sha256: 'other' },
  loop,
  { status: 'SUCCEEDED' },
  ['ev'],
);
assert.equal(mismatch.state, 'FAILED');
assert.equal(mismatch.checks[0].code, 'graph_digest_match');

assert.throws(
  () => verifyMission({ schema: 'wrong' }, loop, {}, ['ev']),
  /Unsupported mission graph schema/,
);

console.log('ECC VERIFICATION LOOP TEST: PASS');
