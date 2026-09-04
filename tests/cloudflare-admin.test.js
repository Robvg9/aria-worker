'use strict';

const assert = require('assert');
const { createCloudflareAdminClient } = require('../integrations/cloudflare-admin');

(async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ success: true, result: { deployments: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const client = createCloudflareAdminClient({
    token: 'TEST_TOKEN',
    accountId: 'ACCOUNT_ID',
    fetchImpl: fakeFetch
  });

  await client.listDeployments('aria');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/workers/scripts/aria/deployments');
  assert.strictEqual(calls[0].options.method, 'GET');
  assert.strictEqual(calls[0].options.headers.get('authorization'), 'Bearer TEST_TOKEN');

  await client.getScriptContent('aria');
  assert.ok(calls[1].url.endsWith('/accounts/ACCOUNT_ID/workers/scripts/aria/content/v2'));

  console.log('cloudflare-admin.test.js: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
