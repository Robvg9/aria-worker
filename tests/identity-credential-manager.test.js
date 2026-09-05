'use strict';

const assert = require('node:assert/strict');
const {
  createIdentityCredentialManager,
  normalizeProvider,
  normalizeCredentialId
} = require('../credentials/identity-manager');
const {
  createGitHubAppAdapter,
  createCloudflareApiAdapter,
  createSupabaseOAuthAdapter
} = require('../credentials/provider-adapters');

async function run() {
  assert.equal(normalizeProvider(' GitHub '), 'github');
  assert.equal(normalizeCredentialId('account.primary'), 'account.primary');

  const store = new Map();
  const secretStore = {
    async get(ref) { return store.get(ref) || null; },
    async put(ref, meta) { store.set(ref, meta); }
  };

  const manager = createIdentityCredentialManager({
    secretStore,
    providers: {
      github: createGitHubAppAdapter({ appId: '4835157', installationId: 'install-1' }),
      cloudflare: createCloudflareApiAdapter({ rootTokenConfigured: false }),
      supabase: createSupabaseOAuthAdapter({ clientConfigured: false })
    }
  });

  assert.deepEqual(manager.providers, ['github', 'cloudflare', 'supabase']);

  const githubBootstrap = manager.bootstrapPlan('github');
  assert.equal(githubBootstrap.human_gate, false);

  const github = await manager.provision('github', 'app_installation');
  assert.equal(github.ok, true);
  assert.equal(github.state, 'configured');
  assert.equal(github.expires_at, null);

  const renewed = await manager.renew('github', 'app_installation');
  assert.equal(renewed.ok, true);
  assert.equal(renewed.state, 'healthy');
  assert.ok(renewed.expires_at);

  const cfBootstrap = manager.bootstrapPlan('cloudflare');
  assert.equal(cfBootstrap.human_gate, true);
  const cf = await manager.provision('cloudflare', 'worker-admin');
  assert.equal(cf.ok, false);
  assert.equal(cf.reason, 'cloudflare_root_token_required');

  const sbBootstrap = manager.bootstrapPlan('supabase');
  assert.equal(sbBootstrap.human_gate, true);
  const sb = await manager.provision('supabase', 'management_oauth');
  assert.equal(sb.ok, false);
  assert.equal(sb.reason, 'supabase_oauth_bootstrap_required');

  await assert.rejects(
    () => manager.provision('github', 'bad', { token: 'github_pat_DO_NOT_STORE' }),
    /raw_secret_input_rejected/
  );

  const inspected = await manager.inspect('github', 'app_installation');
  assert.equal(inspected.state, 'healthy');
  assert.equal(inspected.renewable, true);
  assert.equal(inspected.revocable, false);

  const revoked = await manager.revoke('github', 'app_installation');
  assert.equal(revoked.ok, false);
  assert.equal(revoked.reason, 'provider_revoke_unsupported');

  console.log('PASS: ARIA identity/credential manager tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
