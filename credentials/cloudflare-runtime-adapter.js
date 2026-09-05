'use strict';

function createCloudflareRuntimeAdapter({
  workerUrl,
  runtimeSecret,
  secretStore,
  fetchImpl = globalThis.fetch
} = {}) {
  return Object.freeze({
    provider: 'cloudflare',
    capabilities: ['token_minting', 'health'],
    bootstrap: () => ({
      human_gate: !runtimeSecret,
      steps: ['store ARIA runtime authentication separately from Cloudflare credential material']
    }),
    async issue({ credential_id, template = 'worker_read', name } = {}) {
      if (!workerUrl || !runtimeSecret) throw new Error('cloudflare_runtime_endpoint_not_configured');
      if (!secretStore || typeof secretStore.putSecret !== 'function') throw new Error('secret_store_putSecret_required');
      if (typeof credential_id !== 'string' || !/^[a-z0-9._:-]+$/i.test(credential_id)) throw new Error('credential_id_invalid');
      if (!['worker_read', 'worker_deploy'].includes(template)) throw new Error('unsupported_token_template');

      const endpoint = `${workerUrl.replace(/\/$/, '')}/admin/cloudflare/token`;
      const body = { template };
      if (name) body.name = String(name);
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${runtimeSecret}`, 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true) throw new Error(payload?.error || `cloudflare_token_issue_${response.status}`);
      if (typeof payload.value !== 'string' || payload.value.length < 40) throw new Error('cloudflare_token_value_missing');

      const secretRef = `secret://cloudflare/${credential_id}`;
      await secretStore.putSecret(secretRef, payload.value, {
        state: 'configured', provider: 'cloudflare', credential_id,
        token_id: payload.token_id ?? null, name: payload.name ?? name ?? null,
        expires_at: payload.expires_on ?? null
      });
      return { ok: true, secret_ref: secretRef, token_id: payload.token_id ?? null, expires_at: payload.expires_on ?? null };
    }
  });
}

module.exports = { createCloudflareRuntimeAdapter };
