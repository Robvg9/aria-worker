'use strict';

const crypto = require('node:crypto');

const PACKAGE = 'com.robvg9.ariauiagent.debug';
const IPC_TOKEN = '4fa3c34b8093d0ac3633fd58ade90bc224827f2a7b21cf29f26931c637e34d76';
const LOCAL_IPC_URL = 'http://127.0.0.1:45874/execute';
const SECRET_REF_PATTERN = /^secret:\/\/rwht\/[A-Za-z0-9._:-]+$/;

async function executeLocalIpcJob({ request, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const effectiveTimeout = Math.max(1000, Math.min(Number(timeoutMs) || 12000, 30000));
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const response = await fetch(LOCAL_IPC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${IPC_TOKEN}`,
        connection: 'close'
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) {}
    if (!response.ok) {
      return {
        status: 'failed',
        reason: payload?.reason || `android_local_ipc_http_${response.status}`,
        metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL }
      };
    }
    if (!payload || typeof payload !== 'object') {
      return {
        status: 'failed',
        reason: 'android_local_ipc_invalid_response',
        metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL }
      };
    }
    if (payload.ok !== true) {
      return {
        status: 'failed',
        reason: payload.reason || 'android_action_failed',
        payload,
        metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL }
      };
    }
    return {
      status: 'succeeded',
      payload,
      metadata: {
        transport: 'android-local-http',
        url: LOCAL_IPC_URL,
        request_id: request.request_id || null,
        evidence_hash: payload.evidence_hash || null
      }
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {
        status: 'timeout',
        reason: `android_local_ipc_timeout_${effectiveTimeout}ms`,
        metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL }
      };
    }
    return {
      status: 'failed',
      reason: `android_local_ipc_unreachable:${String(error?.message || error).slice(0, 180)}`,
      metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL }
    };
  } finally {
    clearTimeout(timer);
  }
}

async function executeAndroidAccessibilityJob({ command, timeoutMs = 12000, resolveSecret } = {}) {
  let payload;
  try { payload = JSON.parse(String(command || '{}')); }
  catch { throw new Error('android accessibility payload invalid'); }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('android accessibility payload invalid');
  }

  const request = { ...payload, request_id: crypto.randomUUID() };
  const secretRef = request.secret_ref;
  if (secretRef !== undefined) {
    if (typeof secretRef !== 'string' || !SECRET_REF_PATTERN.test(secretRef)) {
      throw new Error('android_accessibility_secret_ref_invalid');
    }
    if (typeof resolveSecret !== 'function') {
      throw new Error('android_accessibility_secret_resolver_required');
    }
    const secret = await resolveSecret(secretRef);
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new Error('android_accessibility_credential_unavailable');
    }
    if (!request.action || typeof request.action !== 'object' || request.action.action !== 'type') {
      throw new Error('android_accessibility_secret_ref_requires_type');
    }
    request.action = { ...request.action, text: secret };
    delete request.secret_ref;
  }

  return executeLocalIpcJob({ request, timeoutMs });
}

module.exports = Object.freeze({
  PACKAGE,
  LOCAL_IPC_URL,
  executeAndroidAccessibilityJob
});
