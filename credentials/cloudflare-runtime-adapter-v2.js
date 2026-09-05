'use strict';

const { TOKEN_PROFILES } = require('../integrations/cloudflare-token-factory');

function validCredentialId(value) {
  return typeof value === 'string' && /^[a-z0-9._:-]+$/i.test(value.trim());
}

function createCloudflareRuntimeAdapter({ workerUrl, runtimeSecret, secretStore, fetchImpl = globalThis.fetch } = {}) {
  return Object.freeze({
    provider: 'cloudflare',
    capabilities: ['token_minting', 'health'],
    async issue({ credential_id, profileName = 'worker_readonly' } = {}) {
      if (!workerUrl || !runtimeSecret) throw new Error('cloudflare_runtime_endpoint_not_configured');
      if (!secretStore || typeof secretStore.putSecret !== 'function') throw new Error('secret_store_putSecret_required');
      if (!validCredentialId(credential_id)) throw new Error('credential_id_invalid');
      if (!TOKEN_PROFILES[profileName]) throw new Error('cloudflare_token_profile_invalid');

      const endpoint = `${workerUrl.replace(/\/$/, '')}/admin/cloudflare/token`;
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${runtimeSecret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ template: profileName === 'worker_runtime' ? 'worker_runtime' : 'worker_readonly' })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || `cloudflare_token_issue_${response.status}`);
      if (typeof payload.value !== 'string' || payload.value.length < 40) throw new Error('cloudflare_token_value_missing');

      const secretRef = `secret://cloudflare/${credential_id}`;
      await secretStore.putSecret(secretRef, payload.value, {
        state: 'configured',
        provider: 'cloudflare',
        credential_id,
        token_id: payload.token_id ?? null,
        name: payload.name ?? null,
        expires_at: payload.expires_on ?? null
      });
      return { ok: true, secret_ref: secretRef, token_id: payload.token_id ?? null, expires_at: payload.expires_on ?? null };
    }
  });
}

module.exports = { createCloudflareRuntimeAdapter };
