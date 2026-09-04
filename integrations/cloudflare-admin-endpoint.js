'use strict';

const API_BASE = 'https://api.cloudflare.com/client/v4';

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

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function safeResult(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return {
    success: payload.success === true,
    result: payload.result ?? null,
    errors: Array.isArray(payload.errors)
      ? payload.errors.map(error => ({ code: error?.code ?? null, message: error?.message ?? 'unknown' }))
      : []
  };
}

function createCloudflareAdminEndpoint({
  apiTokenEnv = 'CLOUDFLARE_API_TOKEN',
  accountIdEnv = 'CLOUDFLARE_ACCOUNT_ID',
  runtimeSecretEnv = 'ARIA_RUNTIME_SHARED_SECRET',
  scriptName = 'aria',
  fetchImpl = globalThis.fetch
} = {}) {
  return async function cloudflareAdmin(request, env) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

    const expected = env?.[runtimeSecretEnv];
    const token = env?.[apiTokenEnv];
    const accountId = env?.[accountIdEnv];
    const incoming = bearer(request);

    if (!expected || !token || !accountId) {
      return json({ error: 'cloudflare_admin_not_configured' }, 500);
    }
    if (!incoming || !constantTimeEqual(incoming, expected)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const url = new URL(request.url);
    const operation = url.searchParams.get('operation') || 'deployments';
    const base = `${API_BASE}/accounts/${encodeURIComponent(accountId)}`;
    const script = encodeURIComponent(scriptName);

    const routes = {
      worker: `${base}/workers/workers/${script}`,
      deployments: `${base}/workers/scripts/${script}/deployments`,
      content: `${base}/workers/scripts/${script}/content/v2`,
      settings: `${base}/workers/scripts/${script}/script-settings`
    };

    const target = routes[operation];
    if (!target) return json({ error: 'unsupported_operation' }, 400);

    try {
      const response = await fetchImpl(target, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` }
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = null; }

      if (!response.ok) {
        return json({
          error: 'cloudflare_api_error',
          status: response.status,
          ...safeResult(payload)
        }, response.status);
      }

      return json({ operation, ...safeResult(payload) }, 200);
    } catch (_) {
      return json({ error: 'cloudflare_network_error' }, 502);
    }
  };
}

module.exports = Object.freeze({ createCloudflareAdminEndpoint });
