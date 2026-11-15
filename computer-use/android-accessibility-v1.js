'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/**
 * Resolve Termux's app-compatible am wrapper before the Android system binary.
 * /system/bin/am identifies its caller as com.android.shell and fails from the
 * Termux app UID on modern Android. Termux ships its own app-UID-compatible
 * implementation at $PREFIX/bin/am.
 */
function resolveAndroidAmPath(env = process.env, existsSync = fs.existsSync) {
  const prefixes = [
    env.PREFIX,
    env.TERMUX__PREFIX,
    '/data/data/com.termux/files/usr'
  ].filter((value, index, values) =>
    typeof value === 'string' && value.length > 0 && values.indexOf(value) === index
  );
  for (const prefix of prefixes) {
    const candidate = path.join(prefix, 'bin', 'am');
    try {
      if (existsSync(candidate)) return candidate;
    } catch (_) {}
  }
  return 'am';
}

const PACKAGE = 'com.robvg9.aria.unified';
const RECEIVER_COMPONENT = 'com.robvg9.ariauiagent.CommandReceiver';
const LOCAL_IPC_URL = 'http://127.0.0.1:45874/execute';
const LOCAL_IPC_HEALTH_URL = 'http://127.0.0.1:45874/health';
const SECRET_REF_PATTERN = /^secret:\/\/rwht\/[A-Za-z0-9._:-]+$/;
const REQUIRED_IPC_PROTOCOL = 'aria-android-ui-agent-ipc-v2';
const ANDROID_UID_PER_USER = 100000;
const IPC_TOKEN_ENV = 'ARIA_IPC_TOKEN';
const IPC_TOKEN_FILE_ENV = 'ARIA_IPC_TOKEN_FILE';
const IPC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function resolveIpcTokenFile(env = process.env) {
  const override = typeof env[IPC_TOKEN_FILE_ENV] === 'string' ? env[IPC_TOKEN_FILE_ENV].trim() : '';
  if (override) return override;
  const home = env.HOME || env.TERMUX__HOME || '/data/data/com.termux/files/home';
  return path.join(home, '.aria', 'ipc-token');
}

/**
 * Per-install credential paired by the owner in ARIA > Misión local.
 * There is intentionally no embedded fallback: without a credential the
 * bridge stays closed. The file is re-read per call so rotation does not
 * require restarting the Termux agent.
 */
function loadIpcToken(env = process.env, readFileSync = fs.readFileSync) {
  const inline = typeof env[IPC_TOKEN_ENV] === 'string' ? env[IPC_TOKEN_ENV].trim() : '';
  if (inline) return IPC_TOKEN_PATTERN.test(inline) ? inline : null;
  try {
    const fromFile = String(readFileSync(resolveIpcTokenFile(env), 'utf8')).trim();
    return IPC_TOKEN_PATTERN.test(fromFile) ? fromFile : null;
  } catch (_) {
    return null;
  }
}

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

function isBroadcastSentWithoutResult(output) {
  return /Broadcast sent without waiting for result/i.test(String(output || ''));
}
function executeAndroidCommandReceiver({ request, timeoutMs = 8000 } = {}) {
  const userId = localAndroidUserId();
  if (!Number.isInteger(userId) || userId < 0) {
    return Promise.resolve({
      status: 'failed',
      reason: 'android_command_receiver_user_unknown',
      metadata: { transport: 'android-command-receiver' }
    });
  }
  const token = loadIpcToken();
  if (!token) {
    return Promise.resolve({
      status: 'failed',
      reason: 'android_ipc_credential_missing',
      metadata: { transport: 'android-command-receiver' }
    });
  }
  return new Promise((resolve) => {
    const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');
    const started = Date.now();
    // Use the caller's own Android user/profile. Omitting --user selects USER_CURRENT
    // (-2), which an app UID such as Termux cannot send for on Android 16.
    const child = spawn(resolveAndroidAmPath(), [
      'broadcast', '--user', String(userId),
      '-a', 'com.robvg9.ariauiagent.ACTION_EXECUTE',
      '-n', `${PACKAGE}/${RECEIVER_COMPONENT}`,
      '--es', 'payload_b64', encoded,
      '--es', 'ipc_token', token
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
        reason: `android_command_receiver_timeout_${Math.max(1000, Number(timeoutMs) || 8000)}ms`,
        metadata: { transport: 'android-command-receiver' }
      });
    }, Math.max(1000, Number(timeoutMs) || 8000));
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => finish({
      status: 'failed',
      reason: `android_command_receiver_unreachable:${String(error?.message || error).slice(0, 180)}`,
      metadata: { transport: 'android-command-receiver', duration_ms: Date.now() - started }
    }));
    child.on('close', code => {
      const match = stdout.match(/data="([A-Za-z0-9+/=]+)"/);
      let payload = null;
      if (match) {
        try { payload = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')); } catch (_) {}
      }
      if (!payload || typeof payload !== 'object') {
        if (isBroadcastSentWithoutResult(stdout)) {
          finish({
            status: 'failed',
            reason: 'android_command_receiver_result_unavailable_api34',
            metadata: {
              transport: 'android-command-receiver',
              delivery_status: 'submitted_unverified',
              receiver_acknowledgement: 'unavailable_on_android_14_plus',
              do_not_retry: true,
              request_id: request.request_id || null,
              exit_code: code,
              user_id: userId,
              duration_ms: Date.now() - started
            }
          });
          return;
        }
        finish({
          status: 'failed',
          reason: code === 0 ? 'android_command_receiver_invalid_response' : 'android_command_receiver_failed',
          metadata: { transport: 'android-command-receiver', exit_code: code, user_id: userId, stderr: stderr.slice(0, 1000), stdout: stdout.replace(/data="[A-Za-z0-9+/=]+"/g, 'data="[redacted]"').replace(new RegExp(token, 'g'), '[redacted]').slice(0, 1000), duration_ms: Date.now() - started }
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
  const result = await executeAndroidCommandReceiver({
    request: { operation: 'action', action: { action: 'wait', ms: 0 } },
    timeoutMs
  });
  const serviceAlive = result.status === 'succeeded';
  return {
    ok: serviceAlive,
    reason: serviceAlive ? 'android_command_receiver_ready' : (result.reason || 'android_command_receiver_unavailable'),
    payload: result.payload || null,
    metadata: { ...(result.metadata || {}), transport: 'android-command-receiver' }
  };
}


async function probeLocalIpcHealth({ timeoutMs = 1500 } = {}) {
  const token = loadIpcToken();
  if (!token) {
    return {
      ok: false,
      reason: 'android_ipc_credential_missing',
      metadata: { transport: 'android-local-http', url: LOCAL_IPC_HEALTH_URL }
    };
  }
  const controller = new AbortController();
  const effectiveTimeout = Math.max(300, Math.min(Number(timeoutMs) || 1500, 5000));
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const response = await fetch(LOCAL_IPC_HEALTH_URL, {
      method: 'GET',
      headers: {
        authorization: 'Bearer ' + token,
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
    if (payload.package !== PACKAGE) {
      return {
        ok: false,
        reason: 'android_local_ipc_package_mismatch',
        status: response.status,
        metadata: {
          transport: 'android-local-http',
          url: LOCAL_IPC_HEALTH_URL,
          expected_package: PACKAGE,
          actual_package: payload.package || null,
          version_name: payload.version_name || null,
          version_code: payload.version_code || null,
          build_id: payload.build_id || null
        }
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
  const token = loadIpcToken();
  if (!token) {
    return {
      status: 'failed',
      reason: 'android_ipc_credential_missing',
      metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL, do_not_retry: true }
    };
  }
  // OBSERVE is read-only. ACTION requests are at-most-once: once HTTP dispatch
  // starts, a timeout or identity/observation gap is ambiguous and must never
  // trigger a second transport that could repeat a click/type/navigation.
  const readOnly = request?.operation === 'observe';
  const effectiveTimeout = Math.max(1000, Math.min(Number(timeoutMs) || 12000, 30000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    const response = await fetch(LOCAL_IPC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
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
      return { status: 'failed', reason: 'android_local_ipc_invalid_response', metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL } };
    }
    if (payload.ok !== true) {
      const responseReason = payload.reason || 'android_action_failed';
      if (!readOnly && responseReason === 'post_action_window_missing') {
        return {
          status: 'submitted_unverified',
          reason: 'android_action_post_observation_unavailable',
          payload,
          metadata: {
            transport: 'android-local-http',
            url: LOCAL_IPC_URL,
            delivery_status: 'submitted_unverified',
            do_not_retry: true,
            request_id: request.request_id || null,
            response_reason: responseReason
          }
        };
      }
      return {
        status: 'failed',
        reason: responseReason,
        payload,
        metadata: {
          transport: 'android-local-http',
          url: LOCAL_IPC_URL,
          do_not_retry: !readOnly,
          delivery_status: 'response_received',
          request_id: request.request_id || null
        }
      };
    }
    if (payload.service_package !== PACKAGE) {
      // The remote side returned success, so the action may already have run.
      // Never replay it through CommandReceiver merely because its identity is
      // missing or mismatched; stop with an explicit unverified-delivery gate.
      return {
        status: 'submitted_unverified',
        reason: 'android_local_ipc_service_identity_unverified',
        payload,
        metadata: {
          transport: 'android-local-http',
          url: LOCAL_IPC_URL,
          delivery_status: 'submitted_unverified',
          do_not_retry: true,
          request_id: request.request_id || null,
          expected_package: PACKAGE,
          actual_package: payload.service_package || null
        }
      };
    }
    return {
      status: 'succeeded',
      payload,
      metadata: { transport: 'android-local-http', url: LOCAL_IPC_URL, request_id: request.request_id || null, evidence_hash: payload.evidence_hash || null }
    };
  } catch (error) {
    const httpError = error?.name === 'AbortError' ? 'timeout' : 'connection_error';
    if (readOnly) {
      // OBSERVE is safe to retry over authenticated HTTP. Do not send a
      // Termux broadcast on a transient HTTP failure: Android 14+ cannot
      // return an ordered receiver acknowledgement, which would terminate
      // the retry path as submitted_unverified even though OBSERVE is read-only.
      return {
        status: error?.name === 'AbortError' ? 'timeout' : 'failed',
        reason: error?.name === 'AbortError'
          ? `android_local_ipc_timeout_${effectiveTimeout}ms`
          : `android_local_ipc_unreachable:${String(error?.message || error).slice(0, 180)}`,
        metadata: {
          transport: 'android-local-http',
          url: LOCAL_IPC_URL,
          retryable: true,
          http_error: httpError
        }
      };
    }
    // ACTION may have reached the app before its response was lost. Never
    // retry by broadcast or a second HTTP request: the action may have run.
    return {
      status: 'submitted_unverified',
      reason: 'android_local_ipc_delivery_unverified',
      metadata: {
        transport: 'android-local-http',
        url: LOCAL_IPC_URL,
        delivery_status: 'submitted_unverified',
        do_not_retry: true,
        request_id: request.request_id || null,
        http_error: httpError
      }
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

  const readOnly = request.operation === 'observe';
  let lastResult = null;
  let recoveryAttempted = false;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await executeLocalIpcJob({ request, timeoutMs });
    lastResult = result;
    if (result.status === 'succeeded') {
      return { ...result, metadata: { ...(result.metadata || {}), attempt, recovery_attempted: recoveryAttempted } };
    }
    const reason = String(result.reason || '');
    const windowMissing = /(?:no_active_application_window|post_action_window_missing)/.test(reason);
    // Only repeat read-only OBSERVE. An ACTION may have completed even when
    // its response/post-observation is missing; it must stop for owner review.
    const retryable = readOnly && (/android_local_ipc_(?:unreachable|timeout)/.test(reason) || windowMissing);
    if (!retryable || attempt === 3) {
      return { ...result, metadata: { ...(result.metadata || {}), attempt, recovery_attempted: recoveryAttempted } };
    }
    if (!recoveryAttempted) {
      recoveryAttempted = true;
      if (windowMissing) {
        const receiverRetry = await executeAndroidCommandReceiver({ request, timeoutMs: Math.min(Number(timeoutMs) || 12000, 8000) });
        if (receiverRetry.status === 'succeeded') {
          return { ...receiverRetry, metadata: { ...(receiverRetry.metadata || {}), attempt, recovery_attempted: true, fallback_from: 'android-local-http-window-missing' } };
        }
        if (receiverRetry.metadata?.delivery_status === 'submitted_unverified') {
          return {
            ...receiverRetry,
            metadata: {
              ...(receiverRetry.metadata || {}),
              attempt,
              recovery_attempted: true,
              fallback_from: 'android-local-http-window-missing'
            }
          };
        }
        return {
          status: 'failed',
          reason: 'android_ui_agent_owner_action_required',
          payload: receiverRetry.payload || null,
          metadata: {
            ...(result.metadata || {}),
            transport: 'android-local-http',
            recovery_attempted: true,
            recovery_mode: 'owner_action_required',
            recovery_reason: receiverRetry.reason || 'android_command_receiver_unavailable',
            next_action: 'owner_open_aria_unified_and_verify_accessibility'
          }
        };
      }
      await sleep(100 * attempt);
    } else {
      await sleep(100 * attempt);
    }
  }
  return lastResult;
}

module.exports = Object.freeze({
  resolveAndroidAmPath,
  PACKAGE,
  LOCAL_IPC_URL,
  LOCAL_IPC_HEALTH_URL,
  loadIpcToken,
  resolveIpcTokenFile,
  isBroadcastSentWithoutResult,
  probeLocalIpcHealth,
  executeAndroidAccessibilityJob,
  executeAndroidCommandReceiver,
  probeAndroidCommandReceiver
});
