'use strict';

const assert = require('assert');
const { createCredentialProviderManager } = require('../credentials/credential-provider-manager');

(async () => {
  const audits = [];
  const manager = createCredentialProviderManager({
    providers: {
      cloudflare: {
        async issue() {
          return {
            ok: true,
            secret_ref: 'secret://cloudflare/test-runtime',
            token_id: 'tok_123',
            expires_at: '2099-01-01T00:00:00Z',
            leaked_secret: 'should-never-escape'
          };
        }
      }
    },
    audit: async event => audits.push(event)
  });

  const result = await manager.issue({ providerName: 'cloudflare', credential_id: 'test-runtime', profileName: 'worker_runtime' });

  assert.deepStrictEqual(result, {
    ok: true,
    provider: 'cloudflare',
    credential_id: 'test-runtime',
    secret_ref: 'secret://cloudflare/test-runtime',
    token_id: 'tok_123',
    expires_at: '2099-01-01T00:00:00Z'
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(result, 'leaked_secret'), false);
  assert.deepStrictEqual(audits, [{
    event: 'credential_issued',
    provider: 'cloudflare',
    credential_id: 'test-runtime',
    token_id: 'tok_123',
    expires_at: '2099-01-01T00:00:00Z'
  }]);

  await assert.rejects(
    manager.issue({ providerName: 'missing', credential_id: 'test-runtime' }),
    /credential_provider_not_found/
  );

  console.log('credential-provider-manager.test.js: ok');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
