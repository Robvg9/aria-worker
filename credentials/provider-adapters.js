'use strict';

/**
 * Provider lifecycle contracts for ARIA Identity & Credential Manager.
 * These adapters deliberately separate bootstrap authority from renewable
 * credentials. They never return raw secret material to callers.
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
      if (!appId || !installationId) {
        return { status: 'human_gate', reason: 'github_app_bootstrap_required' };
      }
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

function createCloudflareApiAdapter({ rootTokenConfigured = false } = {}) {
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
      if (!rootTokenConfigured && !request.bootstrapAvailable) {
        return { status: 'human_gate', reason: 'cloudflare_root_token_required' };
      }
      return { status: 'configured', secret_ref: `secret://cloudflare/${request.credential_id || 'default'}`, expires_at: request.expires_at || null };
    },
    async renew(request = {}) {
      return { secret_ref: `secret://cloudflare/${request.credential_id || 'default'}`, state: 'healthy', expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
    },
    async health() {
      return { ok: Boolean(rootTokenConfigured), state: rootTokenConfigured ? 'healthy' : 'bootstrap_required' };
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
      if (!clientConfigured) {
        return { status: 'human_gate', reason: 'supabase_oauth_bootstrap_required' };
      }
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
