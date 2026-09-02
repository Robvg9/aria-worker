'use strict';

const assert = require('node:assert/strict');
const { createCredentialBoundary, validateRef, sanitizeError } = require('../credentials/boundary');

async function run() {
  assert.equal(validateRef('secret://openrouter/acct_openrouter_primary').valid, true);
  assert.equal(validateRef('sk-super-secret-key').reason, 'secret_material_rejected');
  assert.equal(validateRef('Bearer super-secret-token').reason, 'secret_material_rejected');
  assert.equal(validateRef('secret://openrouter/acct?token=LEAK').reason, 'credential_ref_invalid');
  assert.equal(validateRef('').reason, 'credential_ref_missing');
  assert.equal(validateRef('secret://openrouter').reason, 'credential_ref_invalid');

  const calls = [];
  const secret = 'REAL_SECRET_DO_NOT_RETURN';
  const boundary = createCredentialBoundary({
    async resolve(ref, context) {
      calls.push({ ref, context });
      return { secret };
    }
  });

  const result = await boundary.withCredential(
    'secret://openrouter/acct_openrouter_primary',
    { authorization_id: 'auth_1' },
    async (resolvedSecret, meta) => ({ ok: true, ref: meta.credential_ref, length: resolvedSecret.length })
  );

  assert.equal(result.ok, true);
  assert.equal(result.ref, 'secret://openrouter/acct_openrouter_primary');
  assert.equal(result.length, secret.length);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.authorization_id, 'auth_1');

  await assert.rejects(
    () => boundary.withCredential('sk-super-secret-key', {}, async () => ({ ok: true })),
    /secret_material_rejected/
  );
  assert.equal(calls.length, 1, 'invalid refs must not resolve');

  await assert.rejects(
    () => boundary.withCredential('secret://openrouter/acct_openrouter_primary', {}, async () => secret),
    /secret_output_blocked/
  );

  await assert.rejects(
    () => boundary.withCredential('secret://openrouter/acct_openrouter_primary', {}, async () => { throw new Error(`Bearer ${secret}`); }),
    /\[REDACTED\]/
  );

  assert.match(sanitizeError(new Error('Bearer abc123')), /\[REDACTED\]/);
  assert.doesNotMatch(sanitizeError(new Error('secret://openrouter/acct_openrouter_primary')), /acct_openrouter_primary/);
  assert.match(sanitizeError(new Error(`sk-${secret}`)), /\[REDACTED\]/);

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
