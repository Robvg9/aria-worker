'use strict';

const assert = require('node:assert/strict');
const { createCloudflareTokenManager } = require('./cloudflare-token-manager');

function req(body, token='runtime-secret') {
  return new Request('https://aria.example/admin/cloudflare/token', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function main() {
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/permission_groups')) {
      return new Response(JSON.stringify({ success: true, result: [
        { id: 'workers-write-id', name: 'Workers Scripts Write' },
        { id: 'workers-read-id', name: 'Workers Scripts Read' }
      ]), { status: 200 });
    }
    if (url.endsWith('/tokens')) {
      return new Response(JSON.stringify({ success: true, result: {
        id: 'token-1', name: 'ARIA worker deploy', expires_on: null,
        value: 'cfat_' + 'x'.repeat(60)
      }}), { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  };

  const handler = createCloudflareTokenManager({ fetchImpl: fetchMock });

  const response = await handler(req({ template: 'worker_deploy', name: 'ARIA worker deploy' }), {
    ARIA_RUNTIME_SHARED_SECRET: 'runtime-secret',
    CLOUDFLARE_API_TOKEN: 'root-token',
    CLOUDFLARE_ACCOUNT_ID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.token_id, 'token-1');
  assert.match(body.value, /^cfat_/);

  const createCall = calls.at(-1);
  const parsed = JSON.parse(createCall.init.body);
  assert.equal(parsed.policies.length, 1);
  assert.deepEqual(parsed.policies[0].permission_groups, [{ id: 'workers-write-id', name: 'Workers Scripts Write' }]);
  assert.equal(parsed.policies[0].resources['com.cloudflare.api.account.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], '*');

  const rejected = await handler(req({ template: 'billing_full_access' }), {
    ARIA_RUNTIME_SHARED_SECRET: 'runtime-secret',
    CLOUDFLARE_API_TOKEN: 'root-token',
    CLOUDFLARE_ACCOUNT_ID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });
  assert.equal(rejected.status, 400);

  const unauthorized = await handler(req({ template: 'worker_read' }, 'wrong'), {
    ARIA_RUNTIME_SHARED_SECRET: 'runtime-secret',
    CLOUDFLARE_API_TOKEN: 'root-token',
    CLOUDFLARE_ACCOUNT_ID: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  });
  assert.equal(unauthorized.status, 401);

  console.log('cloudflare token manager tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
