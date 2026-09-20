'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const PACKAGE = 'com.robvg9.ariauiagent';
const RECEIVER = '.CommandReceiver';
const ACTION = 'com.robvg9.ariauiagent.ACTION_EXECUTE';
const SECRET_REF_PATTERN = /^secret:\/\/rwht\/[A-Za-z0-9._:-]+$/;
const MAX_OUTPUT = 128 * 1024;

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function parseBroadcastData(stdout) {
  const text = String(stdout || '');
  const match = text.match(/data="([^"]*)"/);
  if (!match) {
    const fallback = text.match(/data=(\S+)/);
    if (!fallback) return { status: 'failed', reason: 'broadcast_result_missing' };
    try {
      return { status: 'succeeded', payload: JSON.parse(Buffer.from(fallback[1], 'base64').toString('utf8')) };
    } catch {
      return { status: 'failed', reason: 'broadcast_result_invalid' };
    }
  }
  try {
    const encoded = match[1].replace(/\\/g, '');
    const json = Buffer.from(encoded, 'base64').toString('utf8');
    return { status: 'succeeded', payload: JSON.parse(json) };
  } catch {
    return { status: 'failed', reason: 'broadcast_result_invalid' };
  }
}

function runCommand(command, timeoutMs = 12000) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn('/data/data/com.termux/files/usr/bin/bash', ['-lc', command], {
      env: process.env
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (current, chunk) => (current + chunk.toString()).slice(-MAX_OUTPUT);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, Math.max(1000, timeoutMs));
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        status: timedOut ? 'timeout' : code === 0 ? 'succeeded' : 'failed',
        exit_code: typeof code === 'number' ? code : null,
        stdout,
        stderr,
        duration_ms: Date.now() - started,
        signal
      });
    });
    child.on('error', error => {
      clearTimeout(timer);
      resolve({
        status: 'failed',
        exit_code: null,
        stdout,
        stderr: String(error.message).slice(0, 4096),
        duration_ms: Date.now() - started
      });
    });
  });
}

async function executeAndroidAccessibilityJob({ command, timeoutMs = 12000, resolveSecret } = {}) {
  let payload;
  try {
    payload = JSON.parse(String(command || '{}'));
  } catch {
    throw new Error('android accessibility payload invalid');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('android accessibility payload invalid');
  }

  const request = { ...payload };
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

  const requestId = crypto.randomUUID();
  request.request_id = requestId;
  const encoded = Buffer.from(JSON.stringify(request), 'utf8').toString('base64');

  const amCommand = [
    '/system/bin/am broadcast',
    '--user', '0',
    '--receiver-foreground',
    '-n', shellQuote(PACKAGE + '/' + RECEIVER),
    '-a', shellQuote(ACTION),
    '--es', 'payload_b64', shellQuote(encoded)
  ].join(' ');

  const result = await runCommand(amCommand, timeoutMs);
  if (result.status !== 'succeeded') {
    return {
      status: result.status,
      reason: result.stderr || 'android_ipc_failed',
      metadata: { transport: 'android-broadcast', package: PACKAGE }
    };
  }

  const parsed = parseBroadcastData(result.stdout);
  if (parsed.status !== 'succeeded') {
    return {
      status: 'failed',
      reason: parsed.reason,
      metadata: { transport: 'android-broadcast', package: PACKAGE }
    };
  }

  const payloadResult = parsed.payload;
  if (!payloadResult || payloadResult.ok !== true) {
    return {
      status: 'failed',
      reason: payloadResult?.reason || payloadResult?.error || 'android_action_failed',
      payload: payloadResult,
      metadata: { transport: 'android-broadcast', package: PACKAGE }
    };
  }

  return {
    status: 'succeeded',
    payload: payloadResult,
    metadata: {
      transport: 'android-broadcast',
      package: PACKAGE,
      request_id: requestId,
      evidence_hash: payloadResult.evidence_hash || null
    }
  };
}

module.exports = Object.freeze({
  PACKAGE,
  RECEIVER,
  ACTION,
  parseBroadcastData,
  executeAndroidAccessibilityJob
});
