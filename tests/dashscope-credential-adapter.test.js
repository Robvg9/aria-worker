'use strict';

const assert = require('node:assert/strict');
const { createDashScopeApiAdapter } = require('../credentials/provider-adapters');

(async () => {
  const pending = createDashScopeApiAdapter();
  assert.equal(pending.provider, 'alibaba_dashscope');
  assert.equal(pending.bootstrap().human_gate, true);
  assert.deepEqual(await pending.provision(), {
    status: 'human_gate',
    reason: 'dashscope_workspace_key_and_free_quota_guard_required'
  });
  assert.equal((await pending.health()).state, 'bootstrap_required');

  const configured = createDashScopeApiAdapter({
    credentialConfigured: true,
    freeQuotaOnlyConfirmed: true,
    quotaExpiresAt: '2099-01-01T00:00:00.000Z'
  });
  assert.deepEqual(await configured.provision(), {
    status: 'configured',
    secret_ref: 'secret://dashscope/qwen_primary',
    expires_at: null,
    free_quota_expires_at: '2099-01-01T00:00:00.000Z'
  });
  assert.equal((await configured.health()).ok, true);

  const noGuard = createDashScopeApiAdapter({
    credentialConfigured: true,
    freeQuotaOnlyConfirmed: false,
    quotaExpiresAt: '2099-01-01T00:00:00.000Z'
  });
  assert.deepEqual(await noGuard.provision(), {
    status: 'human_gate',
    reason: 'dashscope_free_quota_only_not_confirmed'
  });
  const expired = createDashScopeApiAdapter({
    credentialConfigured: true,
    freeQuotaOnlyConfirmed: true,
    quotaExpiresAt: '2020-01-01T00:00:00.000Z'
  });
  assert.deepEqual(await expired.provision(), {
    status: 'unavailable',
    reason: 'dashscope_free_quota_expired'
  });

  console.log('dashscope-credential-adapter.test.js: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
