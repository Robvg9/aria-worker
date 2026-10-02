'use strict';

const assert = require('assert');
const lock = require('../ecc/source-lock.json');

assert.strictEqual(lock.schema, 'aria.ecc-source-lock.v1');
assert.strictEqual(lock.upstream.tag, 'v2.2.3');
assert.strictEqual(lock.upstream.commit_sha, 'c05b2d6614f62f6db0047669aa4eefb223d478f9');
assert.strictEqual(lock.upstream.tag_signature_verified, true);
assert.strictEqual(lock.upstream.license, 'MIT');
assert.strictEqual(lock.snapshot.files['package.json'].version, '2.2.3');
assert.strictEqual(lock.snapshot.files['agent.yaml'].version, '2.2.3');
assert.strictEqual(lock.snapshot.files['VERSION'].version, '2.2.3');
assert.strictEqual(lock.registry_observation.package, 'ecc-universal');
assert.strictEqual(lock.registry_observation.published_version_verified, '2.2.3');
assert.strictEqual(lock.aria_binding.existing_operation, 'ecc.execute');
assert.strictEqual(lock.reconciliation.status, 'RESOLVED_AT_LOCKED_RELEASE');
assert.ok(lock.verification_contract.required.length >= 7);
console.log('ECC SOURCE LOCK TEST: PASS');
