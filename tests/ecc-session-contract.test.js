'use strict';

const assert = require('node:assert/strict');
const { createSessionContract, advanceSession, digestSession } = require('../scripts/ecc-session-contract');

const session = createSessionContract({
  session_id: 'S-1',
  project_id: 'P-1',
  mission_id: 'M-1',
  continuation_key: 'C-1',
  checkpoint: { step: 'verify', state: 'pending' },
});

assert.equal(session.schema, 'aria.ecc-session-contract.v1');
assert.equal(session.revision, 0);
assert.equal(session.state, 'ACTIVE');
assert.equal(session.continuation_key, 'C-1');
assert.equal(session.owner_scope, 'ARIA_SESSION');
assert.equal(session.execution_authority, 'ARIA_CONTROLLED');
assert.equal(session.session_digest_sha256, digestSession(session));

const paused = advanceSession(session, 0, {
  state: 'PAUSED',
  checkpoint: { step: 'verify', state: 'paused' },
});
assert.equal(paused.revision, 1);
assert.equal(paused.state, 'PAUSED');

const resumed = advanceSession(paused, 1, { state: 'ACTIVE' });
assert.equal(resumed.revision, 2);
assert.equal(resumed.state, 'ACTIVE');

assert.throws(
  () => advanceSession(resumed, 0, { state: 'CLOSED' }),
  /SESSION_REVISION_CONFLICT/,
);

assert.throws(
  () => advanceSession(resumed, 2, { state: 'INVALID' }),
  /Unsupported session state/,
);

assert.throws(
  () => createSessionContract({ project_id: 'P-1' }),
  /session_id is required/,
);

console.log('ECC SESSION CONTRACT TEST: PASS');
