'use strict';

const { createCloudflareRuntimeAdapter } = require('./cloudflare-runtime-adapter-v2');

/**
 * Provider lifecycle contracts for ARIA Identity & Credential Manager.
 * Providers never return raw secret material to callers.
 */

function createGitHubAppAdapter({ appId, installationId } = {}) {
  return Object.freeze({
    provider: 'github',
    capabilities: ['installation_token', 'rotate_automatically', 'health'],
    bootstrap: () => ({
      human_gate: !appId || !installationId,
      steps: ['create/install GitHub App once', 'store private key in ARIA secret store']
    }),
    async provision() {
      if (!appId || !installationId) return { status: 'human_gate', reason: 'github_app_bootstrap_required' };
      return { status: 'configured', secret_ref: 'secret://github/app_installation', expires_at: null };
    },
    async renew() {
      return { secret_ref: 'secret://github/app_installation', state: 'healthy', expires_at: new Date(Date.now() + 55 * 60 * 1000).toISOString() };
    },
    async health() {
      return { ok: Boolean(appId && installationId), state: appId && installationId ? 'healthy' : 'bootstrap_required' };
    }
  });
}

function createCloudflareApiAdapter({ rootTokenConfigured = false, workerUrl, runtimeSecret, secretStore, fetchImpl } = {}) {
  const liveIssuer = workerUrl && runtimeSecret && secretStore && typeof secretStore.putSecret === 'function'
    ? createCloudflareRuntimeAdapter({ workerUrl, runtimeSecret, secretStore, fetchImpl })
    : null;

  return Object.freeze({
    provider: 'cloudflare',
    capabilities: ['token_minting', 'token_rotation', 'health'],
    bootstrap: () => ({
      human_gate: !rootTokenConfigured,
      steps: [
        'create one bootstrap token with token-creation authority',
        'store bootstrap token only in the ARIA secret store',
        'mint narrower account/workspace tokens on demand'
      ]
    }),
    async provision(request = {}) {
      if (!rootTokenConfigured) return { status: 'human_gate', reason: 'cloudflare_root_token_required' };
      if (!liveIssuer) return { status: 'unavailable', reason: 'cloudflare_live_issuer_not_configured' };
      return liveIssuer.issue({
        credential_id: request.credential_id,
        profileName: request.profileName || 'worker_readonly'
      });
    },
    async renew() {
      return { status: 'unavailable', reason: 'cloudflare_rotation_requires_live_provider_operation' };
    },
    async health() {
      return { ok: Boolean(rootTokenConfigured && liveIssuer), state: rootTokenConfigured && liveIssuer ? 'healthy' : 'bootstrap_required' };
    }
  });
}

function createSupabaseOAuthAdapter({ clientConfigured = false } = {}) {
  return Object.freeze({
    provider: 'supabase',
    capabilities: ['oauth2', 'refresh_token', 'health'],
    bootstrap: () => ({
      human_gate: !clientConfigured,
      steps: [
        'register one Supabase OAuth integration',
        'complete initial user authorization once',
        'store client credentials and refresh token only in the ARIA secret store'
      ]
    }),
    async provision() {
      if (!clientConfigured) return { status: 'human_gate', reason: 'supabase_oauth_bootstrap_required' };
      return { status: 'configured', secret_ref: 'secret://supabase/management_oauth', expires_at: null };
    },
    async renew() {
      return { secret_ref: 'secret://supabase/management_oauth', state: 'healthy', expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
    },
    async health() {
      return { ok: Boolean(clientConfigured), state: clientConfigured ? 'healthy' : 'bootstrap_required' };
    }
  });
}

module.exports = {
  createGitHubAppAdapter,
  createCloudflareApiAdapter,
  createSupabaseOAuthAdapter
};
