'use strict';

const assert = require('node:assert/strict');
const { createCloudflareRuntimeAdapter } = require('../credentials/cloudflare-runtime-adapter-v2');

async function run() {
  const stored = [];
  const calls = [];
  const secretStore = { async putSecret(ref, value, metadata) { stored.push({ ref, value, metadata }); } };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      ok: true,
      token_id: 'token-test-2',
      name: 'ARIA Worker Readonly',
      expires_on: null,
      value: 'cfat_' + 'x'.repeat(60)
    }), { status: 200 });
  };

  const adapter = createCloudflareRuntimeAdapter({
    workerUrl: 'https://aria.example/',
    runtimeSecret: 'runtime-secret',
    secretStore,
    fetchImpl
  });

  const issued = await adapter.issue({ credential_id: 'cloudflare.default', profileName: 'worker_readonly' });
  assert.equal(issued.ok, true);
  assert.equal(issued.secret_ref, 'secret://cloudflare/cloudflare.default');
  assert.equal(issued.token_id, 'token-test-2');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].ref, issued.secret_ref);
  assert.match(stored[0].value, /^cfat_/);
  assert.equal(calls[0].init.headers.authorization, 'Bearer runtime-secret');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    template: 'worker_read',
    name: 'ARIA Worker Readonly'
  });

  await assert.rejects(
    () => adapter.issue({ credential_id: 'bad/id', profileName: 'worker_readonly' }),
    /credential_id_invalid/
  );
  await assert.rejects(
    () => adapter.issue({ credential_id: 'cloudflare.default', profileName: 'unsupported' }),
    /cloudflare_token_profile_invalid/
  );

  console.log('PASS: Cloudflare runtime adapter v2 tests');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
