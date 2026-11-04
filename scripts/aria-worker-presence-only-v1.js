'use strict';

// Presence-only Windows worker for Mission Wonder 2 A3.
// This process is not an executor: it sends idle heartbeats only and has no
// adapter, workspace, planner, mission, job, or claim capability.
const { randomUUID } = require('node:crypto');

const baseUrl = String(process.env.ARIA_CONTROL_URL || '').replace(/\/+$/, '');
const workerToken = String(process.env.ARIA_WORKER_TOKEN || '');
const workerId = String(process.env.ARIA_WORKER_ID || '');
const probeId = String(process.env.ARIA_WORKER_PRESENCE_PROBE_ID || '');
const scopeToken = String(process.env.ARIA_WORKER_PRESENCE_SCOPE_TOKEN || '');
const instanceId = String(process.env.ARIA_WORKER_PRESENCE_INSTANCE_ID || randomUUID());
const intervalMs = Number(process.env.ARIA_WORKER_PRESENCE_INTERVAL_MS || 10000);
const retryBaseMs = Number(process.env.ARIA_WORKER_PRESENCE_RETRY_BASE_MS || 1000);
const maxFailures = Math.max(1, Math.min(10, Number(process.env.ARIA_WORKER_PRESENCE_MAX_FAILURES || 5)));

let stopping = false;
let stopReason = 'scope_closed';

function validateConfig() {
  if (!baseUrl) throw new Error('ARIA_CONTROL_URL_required');
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('ARIA_CONTROL_URL_must_use_https');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    throw new Error('ARIA_CONTROL_URL_must_be_an_origin');
  }
  if (workerToken.length < 32) throw new Error('ARIA_WORKER_TOKEN_invalid');
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(workerId)) throw new Error('ARIA_WORKER_ID_invalid');
  if (!/^[a-z0-9][a-z0-9-]{7,70}$/.test(probeId)) throw new Error('ARIA_WORKER_PRESENCE_PROBE_ID_invalid');
  if (scopeToken.length < 32 || scopeToken.length > 200) throw new Error('ARIA_WORKER_PRESENCE_SCOPE_TOKEN_invalid');
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(instanceId)) throw new Error('ARIA_WORKER_PRESENCE_INSTANCE_ID_invalid');
  if (!Number.isFinite(intervalMs) || intervalMs < 1000 || intervalMs > 60000) {
    throw new Error('ARIA_WORKER_PRESENCE_INTERVAL_MS_out_of_range');
  }
  if (!Number.isFinite(retryBaseMs) || retryBaseMs < 100 || retryBaseMs > 10000) {
    throw new Error('ARIA_WORKER_PRESENCE_RETRY_BASE_MS_out_of_range');
  }
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function parseCoordinatorError(message) {
  const match = String(message || '').match(/coordinator_http_(\d{3}):([a-z0-9_-]+)/i);
  return match ? { status: Number(match[1]), code: String(match[2]).toLowerCase() } : null;
}

async function sendPresence() {
  const response = await fetch(baseUrl + '/api/worker/presence', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + workerToken,
      'content-type': 'application/json',
      'x-aria-worker-presence-probe-id': probeId,
      'x-aria-worker-presence-scope-token': scopeToken,
      'x-aria-worker-presence-worker-id': workerId,
      'x-aria-worker-presence-instance-id': instanceId
    },
    body: JSON.stringify({ worker_id: workerId, instance_id: instanceId, state: 'idle' }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('coordinator_http_' + response.status + ':' + String(data.error || 'unknown'));
  }
  if (data.ok !== true || !Number.isSafeInteger(Number(data.presence_count)) || Number(data.presence_count) < 1) {
    throw new Error('coordinator_presence_response_invalid');
  }
  return data;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  validateConfig();
  process.stdout.write('ARIA_WINDOWS_PRESENCE_WORKER_STARTED=true\n');
  process.stdout.write('ARIA_WINDOWS_PRESENCE_WORKER_ID=' + workerId + '\n');
  process.stdout.write('ARIA_WINDOWS_PRESENCE_INSTANCE_ID=' + instanceId + '\n');
  let failures = 0;
  while (!stopping) {
    try {
      const result = await sendPresence();
      failures = 0;
      process.stdout.write('ARIA_WINDOWS_WORKER_HEARTBEAT=PASS; COUNT=' + String(result.presence_count) + '\n');
      await sleep(intervalMs);
    } catch (cause) {
      const message = String(cause && cause.message || cause);
      const parsed = parseCoordinatorError(message);
      if (parsed && (parsed.status === 410 || (parsed.status === 423 && parsed.code === 'mission_execution_paused'))) {
        stopReason = parsed.code === 'mission_execution_paused' ? 'GLOBAL_FREEZE' : 'SCOPE_REVOKED_OR_EXPIRED';
        stopping = true;
        process.exitCode = 0;
        break;
      }
      if (parsed && !retryableStatus(parsed.status)) {
        stopReason = parsed.status === 409 ? 'SINGLE_INSTANCE_OR_SCOPE_CONFLICT' : 'NON_RETRYABLE_HTTP_' + parsed.status;
        stopping = true;
        process.exitCode = 1;
        process.stderr.write('ARIA_WINDOWS_PRESENCE_WORKER_STOPPED=' + stopReason + '\n');
        break;
      }
      failures += 1;
      if (failures >= maxFailures) {
        stopReason = 'RETRY_LIMIT_EXHAUSTED';
        stopping = true;
        process.exitCode = 75;
        process.stderr.write('ARIA_WINDOWS_PRESENCE_WORKER_STOPPED=' + stopReason + '\n');
        break;
      }
      const delay = Math.min(30000, retryBaseMs * (2 ** (failures - 1)));
      process.stderr.write('ARIA_WINDOWS_PRESENCE_RETRY=' + failures + '; DELAY_MS=' + delay + '\n');
      await sleep(delay);
    }
  }
  process.stdout.write('ARIA_WINDOWS_PRESENCE_WORKER_STOPPED=' + stopReason + '\n');
}

process.once('SIGINT', () => { stopReason = 'SIGINT'; stopping = true; });
process.once('SIGTERM', () => { stopReason = 'SIGTERM'; stopping = true; });

main().catch(cause => {
  process.stderr.write('ARIA_WINDOWS_PRESENCE_WORKER_START_FAILED=' + String(cause && cause.message || cause) + '\n');
  process.exitCode = 1;
});
