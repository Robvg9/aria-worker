'use strict';

const API_BASE = 'https://api.cloudflare.com/client/v4';

const TOKEN_PROFILES = Object.freeze({
  worker_runtime: Object.freeze({
    name: 'ARIA Worker Runtime',
    permission_groups: ['Workers Scripts Read', 'Workers Scripts Write'],
    resource_scope: 'account'
  }),
  worker_readonly: Object.freeze({
    name: 'ARIA Worker Readonly',
    permission_groups: ['Workers Scripts Read'],
    resource_scope: 'account'
  })
});

function jsonBody(responseText) {
  try { return responseText ? JSON.parse(responseText) : null; } catch { return null; }
}

async function request(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  const payload = jsonBody(text);
  if (!response.ok || payload?.success !== true) {
    const detail = Array.isArray(payload?.errors) ? payload.errors.map(e => e?.message).filter(Boolean).join('; ') : '';
    throw new Error(`cloudflare_api_${response.status}${detail ? `:${detail}` : ''}`);
  }
  return payload;
}

function profile(name) {
  return TOKEN_PROFILES[name] || null;
}

async function resolvePermissionGroups(fetchImpl, token, accountId, names) {
  const url = `${API_BASE}/accounts/${encodeURIComponent(accountId)}/tokens/permission_groups?per_page=50`;
  const payload = await request(fetchImpl, url, {
    method: 'GET',
    headers: { authorization: `Bearer ${token}` }
  });
  const groups = Array.isArray(payload.result) ? payload.result : [];
  const byName = new Map(groups.map(group => [group?.name, group]));
  const resolved = names.map(name => byName.get(name)).filter(Boolean);
  const missing = names.filter(name => !byName.has(name));
  if (missing.length) throw new Error(`cloudflare_permission_groups_missing:${missing.join(',')}`);
  return resolved.map(group => ({ id: group.id, name: group.name }));
}

async function createAccountToken({ token, accountId, profileName, fetchImpl = globalThis.fetch, expiresOn = null }) {
  if (typeof token !== 'string' || !token) throw new Error('cloudflare_bootstrap_token_missing');
  if (typeof accountId !== 'string' || !accountId) throw new Error('cloudflare_account_id_missing');
  const selected = profile(profileName);
  if (!selected) throw new Error('cloudflare_token_profile_invalid');

  const permissionGroups = await resolvePermissionGroups(fetchImpl, token, accountId, selected.permission_groups);
  const body = {
    name: selected.name,
    policies: [{
      effect: 'allow',
      permission_groups: permissionGroups,
      resources: { [`com.cloudflare.api.account.${accountId}`]: '*' }
    }]
  };
  if (expiresOn) body.expires_on = expiresOn;

  const payload = await request(fetchImpl, `${API_BASE}/accounts/${encodeURIComponent(accountId)}/tokens`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const value = payload?.result?.value;
  if (typeof value !== 'string' || !value) throw new Error('cloudflare_token_value_missing');

  return {
    token_id: payload.result.id ?? null,
    token_value: value,
    expires_on: payload.result.expires_on ?? expiresOn,
    profile: profileName,
    permissions: permissionGroups.map(group => group.name)
  };
}

module.exports = Object.freeze({ TOKEN_PROFILES, resolvePermissionGroups, createAccountToken });
