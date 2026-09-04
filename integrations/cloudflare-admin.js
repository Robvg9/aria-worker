'use strict';

const API_BASE = 'https://api.cloudflare.com/client/v4';

function fail(message, code = 'cloudflare_invalid_request') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} required`);
  return value.trim();
}

function encode(value) {
  return encodeURIComponent(requireText(value, 'identifier'));
}

function createCloudflareAdminClient({ token, accountId, fetchImpl = globalThis.fetch, apiBase = API_BASE } = {}) {
  if (typeof token !== 'string' || token.length === 0) throw new TypeError('token required');
  if (typeof accountId !== 'string' || accountId.length === 0) throw new TypeError('accountId required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl required');

  async function request(path, { method = 'GET', body = undefined, contentType = 'application/json' } = {}) {
    const headers = new Headers({ authorization: `Bearer ${token}` });
    if (body !== undefined && contentType) headers.set('content-type', contentType);

    let response;
    try {
      response = await fetchImpl(`${apiBase}${path}`, { method, headers, body });
    } catch (_) {
      fail('cloudflare_network_error', 'cloudflare_network_error');
    }

    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = null; }

    if (!response.ok || payload?.success === false) {
      const error = new Error(`Cloudflare API request failed: ${response.status}`);
      error.code = 'cloudflare_api_error';
      error.status = response.status;
      error.errors = Array.isArray(payload?.errors) ? payload.errors.map(e => ({ code: e.code ?? null, message: e.message ?? 'unknown' })) : [];
      throw error;
    }

    return payload;
  }

  return Object.freeze({
    async getScriptContent(scriptName) {
      const path = `/accounts/${encode(accountId)}/workers/scripts/${encode(scriptName)}/content/v2`;
      return request(path);
    },

    async listDeployments(scriptName) {
      const path = `/accounts/${encode(accountId)}/workers/scripts/${encode(scriptName)}/deployments`;
      return request(path);
    },

    async getWorker(scriptName) {
      const path = `/accounts/${encode(accountId)}/workers/workers/${encode(scriptName)}`;
      return request(path);
    },

    async getScriptSettings(scriptName) {
      const path = `/accounts/${encode(accountId)}/workers/scripts/${encode(scriptName)}/script-settings`;
      return request(path);
    }
  });
}

module.exports = Object.freeze({ API_BASE, createCloudflareAdminClient });
