'use strict';

const assert = require('assert');
const { createGoogleGeminiApiAdapter } = require('../credentials/provider-adapters');

(async () => {
  const pending = createGoogleGeminiApiAdapter({ credentialConfigured: false });
  assert.deepStrictEqual(pending.bootstrap(), {
    human_gate: true,
    steps: [
      'create a Google Gemini API authorization key or approved OAuth credential',
      'store the credential only in the ARIA secret store',
      'bind it to the selected Gemini account/model route'
    ]
  });
  assert.deepStrictEqual(await pending.provision(), {
    status: 'human_gate',
    reason: 'google_gemini_credential_required'
  });
  assert.deepStrictEqual(await pending.health(), { ok: false, state: 'bootstrap_required' });

  const configured = createGoogleGeminiApiAdapter({ credentialConfigured: true });
  assert.deepStrictEqual(await configured.provision(), {
    status: 'configured',
    secret_ref: 'secret://google/gemini_primary',
    expires_at: null
  });
  const health = await configured.health();
  assert.deepStrictEqual(health, { ok: true, state: 'healthy' });
  assert.ok(!JSON.stringify(configured).includes('AIza'));

  console.log('google-gemini-credential-adapter.test.js: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
