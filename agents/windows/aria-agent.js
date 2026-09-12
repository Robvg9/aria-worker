'use strict';

const crypto = require('node:crypto');
const os = require('node:os');
const { parseShellJob, executePowerShell } = require('../../autonomy/windows-shell-executor');

const GATEWAY_URL = process.env.ARIA_DEVICE_GATEWAY_URL;
const DEVICE_TOKEN = process.env.ARIA_DEVICE_TOKEN;
const DEVICE_ID = process.env.ARIA_DEVICE_ID;
const HEARTBEAT_MS = Math.max(10_000, Number(process.env.ARIA_HEARTBEAT_MS || 30_000));
const POLL_MS = Math.max(1_000, Number(process.env.ARIA_POLL_MS || 3_000));
const GATEWAY_TIMEOUT_MS = Math.max(3_000, Number(process.env.ARIA_GATEWAY_TIMEOUT_MS || 15_000));
const GATEWAY_RETRIES = Math.max(0, Number(process.env.ARIA_GATEWAY_RETRIES || 2));
const OLLAMA_URL = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'qwen3:4b';
const OLLAMA_OPERATION = 'ollama.qwen3';
const SHELL_OPERATION = 'shell.execute';
const MAX_OUTPUT = 256 * 1024;
const DISPLAY_OUTPUT = 4096;

function log(message) { console.log(`[ARIA] ${new Date().toISOString()} ${message}`); }
function redact(text) {
  let value = typeof text === 'string' ? text.slice(-DISPLAY_OUTPUT) : '';
  const patterns = [ /Bearer\s+[A-Za-z0-9._\-]+/g, /\bsk-[A-Za-z0-9_\-]{8,}/g, /\bor-v1-[A-Za-z0-9_\-]{8,}/g, /gh[pousr]_[A-Za-z0-9_]{20,}/g, /(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi ];
  for (const pattern of patterns) value = value.replace(pattern, '[redacted]');
  return value;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function normalizeQwenResponse(value) {
  if (typeof value !== 'string') return '';
  const withoutThink = value.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return withoutThink.slice(0, MAX_OUTPUT);
}

if (!GATEWAY_URL || !DEVICE_TOKEN || !DEVICE_ID) {
  console.error('ARIA agent requires ARIA_DEVICE_GATEWAY_URL, ARIA_DEVICE_TOKEN and ARIA_DEVICE_ID');
  process.exit(2);
}

function endpoint(path) { return `${GATEWAY_URL.replace(/\/$/, '')}${path}`; }
function headers() { return { 'content-type': 'application/json', authorization: `Bearer ${DEVICE_TOKEN}`, 'x-aria-device-id': DEVICE_ID }; }

async function api(path, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= GATEWAY_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint(path), { ...options, headers: { ...headers(), ...(options.headers || {}) }, signal: controller.signal });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
      if (response.ok) return body;
      const error = new Error(`gateway ${response.status}: ${body?.error || 'request failed'}`);
      error.status = response.status;
      lastError = error;
      const retryable = response.status === 401 || response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= GATEWAY_RETRIES) throw error;
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'AbortError' || !Number.isInteger(error?.status) || error.status === 401 || error.status === 408 || error.status === 429 || error.status >= 500;
      if (!retryable || attempt >= GATEWAY_RETRIES) throw error;
    } finally {
      clearTimeout(timer);
    }
    await sleep(Math.min(2_000, 500 * (attempt + 1)));
  }
  throw lastError || new Error('gateway_request_failed');
}

function parseQwenPayload(job) {
  if (!job || job.device_id !== DEVICE_ID || job.operation !== OLLAMA_OPERATION) throw new Error('unsupported_job');
  if (typeof job.command !== 'string' || !job.command.trim()) throw new Error('ollama_payload_required');
  let payload;
  try { payload = JSON.parse(job.command); } catch (_) { throw new Error('ollama_payload_invalid_json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('ollama_payload_invalid');
  const keys = Object.keys(payload);
  if (keys.some(key => !['prompt', 'model', 'timeout_ms'].includes(key))) throw new Error('ollama_payload_field_rejected');
  if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) throw new Error('ollama_prompt_required');
  if (payload.model !== undefined && payload.model !== OLLAMA_MODEL) throw new Error('ollama_model_rejected');
  if (payload.timeout_ms !== undefined && (!Number.isInteger(payload.timeout_ms) || payload.timeout_ms < 1000 || payload.timeout_ms > 3_600_000)) throw new Error('ollama_timeout_rejected');
  return { prompt: payload.prompt, model: OLLAMA_MODEL, timeout_ms: payload.timeout_ms ?? job.timeout_ms ?? 120_000 };
}

async function callOllama({ prompt, model, timeout_ms }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeout_ms));
  const started = Date.now();
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`ollama ${response.status}: ${text.slice(0, 1024)}`);
    let body;
    try { body = JSON.parse(text); } catch (_) { throw new Error('ollama_invalid_json'); }
    if (typeof body.response !== 'string') throw new Error('ollama_response_missing');
    return { status: 'succeeded', exit_code: 0, stdout: normalizeQwenResponse(body.response), stderr: '', duration_ms: Date.now() - started, metadata: { raw_response_available: true } };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return { status: aborted ? 'timeout' : 'failed', exit_code: null, stdout: '', stderr: redact(String(error?.message || error).slice(0, 4096)), duration_ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

async function enroll() {
  const body = await api('/v1/devices/enroll', { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID, token: DEVICE_TOKEN }) });
  log(`ENROLLED device=${DEVICE_ID}`);
  return body;
}

async function heartbeat() {
  try {
    await api('/v1/devices/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        device_id: DEVICE_ID,
        agent_type: 'windows-local',
        capabilities: [OLLAMA_OPERATION, SHELL_OPERATION]
      })
    });
    log(`ONLINE device=${DEVICE_ID}`);
  } catch (error) { console.error(`[heartbeat] ${error.message}`); }
}

async function rejectClaimedJob(job, reason, operation = job?.operation) {
  const result = { status: 'failed', exit_code: null, stdout: '', stderr: reason, duration_ms: 0, metadata: { agent_version: 'aria-windows-agent-v2', operation, rejected: true } };
  try {
    await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`, { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID, result }) });
    log(`JOB REJECTED id=${job.job_id} operation=${operation} reason=${reason}`);
  } catch (error) { console.error(`[reject] ${error.message}`); }
}

async function executeShellJob(job) {
  let payload;
  try {
    payload = parseShellJob(job, DEVICE_ID);
  } catch (error) {
    await rejectClaimedJob(job, String(error.message || 'unsupported_shell_job'), SHELL_OPERATION);
    return;
  }

  log(`JOB RECEIVED id=${job.job_id} operation=${SHELL_OPERATION} cwd=${JSON.stringify(payload.cwd)}`);
  await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/start`, { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID }) });
  log(`JOB START id=${job.job_id}`);

  const result = await executePowerShell(payload);
  result.metadata = {
    ...result.metadata,
    agent_version: 'aria-windows-agent-v2',
    platform: `windows/${os.release()}`,
    request_nonce: crypto.randomUUID(),
    operation: SHELL_OPERATION
  };

  log(`JOB RESULT id=${job.job_id} status=${result.status} exit_code=${result.exit_code} duration_ms=${result.duration_ms}`);
  if (result.stdout) log(`STDOUT ${JSON.stringify(redact(result.stdout))}`);
  if (result.stderr) log(`STDERR ${JSON.stringify(redact(result.stderr))}`);

  await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`, { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID, result }) });
  log(`JOB ACK id=${job.job_id} status=${result.status}`);
}

async function executeOllamaJob(job) {
  let payload;
  try { payload = parseQwenPayload(job); }
  catch (error) { await rejectClaimedJob(job, String(error.message || 'unsupported_job'), OLLAMA_OPERATION); return; }
  log(`JOB RECEIVED id=${job.job_id} operation=${OLLAMA_OPERATION}`);
  await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/start`, { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID }) });
  log(`JOB START id=${job.job_id}`);
  const result = await callOllama(payload);
  result.metadata = { ...result.metadata, agent_version: 'aria-windows-agent-v2', platform: `windows/${os.release()}`, request_nonce: crypto.randomUUID(), operation: OLLAMA_OPERATION, ollama_url: OLLAMA_URL, model: OLLAMA_MODEL };
  log(`JOB RESULT id=${job.job_id} status=${result.status} duration_ms=${result.duration_ms}`);
  if (result.stdout) log(`STDOUT ${JSON.stringify(redact(result.stdout))}`);
  if (result.stderr) log(`STDERR ${JSON.stringify(redact(result.stderr))}`);
  await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`, { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID, result }) });
  log(`JOB ACK id=${job.job_id} status=${result.status}`);
}

async function claimAndExecute() {
  try {
    const body = await api('/v1/jobs/claim', { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID }) });
    if (!body?.job) return;
    const job = body.job;
    if (job.device_id !== DEVICE_ID) {
      await rejectClaimedJob(job, 'device_id_mismatch', job.operation);
      return;
    }
    if (job.operation === SHELL_OPERATION) return executeShellJob(job);
    if (job.operation === OLLAMA_OPERATION) return executeOllamaJob(job);
    await rejectClaimedJob(job, `unsupported_operation:${String(job.operation || '')}`, job.operation);
  } catch (error) { console.error(`[job] ${error.message}`); }
}

let stopping = false;
process.on('SIGTERM', () => { stopping = true; log('STOP requested'); });
process.on('SIGINT', () => { stopping = true; log('STOP requested'); });

(async () => {
  log(`START device=${DEVICE_ID} platform=windows-local node=${process.version}`);
  try { await enroll(); } catch (error) { console.error(`[enroll] ${error.message}`); }
  await heartbeat();
  setInterval(heartbeat, HEARTBEAT_MS);
  while (!stopping) {
    await claimAndExecute();
    await sleep(POLL_MS);
  }
})().catch(error => { console.error(error); process.exit(1); });
