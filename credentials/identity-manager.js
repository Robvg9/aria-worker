'use strict';

/**
 * ARIA Identity & Credential Manager (provider-neutral control plane).
 *
 * This layer never stores raw secrets itself. Providers expose lifecycle
 * adapters and an injected secret store performs persistence/retrieval.
 */

const LIFECYCLE_STATES = Object.freeze([
  'unconfigured',
  'bootstrap_required',
  'configured',
  'healthy',
  'degraded',
  'expired',
  'revoked',
  'unavailable'
]);

function normalizeProvider(value) {
  return typeof value === 'string' && /^[a-z0-9._-]+$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : null;
}

function normalizeCredentialId(value) {
  return typeof value === 'string' && /^[a-z0-9._:-]+$/i.test(value.trim())
    ? value.trim()
    : null;
}

function assertNoSecretMaterial(value, field = 'value') {
  if (typeof value !== 'string') return;
  const raw = value.trim();
  if (/^(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-|Bearer\s|eyJ[A-Za-z0-9_-]+\.)/i.test(raw)) {
    throw new Error(`${field}_raw_secret_rejected`);
  }
}

function createIdentityCredentialManager({ secretStore, providers = {} }) {
  if (!secretStore || typeof secretStore.get !== 'function' || typeof secretStore.put !== 'function') {
    throw new TypeError('secretStore with get/put must be injected');
  }

  const registry = new Map();
  for (const [name, adapter] of Object.entries(providers)) {
    const provider = normalizeProvider(name);
    if (!provider || !adapter || typeof adapter !== 'object') continue;
    registry.set(provider, Object.freeze({ ...adapter }));
  }

  function getProvider(providerName) {
    const provider = normalizeProvider(providerName);
    if (!provider) return { provider: null, adapter: null, reason: 'provider_invalid' };
    return { provider, adapter: registry.get(provider) || null, reason: null };
  }

  async function inspect(providerName, credentialId) {
    const { provider, adapter } = getProvider(providerName);
    if (!provider) return { provider: null, credential_id: null, state: 'unconfigured', reason: 'provider_invalid' };
    const id = normalizeCredentialId(credentialId);
    if (!id) return { provider, credential_id: null, state: 'unconfigured', reason: 'credential_id_invalid' };
    const meta = await secretStore.get(`secret://${provider}/${id}`);
    if (!meta) {
      return {
        provider,
        credential_id: id,
        state: adapter?.bootstrap ? 'bootstrap_required' : 'unconfigured',
        bootstrap_required: Boolean(adapter?.bootstrap),
        capabilities: adapter?.capabilities || []
      };
    }
    return {
      provider,
      credential_id: id,
      state: meta.state || 'configured',
      expires_at: meta.expires_at ?? null,
      capabilities: adapter?.capabilities || [],
      renewable: typeof adapter?.renew === 'function',
      revocable: typeof adapter?.revoke === 'function'
    };
  }

  async function provision(providerName, credentialId, request = {}) {
    const { provider, adapter } = getProvider(providerName);
    if (!adapter || typeof adapter.provision !== 'function') {
      return { ok: false, provider, credential_id: credentialId, state: 'unavailable', reason: 'provider_provision_unsupported' };
    }
    const id = normalizeCredentialId(credentialId);
    if (!id) return { ok: false, provider, credential_id: null, state: 'unconfigured', reason: 'credential_id_invalid' };
    if (request.secret || request.token || request.access_token || request.private_key) {
      throw new Error('raw_secret_input_rejected');
    }
    const result = await adapter.provision({ provider, credential_id: id, ...request });
    if (!result || result.status === 'human_gate') return { ok: false, provider, credential_id: id, ...result };
    if (!result.secret_ref) throw new Error('provider_provision_missing_secret_ref');
    const expected = `secret://${provider}/${id}`;
    if (result.secret_ref !== expected) throw new Error('provider_secret_ref_mismatch');
    await secretStore.put(result.secret_ref, {
      state: result.state || 'configured',
      expires_at: result.expires_at ?? null,
      provider,
      credential_id: id,
      metadata: result.metadata || {}
    });
    return { ok: true, provider, credential_id: id, state: result.state || 'configured', expires_at: result.expires_at ?? null };
  }

  async function renew(providerName, credentialId) {
    const { provider, adapter } = getProvider(providerName);
    if (!adapter || typeof adapter.renew !== 'function') {
      return { ok: false, provider, credential_id: credentialId, state: 'unavailable', reason: 'provider_renew_unsupported' };
    }
    const id = normalizeCredentialId(credentialId);
    if (!id) throw new Error('credential_id_invalid');
    const current = await inspect(provider, id);
    if (current.state === 'bootstrap_required' || current.state === 'unconfigured') {
      return { ok: false, provider, credential_id: id, state: current.state, reason: 'bootstrap_required' };
    }
    const result = await adapter.renew({ provider, credential_id: id });
    if (!result || !result.secret_ref) throw new Error('provider_renew_missing_secret_ref');
    const expected = `secret://${provider}/${id}`;
    if (result.secret_ref !== expected) throw new Error('provider_secret_ref_mismatch');
    await secretStore.put(result.secret_ref, {
      state: result.state || 'healthy',
      expires_at: result.expires_at ?? null,
      provider,
      credential_id: id,
      metadata: result.metadata || {}
    });
    return { ok: true, provider, credential_id: id, state: result.state || 'healthy', expires_at: result.expires_at ?? null };
  }

  async function revoke(providerName, credentialId) {
    const { provider, adapter } = getProvider(providerName);
    if (!adapter || typeof adapter.revoke !== 'function') {
      return { ok: false, provider, credential_id: credentialId, state: 'unavailable', reason: 'provider_revoke_unsupported' };
    }
    const id = normalizeCredentialId(credentialId);
    if (!id) throw new Error('credential_id_invalid');
    const result = await adapter.revoke({ provider, credential_id: id });
    await secretStore.put(`secret://${provider}/${id}`, {
      state: 'revoked',
      expires_at: null,
      provider,
      credential_id: id,
      metadata: result?.metadata || {}
    });
    return { ok: true, provider, credential_id: id, state: 'revoked' };
  }

  async function health(providerName, credentialId) {
    const { provider, adapter } = getProvider(providerName);
    if (!adapter || typeof adapter.health !== 'function') {
      return { ok: false, provider, credential_id: credentialId, state: 'unavailable', reason: 'provider_health_unsupported' };
    }
    const id = normalizeCredentialId(credentialId);
    if (!id) throw new Error('credential_id_invalid');
    const result = await adapter.health({ provider, credential_id: id });
    const state = result?.ok ? 'healthy' : (result?.state || 'degraded');
    await secretStore.put(`secret://${provider}/${id}`, {
      state,
      expires_at: result?.expires_at ?? null,
      provider,
      credential_id: id,
      metadata: result?.metadata || {}
    });
    return { ok: Boolean(result?.ok), provider, credential_id: id, state, expires_at: result?.expires_at ?? null };
  }

  function bootstrapPlan(providerName, request = {}) {
    const { provider, adapter } = getProvider(providerName);
    if (!provider) return { ok: false, state: 'unconfigured', reason: 'provider_invalid' };
    if (!adapter?.bootstrap) return { ok: true, state: 'not_required', provider };
    const plan = adapter.bootstrap({ provider, ...request });
    return {
      ok: true,
      provider,
      state: 'bootstrap_required',
      human_gate: Boolean(plan?.human_gate),
      steps: Array.isArray(plan?.steps) ? plan.steps : []
    };
  }

  return Object.freeze({
    providers: Object.freeze([...registry.keys()]),
    inspect,
    provision,
    renew,
    revoke,
    health,
    bootstrapPlan
  });
}

module.exports = {
  LIFECYCLE_STATES,
  normalizeProvider,
  normalizeCredentialId,
  assertNoSecretMaterial,
  createIdentityCredentialManager
};
