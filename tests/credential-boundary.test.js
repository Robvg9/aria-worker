'use strict';

const assert = require('node:assert/strict');
const { createCredentialBoundary, validateRef, sanitizeError } = require('../credentials/boundary');

async function run() {
  assert.equal(validateRef('secret://openrouter/acct_openrouter_primary').valid, true);
  assert.equal(validateRef('sk-super-secret-key').valid, false);
  assert.equal(validateRef('Bearer super-secret-token').valid, false);
  assert.equal(validateRef('').reason, 'credential_ref_missing');
  assert.equal(validateRef('secret://openrouter').reason, 'credential_ref_invalid');

  const calls = [];
  const boundary = createCredentialBoundary({
    async resolve(ref, context) {
      calls.push({ ref, context });
      return { secret: 'REAL_SECRET_DO_NOT_RETURN' };
    }
  });

  const result = await boundary.withCredential(
    'secret://openrouter/acct_openrouter_primary',
    { authorization_id: 'auth_1' },
    async (secret, meta) => ({ ok: true, got: secret, ref: meta.credential_ref })
  );

  assert.equal(result.ok, true);
  assert.equal(result.got, 'REAL_SECRET_DO_NOT_RETURN');
  assert.equal(result.ref, 'secret://openrouter/acct_openrouter_primary');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.authorization_id, 'auth_1');

  await assert.rejects(
    () => boundary.withCredential('sk-super-secret-key', {}, async () => ({ ok: true })),
    /secret_material_rejected|credential_ref_invalid/
  );
  assert.equal(calls.length, 1, 'invalid refs must not resolve');

  await assert.rejects(
    () => boundary.withCredential('secret://openrouter/acct_openrouter_primary', {}, async () => { throw new Error('Bearer LEAKME'); }),
    /\[REDACTED\]/
  );

  assert.match(sanitizeError(new Error('Bearer abc123')), /\[REDACTED\]/);
  assert.doesNotMatch(sanitizeError(new Error('secret://openrouter/acct_openrouter_primary')), /acct_openrouter_primary/);

  const unavailable = createCredentialBoundary({ async resolve() { return null; } });
  await assert.rejects(
    () => unavailable.withCredential('secret://openrouter/acct_openrouter_primary', {}, async () => ({ ok: true })),
    /credential_unavailable/
  );

  console.log('PASS: credential secret boundary tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
