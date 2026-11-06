'use strict';

// Windows-side outbound-only worker. It never opens an inbound port.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classifyClaimError } = require('../autonomy/persistent-worker-error-policy-v1');
const { acquireWorkerInstanceLock } = require('../autonomy/worker-single-instance-lock-v1');

const baseUrl = String(process.env.ARIA_CONTROL_URL || '').replace(/\/+$/, '');
const token = process.env.ARIA_WORKER_TOKEN || '';
const adapterPath = process.env.ARIA_AUTONOMY_ADAPTER;
const workerId = process.env.ARIA_WORKER_ID || (os.hostname() + '-' + process.pid);
const package3ProbeId = String(process.env.ARIA_PACKAGE3_SCOPE_PROBE_ID || '');
const package3ScopeToken = String(process.env.ARIA_PACKAGE3_SCOPE_TOKEN || '');
const package3LeaseEvidenceDir = String(process.env.ARIA_PACKAGE3_LEASE_EVIDENCE_DIR || '');
const a3PresenceProbeId = String(process.env.ARIA_MW2_A3_PRESENCE_PROBE_ID || '');
const a3PresenceScopeToken = String(process.env.ARIA_MW2_A3_PRESENCE_SCOPE_TOKEN || '');
const a3PresenceOnly = Boolean(a3PresenceProbeId && a3PresenceScopeToken);
const a3PresenceIntervalMs = Number(process.env.ARIA_MW2_A3_PRESENCE_INTERVAL_MS || 5000);
const a3PresenceMaxRuntimeMs = Number(process.env.ARIA_MW2_A3_PRESENCE_MAX_RUNTIME_MS || 45000);
const workerLockPath = process.env.ARIA_WORKER_LOCK_PATH || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ARIA', 'worker', 'worker-instance.lock');
const pollMs = Math.max(500, Number(process.env.ARIA_WORKER_POLL_MS || 2000));
const heartbeatMs = Math.max(5000, Number(process.env.ARIA_WORKER_HEARTBEAT_MS || 15000));
const presenceMs = package3ProbeId && package3ScopeToken
  ? Math.max(5000, Number(process.env.ARIA_WORKER_PRESENCE_MS || 0))
  : 0;
let lastPresenceAt = Date.now();
let stopping = false;

function validateConfig() {
  if (!baseUrl) throw new Error('Set ARIA_CONTROL_URL to the cloud coordinator URL.');
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('ARIA_CONTROL_URL must use HTTPS except for local development.');
  }
  if (token.length < 32) throw new Error('ARIA_WORKER_TOKEN must contain at least 32 characters.');
  if (!adapterPath) throw new Error('Set ARIA_AUTONOMY_ADAPTER to an approved local adapter module.');
  if (Boolean(package3ProbeId) !== Boolean(package3ScopeToken) ||
      (package3ProbeId && package3ScopeToken.length < 32)) {
    throw new Error('Package 3 probe ID and scope token must be supplied together.');
  }
  if (Boolean(a3PresenceProbeId) !== Boolean(a3PresenceScopeToken) ||
      (a3PresenceProbeId && (!/^mw2-a3-[a-z0-9][a-z0-9-]{7,60}$/.test(a3PresenceProbeId) || a3PresenceScopeToken.length < 32 || a3PresenceScopeToken.length > 200))) {
    throw new Error('Mission Wonder 2 A3 presence scope ID and token must be supplied together and valid.');
  }
  if (a3PresenceOnly && (package3ProbeId || !Number.isInteger(a3PresenceIntervalMs) || a3PresenceIntervalMs < 2000 || a3PresenceIntervalMs > 15000 ||
      !Number.isInteger(a3PresenceMaxRuntimeMs) || a3PresenceMaxRuntimeMs < 10000 || a3PresenceMaxRuntimeMs > 120000)) {
    throw new Error('Mission Wonder 2 A3 presence-only configuration is out of bounds.');
  }
}

function persistPackage3LeaseEvidence(job) {
  if (!package3LeaseEvidenceDir || !package3ProbeId || !job || !job.lease_token) return;
  const safeName = value => String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
  fs.mkdirSync(package3LeaseEvidenceDir, { recursive: true });
  const file = path.join(
    package3LeaseEvidenceDir,
    safeName(workerId) + '__' + safeName(job.job_id) + '.json'
  );
  // Temporary runner-only evidence used to prove that an old lease is fenced.
  // This directory is excluded from uploaded artifacts and removed by the E2E harness.
  fs.writeFileSync(file, JSON.stringify({
    probe_id: package3ProbeId,
    worker_id: workerId,
    job_id: job.job_id,
    lease_token: job.lease_token,
    lease_until: job.lease_until,
    attempts: job.attempts
  }), { encoding: 'utf8', mode: 0o600 });
}

async function request(route, body) {
  const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  if (package3ProbeId && package3ScopeToken) {
    headers['x-aria-package3-probe-id'] = package3ProbeId;
    headers['x-aria-package3-scope-token'] = package3ScopeToken;
    headers['x-aria-package3-worker-id'] = workerId;
  }
  if (a3PresenceOnly) {
    headers['x-aria-mw2-a3-probe-id'] = a3PresenceProbeId;
    headers['x-aria-mw2-a3-scope-token'] = a3PresenceScopeToken;
    headers['x-aria-mw2-a3-worker-id'] = workerId;
  }
  const response = await fetch(baseUrl + route, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('coordinator_http_' + response.status + ':' + String(data.error || 'unknown'));
  return data;
}

async function runA3PresenceOnly() {
  const deadline = Date.now() + a3PresenceMaxRuntimeMs;
  let heartbeatCount = 0;
  process.stdout.write('ARIA_MW2_A3_MODE=PRESENCE_ONLY; CLAIMS_DISABLED=true; TASK_EXECUTION_DISABLED=true\n');
  while (!stopping && Date.now() < deadline) {
    const presence = await request('/api/worker/presence', { worker_id: workerId, state: 'idle' });
    heartbeatCount += 1;
    process.stdout.write('ARIA_MW2_A3_IDLE_HEARTBEAT=' + heartbeatCount + '; SERVER_COUNT=' + String(presence.presence_count || 'unknown') + '\n');
    const remaining = deadline - Date.now();
    if (remaining <= 0 || stopping) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(a3PresenceIntervalMs, remaining)));
  }
  process.stdout.write('ARIA_MW2_A3_WORKER_STOPPED=bounded_presence_window_complete; HEARTBEATS=' + heartbeatCount + '\n');
}

async function main() {
  validateConfig();
  const instanceLock = acquireWorkerInstanceLock({ lockPath: workerLockPath });
  process.once('exit', () => { try { instanceLock.release(); } catch (_) {} });
  process.stdout.write('ARIA_WORKER_SINGLE_INSTANCE_LOCK=acquired; RECOVERED_STALE=' + String(instanceLock.recoveredStaleLock) + '\n');
  let adapter = require(path.resolve(adapterPath));
  if (typeof adapter.createAdapter === 'function' && adapter.supabaseIndependent !== true) {
    adapter = adapter.createAdapter({
      workspaceRoot: process.env.ARIA_WORKSPACE_ROOT
    });
  }
  if (adapter.supabaseIndependent !== true ||
      adapter.localInference !== false ||
      typeof adapter.plan === 'function' ||
      typeof adapter.replan === 'function' ||
      typeof adapter.executeTask !== 'function' ||
      typeof adapter.verifyCompletion !== 'function') {
    throw new Error('Worker adapter must be Supabase-independent, execution-only (localInference:false), expose no planner, and provide executeTask + verifyCompletion.');
  }
  if (typeof adapter.health === 'function') {
    const health = await adapter.health();
    if (!health || health.ok !== true || health.local_inference !== false) {
      throw new Error('Worker adapter health check failed or local inference is enabled.');
    }
    process.stdout.write('ARIA_WINDOWS_EXECUTOR_READY=local-workspace; LOCAL_INFERENCE=false\n');
  }
  process.stdout.write('ARIA Windows worker started: ' + workerId + '\n');
  process.stdout.write('Coordinator: ' + baseUrl + '\n');
  process.stdout.write('This worker uses outbound HTTPS only; no inbound port is opened.\n');

  if (a3PresenceOnly) {
    await runA3PresenceOnly();
    return;
  }

  while (!stopping) {
    let job;
    try {
      const data = await request('/api/worker/claim', { worker_id: workerId, capabilities: Array.isArray(adapter.capabilities) ? adapter.capabilities : [] });
      job = data.job;
    } catch (error) {
      const claimPolicy = classifyClaimError(error);
      if (claimPolicy.action === 'stop') {
        process.stdout.write('ARIA_WINDOWS_WORKER_STOPPED=' + claimPolicy.reason + '\n');
        if (claimPolicy.exitCode) process.exitCode = claimPolicy.exitCode;
        stopping = true;
        break;
      }
      process.stderr.write('Claim failed: ' + String(error.message || error) + '\n');
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }
    if (!job) {
      if (presenceMs > 0 && Date.now() - lastPresenceAt >= presenceMs) {
        try {
          const presence = await request('/api/worker/presence', { worker_id: workerId, state: 'idle' });
          lastPresenceAt = Date.now();
          process.stdout.write('ARIA_WINDOWS_WORKER_IDLE_HEARTBEAT=sent; COUNT=' + String(presence.presence_count || 'unknown') + '\n');
        } catch (error) {
          const presencePolicy = classifyClaimError(error);
          if (presencePolicy.action === 'stop') {
            process.stdout.write('ARIA_WINDOWS_WORKER_STOPPED=' + presencePolicy.reason + '\n');
            if (presencePolicy.exitCode) process.exitCode = presencePolicy.exitCode;
            stopping = true;
            break;
          }
          process.stderr.write('Idle presence failed: ' + String(error.message || error) + '\n');
        }
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
      continue;
    }

    persistPackage3LeaseEvidence(job);
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
      const context = job.context || {};
      const mission = context.mission || { mission_id: job.mission_id, goal: context.goal, metadata: context.metadata, policy: context.policy };
      let rawResult;
      if (job.task && job.task.operation === 'mission.plan') {
        if (typeof adapter.plan !== 'function') throw new Error('worker_planner_unavailable');
        const tasks = await adapter.plan(job.task.payload && job.task.payload.goal || context.goal, { metadata: context.metadata || {}, policy: context.policy || {} });
        rawResult = { passed: true, evidence: { tasks } };
      } else if (job.task && job.task.operation === 'mission.replan') {
        if (typeof adapter.replan !== 'function') throw new Error('worker_replanner_unavailable');
        const tasks = await adapter.replan(mission, { reason: context.reason || job.task.payload && job.task.payload.reason || 'replan' });
        rawResult = { passed: true, evidence: { tasks } };
      } else if (job.task && job.task.operation === 'mission.verify') {
        if (typeof adapter.verifyCompletion !== 'function') throw new Error('worker_verifier_unavailable');
        const verification = await adapter.verifyCompletion(mission);
        rawResult = { passed: true, evidence: { verification } };
      } else {
        rawResult = await adapter.executeTask(job.task, mission, { worker_id: workerId, job_id: job.job_id });
      }
      const result = rawResult && rawResult.passed === true ? rawResult
        : rawResult && (rawResult.status === 'succeeded' || rawResult.ok === true)
          ? { ...rawResult, passed: true, evidence: rawResult.evidence == null ? { worker_status: rawResult.status || 'ok', exit_code: rawResult.exit_code == null ? null : rawResult.exit_code } : rawResult.evidence }
          : rawResult;
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
  const code = error && Number.isInteger(error.exitCode) ? error.exitCode : 1;
  const label = error && error.code === 'ARIA_WORKER_ALREADY_RUNNING' ? 'ARIA_WORKER_ALREADY_RUNNING' : 'ARIA_WINDOWS_WORKER_START_FAILED';
  process.stderr.write(label + '=' + String(error && error.message || error) + '\n');
  process.exitCode = code;
});
