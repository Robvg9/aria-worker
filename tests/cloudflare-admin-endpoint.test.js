'use strict';

const assert = require('assert');
const { createCloudflareAdminEndpoint } = require('../integrations/cloudflare-admin-endpoint');

(async () => {
  const calls = [];
  const endpoint = createCloudflareAdminEndpoint({
    scriptName: 'aria',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ success: true, result: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });

  const missing = await endpoint(
    new Request('https://aria.example/admin/cloudflare'),
    {}
  );
  assert.strictEqual(missing.status, 500);

  const unauthorized = await endpoint(
    new Request('https://aria.example/admin/cloudflare', {
      headers: { authorization: 'Bearer wrong' }
    }),
    {
      ARIA_RUNTIME_SHARED_SECRET: 'runtime-secret',
      CLOUDFLARE_API_TOKEN: 'cf-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-id'
    }
  );
  assert.strictEqual(unauthorized.status, 401);

  const response = await endpoint(
    new Request('https://aria.example/admin/cloudflare?operation=deployments', {
      headers: { authorization: 'Bearer runtime-secret' }
    }),
    {
      ARIA_RUNTIME_SHARED_SECRET: 'runtime-secret',
      CLOUDFLARE_API_TOKEN: 'cf-token',
      CLOUDFLARE_ACCOUNT_ID: 'account-id'
    }
  );

  assert.strictEqual(response.status, 200);
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/accounts/account-id/workers/scripts/aria/deployments'));
  assert.strictEqual(calls[0].options.headers.authorization, 'Bearer cf-token');

  const payload = await response.json();
  assert.strictEqual(payload.operation, 'deployments');
  assert.strictEqual(payload.success, true);

  console.log('cloudflare-admin-endpoint.test.js: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
