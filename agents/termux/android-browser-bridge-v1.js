'use strict';

const DEFAULT_BRIDGE_BASE = 'http://127.0.0.1:43817';

function parseJob(command) {
  let payload;
  try { payload = JSON.parse(command); } catch { throw new Error('android browser bridge payload invalid'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('android browser bridge payload invalid');
  }
  const operation = payload.operation || 'action';
  if (operation !== 'observe' && operation !== 'action') {
    throw new Error('android browser bridge operation unsupported');
  }
  return payload;
}

function secretRefFromPayload(payload) {
  const ref = payload?.secret_ref;
  if (ref === undefined) return null;
  if (typeof ref !== 'string' || !/^secret:\/\/rwht\/[A-Za-z0-9._:-]+$/.test(ref)) {
    throw new Error('android browser bridge secret_ref invalid');
  }
  return ref;
}

async function requestLocalBridge({ baseUrl = DEFAULT_BRIDGE_BASE, operation, action, fetchImpl = fetch }) {
  const base = String(baseUrl).replace(/\/$/, '');
  const response = operation === 'observe'
    ? await fetchImpl(base + '/v1/observe', { method: 'GET', headers: { 'cache-control': 'no-store' } })
    : await fetchImpl(base + '/v1/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        body: JSON.stringify(action)
      });

  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }

  if (!response.ok) {
    return {
      status: 'failed',
      reason: body?.error || body?.reason || 'android_bridge_http_error',
      http_status: response.status
    };
  }
  return {
    status: body?.ok === false ? 'failed' : 'succeeded',
    payload: body,
    http_status: response.status
  };
}

async function executeAndroidBrowserJob({
  command,
  fetchImpl = fetch,
  resolveSecret,
  baseUrl = DEFAULT_BRIDGE_BASE
}) {
  const payload = parseJob(command);
  const secretRef = secretRefFromPayload(payload);

  if (payload.operation === 'observe') {
    if (secretRef) throw new Error('secret_ref_not_allowed_for_observe');
    return requestLocalBridge({ baseUrl, operation: 'observe', fetchImpl });
  }

  if (!payload.action || typeof payload.action !== 'object') {
    throw new Error('android browser bridge action required');
  }

  const action = { ...payload.action };
  if (secretRef) {
    if (action.action !== 'type') throw new Error('secret_ref_requires_type');
    if (typeof resolveSecret !== 'function') throw new Error('secure_secret_resolver_required');
    const secret = await resolveSecret(secretRef);
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new Error('credential_unavailable');
    }
    action.text = secret;
  }

  const result = await requestLocalBridge({
    baseUrl,
    operation: 'action',
    action,
    fetchImpl
  });

  return result;
}

module.exports = Object.freeze({
  parseJob,
  secretRefFromPayload,
  requestLocalBridge,
  executeAndroidBrowserJob
});
