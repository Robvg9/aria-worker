'use strict';

const assert = require('node:assert/strict');
const { TOKEN_PROFILES, resolvePermissionGroups, createAccountToken } = require('../integrations/cloudflare-token-factory');

async function run() {
  assert.deepEqual(TOKEN_PROFILES.worker_readonly.permission_groups, ['Workers Scripts Read']);
  assert.deepEqual(TOKEN_PROFILES.worker_runtime.permission_groups, ['Workers Scripts Read', 'Workers Scripts Write']);

  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/tokens/permission_groups')) {
      return new Response(JSON.stringify({ success: true, result: [
        { id: 'read-id', name: 'Workers Scripts Read' },
        { id: 'write-id', name: 'Workers Scripts Write' }
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, result: {
      id: 'token-id',
      value: 'CF_TEST_TOKEN_DO_NOT_USE',
      expires_on: '2026-10-05T00:00:00Z'
    } }), { status: 200 });
  };

  const groups = await resolvePermissionGroups(fetchImpl, 'ROOT', 'account-123', ['Workers Scripts Read']);
  assert.deepEqual(groups, [{ id: 'read-id', name: 'Workers Scripts Read' }]);

  const created = await createAccountToken({
    token: 'ROOT',
    accountId: 'account-123',
    profileName: 'worker_runtime',
    expiresOn: '2026-10-05T00:00:00Z',
    fetchImpl
  });

  assert.equal(created.token_id, 'token-id');
  assert.equal(created.profile, 'worker_runtime');
  assert.deepEqual(created.permissions, ['Workers Scripts Read', 'Workers Scripts Write']);

  const createCall = calls.find(call => call.url.endsWith('/accounts/account-123/tokens'));
  const body = JSON.parse(createCall.init.body);
  assert.equal(body.policies[0].resources['com.cloudflare.api.account.account-123'], '*');
  assert.deepEqual(body.policies[0].permission_groups, [
    { id: 'read-id', name: 'Workers Scripts Read' },
    { id: 'write-id', name: 'Workers Scripts Write' }
  ]);
  assert.equal(body.expires_on, '2026-10-05T00:00:00Z');

  const missing = async () => new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
  await assert.rejects(
    () => resolvePermissionGroups(missing, 'ROOT', 'account-123', ['Workers Scripts Write']),
    /cloudflare_permission_groups_missing:Workers Scripts Write/
  );

  console.log('PASS: Cloudflare governed token factory tests');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
