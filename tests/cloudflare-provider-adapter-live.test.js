'use strict';

const assert = require('node:assert/strict');
const { createCloudflareApiAdapter } = require('../credentials/provider-adapters');

(async () => {
  const stored = [];
  const secretStore = {
    async putSecret(ref, value, metadata) { stored.push({ ref, value, metadata }); }
  };
  const adapter = createCloudflareApiAdapter({
    rootTokenConfigured: true,
    workerUrl: 'https://aria.example.workers.dev',
    runtimeSecret: 'runtime-secret-test-only',
    secretStore,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(options.method, 'POST');
      assert.equal(body.template, 'worker_read');
      return new Response(JSON.stringify({ ok: true, value: 'x'.repeat(48), token_id: 'tok-1', name: body.name, expires_on: null }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  const result = await adapter.provision({ credential_id: 'cf-test', profileName: 'worker_readonly' });
  assert.equal(result.ok, true);
  assert.equal(result.secret_ref, 'secret://cloudflare/cf-test');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].ref, 'secret://cloudflare/cf-test');
  assert.equal(stored[0].value, 'x'.repeat(48));

  const health = await adapter.health();
  assert.equal(health.ok, true);

  console.log('cloudflare-provider-adapter-live.test.js: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
