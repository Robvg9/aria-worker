'use strict';

const assert = require('node:assert/strict');
const { createGroqApiAdapter } = require('../credentials/provider-adapters');

(async () => {
  const pending = createGroqApiAdapter();
  assert.equal(pending.provider, 'groq');
  assert.equal(pending.bootstrap().human_gate, true);
  assert.deepEqual(await pending.provision(), {
    status: 'human_gate',
    reason: 'groq_api_key_required'
  });
  assert.equal((await pending.health()).state, 'bootstrap_required');

  const configured = createGroqApiAdapter({ credentialConfigured: true });
  assert.deepEqual(await configured.provision(), {
    status: 'configured',
    secret_ref: 'secret://groq/groq_primary',
    expires_at: null
  });
  assert.equal((await configured.health()).ok, true);
  assert.equal((await configured.renew()).status, 'unavailable');

  console.log('groq-credential-adapter.test.js: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
