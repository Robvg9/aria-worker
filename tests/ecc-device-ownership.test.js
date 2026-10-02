'use strict';

const assert = require('node:assert/strict');
const {
  claimDevice,
  renewDevice,
  releaseDevice,
  reconcileOwnership,
} = require('../scripts/ecc-device-ownership');

let ownership = {};
ownership = claimDevice(ownership, {
  device_id: 'pc-1',
  session_id: 'S-1',
  role: 'DEVELOPMENT',
  now: 1000,
  lease_ms: 10000,
});
assert.equal(ownership['pc-1'].state, 'CLAIMED');
assert.equal(ownership['pc-1'].fencing_token, 1);

assert.throws(
  () => claimDevice(ownership, {
    device_id: 'pc-1',
    session_id: 'S-2',
    now: 2000,
  }),
  /DEVICE_OWNERSHIP_CONFLICT/,
);

ownership = renewDevice(ownership, {
  device_id: 'pc-1',
  session_id: 'S-1',
  now: 5000,
  lease_ms: 10000,
});
assert.equal(ownership['pc-1'].expires_at, 15000);

ownership = releaseDevice(ownership, 'pc-1', 'S-1');
assert.equal(ownership['pc-1'].state, 'RELEASED');

ownership = claimDevice(ownership, {
  device_id: 'pc-1',
  session_id: 'S-2',
  now: 20000,
  lease_ms: 10000,
});
assert.equal(ownership['pc-1'].fencing_token, 2);
assert.equal(ownership['pc-1'].session_id, 'S-2');

const expired = reconcileOwnership(ownership, 40000);
assert.equal(expired['pc-1'].state, 'EXPIRED');
assert.equal(expired['pc-1'].expires_at, 0);

console.log('ECC DEVICE OWNERSHIP TEST: PASS');
