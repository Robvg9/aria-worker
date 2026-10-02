'use strict';

const assert = require('node:assert/strict');
const { createNvidiaNimApiAdapter } = require('../credentials/provider-adapters');

(async () => {
  const unconfigured = createNvidiaNimApiAdapter();
  assert.equal(unconfigured.provider, 'nvidia');
  assert.equal(unconfigured.capabilities.includes('text_generation'), true);
  assert.deepEqual(await unconfigured.health(), { ok: false, state: 'bootstrap_required' });
  assert.deepEqual(await unconfigured.provision({ credential_id: 'nvidia-test' }), {
    status: 'human_gate',
    reason: 'nvidia_api_key_required'
  });

  const configured = createNvidiaNimApiAdapter({ credentialConfigured: true });
  assert.deepEqual(await configured.health(), { ok: true, state: 'healthy' });
  assert.deepEqual(await configured.provision({ credential_id: 'nvidia-test' }), {
    status: 'configured',
    secret_ref: 'secret://nvidia/nim_primary',
    expires_at: null
  });

  console.log('nvidia credential provider tests: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
