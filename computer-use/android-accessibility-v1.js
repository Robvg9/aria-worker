'use strict';

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PACKAGE = 'com.robvg9.ariauiagent.debug'; // Backward-compatible export; local HTTP does not depend on APK package id.
const IPC_TOKEN = '4fa3c34b8093d0ac3633fd58ade90bc224827f2a7b21cf29f26931c637e34d76';
const LOCAL_IPC_URL = 'http://127.0.0.1:45874/execute';
const LOCAL_IPC_HEALTH_URL = 'http://127.0.0.1:45874/health';
const SECRET_REF_PATTERN = /^secret:\/\/rwht\/[A-Za-z0-9._:-]+$/;
const REQUIRED_IPC_PROTOCOL = 'aria-android-ui-agent-ipc-v2';
const ANDROID_UID_PER_USER = 100000;

function localAndroidUserId() {
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    return Number.isInteger(uid) ? Math.floor(uid / ANDROID_UID_PER_USER) : null;
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function executeAndroidCommandReceiver({ request, timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
    const started = Date.now();
    const child = spawn('am', [
      'broadcast', '--user', '0',
      '-a', 'com.robvg9.ariauiagent.ACTION_EXECUTE',
      '-n', \`\${PACKAGE}/.CommandReceiver\`,
      '--es', 'payload_b64', encoded,
      '--es', 'ipc_token', IPC_TOKEN
    ], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({
        status: 'timeout',
        reason: \`android_command_receiver_timeout_\${Math.max(1000, Number(timeoutMs) || 8000)}ms\`,
        metadata: { transport: 'android-command-receiver' }
      });
    }, Math.max(1000, Number(timeoutMs) || 8000));
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => finish({
      status: 'failed',
      reason: \`android_command_receiver_unreachable:\${String(error?.message || error).slice(0, 180)}\`,
      metadata: { transport: 'android-command-receiver', duration_ms: Date.now() - started }
    }));
    child.on('close', code => {
      const match = stdout.match(/data="([A-Za-z0-9+/=]+)"/);
      let payload = null;
      if (match) {
        try { payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); } catch (_) {}
      }
      if (!payload || typeof payload !== 'object') {
        finish({
          status: 'failed',
          reason: code === 0 ? 'android_command_receiver_invalid_response' : 'android_command_receiver_failed',
          metadata: { transport: 'android-command-receiver', exit_code: code, stderr: stderr.slice(-1000), duration_ms: Date.now() - started }
        });
        return;
      }
      if (payload.ok === true) {
        finish({
          status: 'succeeded',
          payload,
          metadata: { transport: 'android-command-receiver', request_id: request.request_id || null, evidence_hash: payload.evidence_hash || null, exit_code: code, duration_ms: Date.now() - started }
        });
        return;
      }
      finish({
        status: 'failed',
        reason: payload.reason || 'android_command_receiver_action_failed',
        payload,
        metadata: { transport: 'android-command-receiver', exit_code: code, duration_ms: Date.now() - started }
      });
    });
  });
}

async function probeAndroidCommandReceiver({ timeoutMs = 3000 } = {}) {
  const result = await executeAndroidCommandReceiver({ request: { operation: '__aria_probe__' }, timeoutMs });
  const serviceAlive = result.status === 'succeeded' || result.reason === 'operation_unsupported';
  return {
    ok: serviceAlive,
    reason: serviceAlive ? 'android_command_receiver_ready' : (result.reason || 'android_command_receiver_unavailable'),
    payload: result.payload || null,
    metadata: { ...(result.metadata || {}), transport: 'android-command-receiver' }
  };
}


async function probeLocalIpcHealth({ timeoutMs = 1500 } = {}) {
  const controller = new AbortController();
  const effectiveTimeout = Math.max(300, Math.min(Number(timeoutMs) || 1500, 5000));
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const response = await fetch(LOCAL_IPC_HEALTH_URL, {
      method: 'GET',
      headers: {
        authorization: 'Bearer ' + IPC_TOKEN,
        connection: 'close'
      },
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) {}
    if (!response.ok || !payload || payload.ok !== true) {
      return {
        ok: false,
        reason: payload?.reason || 'android_local_ipc_health_unhealthy',
        status: response.status,
        metadata: { transport: 'android-local-http', url: LOCAL_IPC_HEALTH_URL }
      };
    }
    if (payload.protocol !== REQUIRED_IPC_PROTOCOL) {
      return {
        ok: false,
        reason: 'android_local_ipc_protocol_mismatch',
        status: response.status,
        metadata: {
          transport: 'android-local-http',
          url: LOCAL_IPC_HEALTH_URL,
          expected_protocol: REQUIRED_IPC_PROTOCOL,
          actual_protocol: payload.protocol || null,
          version_name: payload.version_name || null,
          version_code: payload.version_code || null,
          build_id: payload.build_id || null
        }
      };
    }
    const localUserId = localAndroidUserId();
    const remoteUserId = Number.isInteger(Number(payload.user_id)) ? Number(payload.user_id) : null;
    return {
      ok: true,
      status: response.status,
      payload,
      metadata: {
        transport: 'android-local-http',
        url: LOCAL_IPC_HEALTH_URL,
        local_user_id: localUserId,
        remote_user_id: remoteUserId,
        cross_profile_loopback: localUserId !== null && remoteUserId !== null && localUserId !== remoteUserId,
        version_name: payload.version_name || null,
        version_code: payload.version_code || null,
        build_id: payload.build_id || null
      }
    };
  } catch (error) {
    return {
      ok: false,
      reason: error?.name === 'AbortError'
        ? `android_local_ipc_health_timeout_${effectiveTimeout}ms`
        : `android_local_ipc_health_unreachable:${String(error?.message || error).slice(0, 180)}`,
      metadata: { transport: 'android-local-http', url: LOCAL_IPC_HEALTH_URL }
    };
  } finally {
    clearTimeout(timer);
  }
}

async function executeLocalIpcJob({ request, timeoutMs = 12000 } = {}) {
  const effectiveTimeout = Math.max(1000, Math.min(Number(timeoutMs) || 12000, 30000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const response = await fetch(LOCAL_IPC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: \`Bearer \${IPC_TOKEN}\`,
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
        reason: payload?.reason || \`android_local_ipc_http_\${response.status}\`,
        metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL }
      };
    }
    if (!payload || typeof payload !== 'object') {
      return { status: 'failed', reason: 'android_local_ipc_invalid_response', metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL } };
    }
    if (payload.ok !== true) {
      return { status: 'failed', reason: payload.reason || 'android_action_failed', payload, metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL } };
    }
    return {
      status: 'succeeded',
      payload,
      metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL, request_id: request.request_id || null, evidence_hash: payload.evidence_hash || null }
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { status: 'timeout', reason: \`android_local_ipc_timeout_\${effectiveTimeout}ms\`, metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL } };
    }
    const fallback = await executeAndroidCommandReceiver({ request, timeoutMs: Math.min(effectiveTimeout, 8000) });
    if (fallback.status === 'succeeded') {
      return { ...fallback, metadata: { ...(fallback.metadata || {}), fallback_from: 'android-local-http' } };
    }
    return {
      status: 'failed',
      reason: \`android_local_ipc_unreachable:\${String(error?.message || error).slice(0, 180)}\`,
      metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL, fallback_transport: 'android-command-receiver', fallback_reason: fallback.reason || null }
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
  LOCAL_IPC_HEALTH_URL,
  probeLocalIpcHealth,
  executeAndroidAccessibilityJob,
  executeAndroidCommandReceiver,
  probeAndroidCommandReceiver
});
