'use strict';

const assert = require('node:assert/strict');
const { createCloudflareRuntimeAdapter } = require('./cloudflare-runtime-adapter');

async function run() {
  const calls = [];
  const stored = [];
  const secretStore = {
    async putSecret(ref, value, metadata) {
      stored.push({ ref, value, metadata });
    }
  };

  const adapter = createCloudflareRuntimeAdapter({
    workerUrl: 'https://aria.example',
    runtimeSecret: 'runtime-secret',
    secretStore,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({
        ok: true,
        credential_type: 'cloudflare_account_api_token',
        token_id: 'token-test-1',
        name: 'ARIA worker read',
        expires_on: null,
        value: 'cfat_' + 'x'.repeat(60)
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  const result = await adapter.issue({ credential_id: 'worker.read', template: 'worker_read' });
  assert.equal(result.ok, true);
  assert.equal(result.secret_ref, 'secret://cloudflare/worker.read');
  assert.equal(result.token_id, 'token-test-1');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].ref, 'secret://cloudflare/worker.read');
  assert.match(stored[0].value, /^cfat_/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://aria.example/admin/cloudflare/token');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, 'Bearer runtime-secret');

  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body, { template: 'worker_read', name: 'ARIA worker read' });

  await assert.rejects(
    () => createCloudflareRuntimeAdapter({ workerUrl: 'https://aria.example' }).issue({ credential_id: 'worker.read', template: 'worker_read' }),
    /secret_store_putSecret_required/
  );

  console.log('PASS: Cloudflare runtime credential adapter tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
