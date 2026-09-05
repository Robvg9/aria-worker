'use strict';

function validRef(value) {
  return typeof value === 'string' && /^secret:\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/.test(value.trim());
}

function createCredentialProviderManager({ providers = {}, audit = null } = {}) {
  function provider(name) {
    const adapter = providers[name];
    if (!adapter) throw new Error('credential_provider_not_found');
    return adapter;
  }

  async function issue({ providerName, credential_id, profileName } = {}) {
    const adapter = provider(providerName);
    if (typeof adapter.issue !== 'function') throw new Error('credential_issue_not_supported');
    const result = await adapter.issue({ credential_id, profileName });
    if (!result || result.ok !== true) throw new Error('credential_issue_failed');
    if (!validRef(result.secret_ref)) throw new Error('credential_secret_ref_missing');
    const safe = {
      ok: true,
      provider: providerName,
      credential_id,
      secret_ref: result.secret_ref,
      token_id: result.token_id ?? null,
      expires_at: result.expires_at ?? null
    };
    if (typeof audit === 'function') {
      await audit({ event: 'credential_issued', provider: providerName, credential_id, token_id: safe.token_id, expires_at: safe.expires_at });
    }
    return safe;
  }

  return Object.freeze({ issue, provider });
}

module.exports = { createCredentialProviderManager };
