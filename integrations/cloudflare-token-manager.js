'use strict';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const TEMPLATES = Object.freeze({
  worker_deploy: Object.freeze({
    permission_names: ['Workers Scripts Write']
  }),
  worker_read: Object.freeze({
    permission_names: ['Workers Scripts Read']
  })
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function bearer(request) {
  const value = request.headers.get('authorization');
  const match = value && value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

async function readJson(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

async function lookupPermissionGroups(token, accountId, names, fetchImpl) {
  const params = new URLSearchParams();
  params.set('per_page', '50');
  const response = await fetchImpl(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/tokens/permission_groups?${params}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const payload = await readJson(response);
  if (!response.ok) throw new Error(`cloudflare_permission_groups_${response.status}`);
  const groups = Array.isArray(payload?.result) ? payload.result : [];
  return names.map((name) => {
    const group = groups.find((candidate) => candidate?.name === name);
    if (!group?.id) throw new Error(`cloudflare_permission_group_not_found:${name}`);
    return { id: group.id, name };
  });
}

function sanitizeTokenName(name) {
  const value = String(name || '').trim();
  if (!value || value.length > 100) throw new Error('cloudflare_token_name_invalid');
  return value;
}

function templatePolicy(permissionGroups, accountId) {
  return [{
    effect: 'allow',
    permission_groups: permissionGroups,
    resources: {
      [`com.cloudflare.api.account.${accountId}`]: '*'
    }
  }];
}

function createCloudflareTokenManager({
  apiTokenEnv = 'CLOUDFLARE_API_TOKEN',
  accountIdEnv = 'CLOUDFLARE_ACCOUNT_ID',
  runtimeSecretEnv = 'ARIA_RUNTIME_SHARED_SECRET',
  fetchImpl = globalThis.fetch
} = {}) {
  return async function cloudflareTokenManager(request, env) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const expected = env?.[runtimeSecretEnv];
    const rootToken = env?.[apiTokenEnv];
    const accountId = env?.[accountIdEnv];
    const incoming = bearer(request);

    if (!expected || !rootToken || !accountId) {
      return json({ error: 'cloudflare_token_manager_not_configured' }, 500);
    }
    if (!incoming || !constantTimeEqual(incoming, expected)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const template = typeof body?.template === 'string' ? body.template : '';
    const definition = TEMPLATES[template];
    if (!definition) {
      return json({
        error: 'unsupported_token_template',
        allowed_templates: Object.keys(TEMPLATES)
      }, 400);
    }

    let name;
    try {
      name = sanitizeTokenName(body?.name || `ARIA ${template}`);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'cloudflare_token_name_invalid' }, 400);
    }

    try {
      const permissionGroups = await lookupPermissionGroups(
        rootToken,
        accountId,
        definition.permission_names,
        fetchImpl
      );
      const expiresOn = typeof body?.expires_on === 'string' ? body.expires_on : undefined;
      const requestBody = {
        name,
        policies: templatePolicy(permissionGroups, accountId),
        ...(expiresOn ? { expires_on: expiresOn } : {})
      };

      const response = await fetchImpl(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/tokens`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${rootToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      const payload = await readJson(response);
      if (!response.ok || payload?.success !== true) {
        return json({
          error: 'cloudflare_token_create_failed',
          status: response.status,
          errors: Array.isArray(payload?.errors) ? payload.errors.map((e) => ({ code: e?.code ?? null, message: e?.message ?? 'unknown' })) : []
        }, response.status || 502);
      }

      const value = payload?.result?.value;
      if (typeof value !== 'string' || value.length < 40) {
        return json({ error: 'cloudflare_token_value_missing' }, 502);
      }

      return json({
        ok: true,
        credential_type: 'cloudflare_account_api_token',
        token_id: payload?.result?.id ?? null,
        name: payload?.result?.name ?? name,
        expires_on: payload?.result?.expires_on ?? null,
        // The plaintext is returned only to the authenticated ARIA runtime so it can be written directly to Vault.
        value
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'cloudflare_token_manager_error' }, 502);
    }
  };
}

module.exports = Object.freeze({ createCloudflareTokenManager });
