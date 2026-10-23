'use strict';

// Windows-side outbound-only worker. It never opens an inbound port.
const os = require('node:os');
const path = require('node:path');

const baseUrl = String(process.env.ARIA_CONTROL_URL || '').replace(/\/+$/, '');
const token = process.env.ARIA_WORKER_TOKEN || '';
const adapterPath = process.env.ARIA_AUTONOMY_ADAPTER;
const workerId = process.env.ARIA_WORKER_ID || (os.hostname() + '-' + process.pid);
const pollMs = Math.max(500, Number(process.env.ARIA_WORKER_POLL_MS || 2000));
const heartbeatMs = Math.max(5000, Number(process.env.ARIA_WORKER_HEARTBEAT_MS || 15000));
let stopping = false;

function validateConfig() {
  if (!baseUrl) throw new Error('Set ARIA_CONTROL_URL to the cloud coordinator URL.');
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('ARIA_CONTROL_URL must use HTTPS except for local development.');
  }
  if (token.length < 32) throw new Error('ARIA_WORKER_TOKEN must contain at least 32 characters.');
  if (!adapterPath) throw new Error('Set ARIA_AUTONOMY_ADAPTER to an approved local adapter module.');
}

async function request(route, body) {
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('coordinator_http_' + response.status + ':' + String(data.error || 'unknown'));
  return data;
}

async function main() {
  validateConfig();
  const adapter = require(path.resolve(adapterPath));
  if (adapter.supabaseIndependent !== true || typeof adapter.executeTask !== 'function') {
    throw new Error('Worker adapter must export supabaseIndependent: true and executeTask(task, mission, context).');
  }
  process.stdout.write('ARIA Windows worker started: ' + workerId + '\n');
  process.stdout.write('Coordinator: ' + baseUrl + '\n');
  process.stdout.write('This worker uses outbound HTTPS only; no inbound port is opened.\n');

  while (!stopping) {
    let job;
    try {
      const data = await request('/api/worker/claim', { worker_id: workerId, capabilities: Array.isArray(adapter.capabilities) ? adapter.capabilities : [] });
      job = data.job;
    } catch (error) {
      process.stderr.write('Claim failed: ' + String(error.message || error) + '\n');
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }
    if (!job) {
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }

    process.stdout.write('Claimed ' + job.job_id + ' for mission ' + job.mission_id + '\n');
    let heartbeatBusy = false;
    const heartbeatTimer = setInterval(async () => {
      if (heartbeatBusy || stopping) return;
      heartbeatBusy = true;
      try {
        await request('/api/worker/jobs/' + encodeURIComponent(job.job_id) + '/heartbeat', { worker_id: workerId, lease_token: job.lease_token });
      } catch (error) {
        process.stderr.write('Heartbeat failed for ' + job.job_id + ': ' + String(error.message || error) + '\n');
      } finally { heartbeatBusy = false; }
    }, heartbeatMs);

    try {
      const mission = { mission_id: job.mission_id, goal: job.context && job.context.goal, metadata: job.context && job.context.metadata };
      const result = await adapter.executeTask(job.task, mission, { worker_id: workerId, job_id: job.job_id });
      await request('/api/worker/jobs/' + encodeURIComponent(job.job_id) + '/complete', {
        worker_id: workerId, lease_token: job.lease_token, result
      });
      process.stdout.write('Reported result for ' + job.job_id + '\n');
    } catch (error) {
      try {
        await request('/api/worker/jobs/' + encodeURIComponent(job.job_id) + '/complete', {
          worker_id: workerId, lease_token: job.lease_token, error: String(error && error.message || error)
        });
      } catch (reportError) {
        process.stderr.write('Could not report failure for ' + job.job_id + ': ' + String(reportError.message || reportError) + '\n');
      }
    } finally {
      clearInterval(heartbeatTimer);
    }
  }
}

process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });

main().catch(error => {
  process.stderr.write('ARIA Windows worker failed to start: ' + String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
