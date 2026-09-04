'use strict';

const { spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');

const GATEWAY_URL = process.env.ARIA_DEVICE_GATEWAY_URL;
const DEVICE_TOKEN = process.env.ARIA_DEVICE_TOKEN;
const DEVICE_ID = process.env.ARIA_DEVICE_ID;
const HEARTBEAT_MS = Math.max(10_000, Number(process.env.ARIA_HEARTBEAT_MS || 30_000));
const POLL_MS = Math.max(1_000, Number(process.env.ARIA_POLL_MS || 3_000));
const MAX_OUTPUT = 256 * 1024;
const DISPLAY_OUTPUT = 4096;

function log(message) { console.log(`[ARIA] ${new Date().toISOString()} ${message}`); }
function redact(text) {
  let value = typeof text === 'string' ? text.slice(-DISPLAY_OUTPUT) : '';
  const patterns = [ /Bearer\s+[A-Za-z0-9._\-]+/g, /\bsk-[A-Za-z0-9_\-]{8,}/g, /\bor-v1-[A-Za-z0-9_\-]{8,}/g, /(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi ];
  for (const pattern of patterns) value = value.replace(pattern, '[redacted]');
  return value;
}

if (!GATEWAY_URL || !DEVICE_TOKEN || !DEVICE_ID) {
  console.error('ARIA agent requires ARIA_DEVICE_GATEWAY_URL, ARIA_DEVICE_TOKEN and ARIA_DEVICE_ID');
  process.exit(2);
}

function endpoint(path) { return `${GATEWAY_URL.replace(/\/$/, '')}${path}`; }
function headers() { return { 'content-type': 'application/json', authorization: `Bearer ${DEVICE_TOKEN}`, 'x-aria-device-id': DEVICE_ID }; }
async function api(path, options = {}) {
  const response = await fetch(endpoint(path), { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  const text = await response.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch (_) { body = { raw: text }; }
  if (!response.ok) throw new Error(`gateway ${response.status}: ${body?.error || 'request failed'}`);
  return body;
}
function run(command, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('/data/data/com.termux/files/usr/bin/bash', ['-lc', command], { cwd: cwd || process.cwd(), env: process.env });
    let stdout = ''; let stderr = ''; let killed = false;
    const append = (current, chunk) => (current + chunk.toString()).slice(-MAX_OUTPUT);
    const timer = setTimeout(() => { killed = true; child.kill('SIGTERM'); }, Math.max(1_000, timeoutMs || 120_000));
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ status: killed ? 'timeout' : code === 0 ? 'succeeded' : 'failed', exit_code: typeof code === 'number' ? code : null, stdout, stderr, duration_ms: Date.now() - started, signal });
    });
    child.on('error', error => { clearTimeout(timer); resolve({ status: 'failed', exit_code: null, stdout, stderr: String(error.message).slice(0, 4096), duration_ms: Date.now() - started }); });
  });
}
async function heartbeat() {
  try { await api('/v1/devices/heartbeat', { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID, agent_type: 'android-termux', capabilities: ['shell.execute'] }) }); log(`ONLINE device=${DEVICE_ID}`); }
  catch (error) { console.error(`[heartbeat] ${error.message}`); }
}
async function claimAndExecute() {
  try {
    const body = await api('/v1/jobs/claim', { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID }) });
    if (!body?.job) return;
    const job = body.job;
    if (job.device_id !== DEVICE_ID) throw new Error('gateway returned job for another device');
    if (job.operation !== 'shell.execute') throw new Error(`unsupported operation: ${job.operation}`);
    log(`JOB RECEIVED id=${job.job_id} operation=${job.operation}`);
    await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/start`, { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID }) });
    log(`JOB START id=${job.job_id}`);
    const result = await run(job.command, job.cwd, job.timeout_ms);
    result.metadata = { agent_version: 'aria-termux-agent-v1', platform: `android-termux/${os.release()}`, request_nonce: crypto.randomUUID() };
    const safeStdout = redact(result.stdout);
    const safeStderr = redact(result.stderr);
    log(`JOB RESULT id=${job.job_id} status=${result.status} exit_code=${result.exit_code} duration_ms=${result.duration_ms}`);
    if (safeStdout) log(`STDOUT ${JSON.stringify(safeStdout)}`);
    if (safeStderr) log(`STDERR ${JSON.stringify(safeStderr)}`);
    await api(`/v1/jobs/${encodeURIComponent(job.job_id)}/result`, { method: 'POST', body: JSON.stringify({ device_id: DEVICE_ID, result }) });
    log(`JOB ACK id=${job.job_id} status=${result.status}`);
  } catch (error) { console.error(`[job] ${error.message}`); }
}

let stopping = false;
async function loop() {
  while (!stopping) { await claimAndExecute(); await new Promise(r => setTimeout(r, POLL_MS)); }
}
process.on('SIGTERM', () => { stopping = true; log('STOP requested'); });
process.on('SIGINT', () => { stopping = true; log('STOP requested'); });

(async () => {
  log(`START device=${DEVICE_ID} platform=android-termux node=${process.version}`);
  await heartbeat();
  setInterval(heartbeat, HEARTBEAT_MS);
  await loop();
})().catch(error => { console.error(error); process.exit(1); });
