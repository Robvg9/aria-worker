'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const baseUrl = String(process.env.ARIA_CONTROL_URL || '').replace(/\/+$/, '');
const controlToken = String(process.env.ARIA_CONTROL_TOKEN || '');
const workerToken = String(process.env.ARIA_WORKER_TOKEN || '');
const workerScript = path.resolve('scripts/aria-persistent-windows-worker-v1.js');
const baseAdapter = String(process.env.ARIA_AUTONOMY_ADAPTER || '');
const workspaceRoot = String(process.env.ARIA_WORKSPACE_ROOT || '');
const nodePath = String(process.env.ARIA_NODE_PATH || process.execPath);
const evidencePath = String(process.env.ARIA_READONLY_PILOT_EVIDENCE_PATH || '');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function rawRequest(route, token, method = 'GET', body) {
  const headers = { authorization: 'Bearer ' + token };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
async function control(route, method = 'GET', body) {
  const result = await rawRequest(route, controlToken, method, body);
  if (result.status < 200 || result.status >= 300) {
    throw new Error('control_request_failed:' + method + ':' + route + ':HTTP_' + result.status + ':' + String(result.data.error || 'unknown'));
  }
  return result.data;
}
async function waitForReadback(probeId, predicate, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await control('/api/package3/probes/' + encodeURIComponent(probeId));
    if (predicate(last)) return last;
    await sleep(500);
  }
  const status = last && last.mission && last.mission.status || 'unknown';
  throw new Error('readonly_pilot_timeout:mission=' + status);
}
function writeEvidence(summary) {
  if (!evidencePath) return;
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(summary, null, 2), 'utf8');
}
function buildAdapterWrapper() {
  const wrapperPath = path.join(os.tmpdir(), 'aria-readonly-pilot-adapter-' + crypto.randomBytes(6).toString('hex') + '.cjs');
  const source = [
    "'use strict';",
    "const baseModule = require(process.env.ARIA_READONLY_PILOT_BASE_ADAPTER);",
    "const base = baseModule.createAdapter({ workspaceRoot: process.env.ARIA_WORKSPACE_ROOT });",
    "module.exports = Object.freeze({",
    "  supabaseIndependent: true,",
    "  localInference: false,",
    "  capabilities: base.capabilities,",
    "  health: () => base.health(),",
    "  async executeTask(task, mission, context) {",
    "    const result = await base.executeTask(task, mission, context);",
    "    if (task && task.operation === 'git.status') await new Promise(resolve => setTimeout(resolve, 6500));",
    "    return result;",
    "  },",
    "  verifyCompletion: mission => base.verifyCompletion(mission)",
    "});",
    ""
  ].join('\n');
  fs.writeFileSync(wrapperPath, source, { encoding: 'utf8', flag: 'wx' });
  return wrapperPath;
}

(async () => {
  assert.ok(/^https:\/\//.test(baseUrl), 'LIVE coordinator must use HTTPS');
  assert.ok(controlToken.length >= 32 && workerToken.length >= 32, 'control/worker tokens are required');
  assert.notEqual(controlToken, workerToken, 'control and worker tokens must be distinct');
  assert.ok(fs.existsSync(workerScript), 'worker script missing from checkout');
  assert.ok(fs.existsSync(baseAdapter), 'execution adapter missing from checkout');
  assert.ok(fs.existsSync(workspaceRoot), 'approved ROBVG workspace not found');
  assert.equal(os.hostname().toUpperCase(), 'ROBVG', 'this pilot may run only on ROBVG');

  const health = await control('/health');
  assert.equal(health.ok, true);
  assert.equal(health.service, 'aria-autonomy-coordinator');

  const probeId = 'readonly-pilot-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
  const scopeToken = crypto.randomBytes(48).toString('base64url');
  const workerId = 'mw2p3-' + probeId + '-before';
  const wrapperPath = buildAdapterWrapper();
  let started = false;
  let closed = false;
  let child = null;
  let childStdout = '';
  let childStderr = '';
  let childExit = null;
  let childCloseResolve;
  const childClosed = new Promise(resolve => { childCloseResolve = resolve; });
  let finalReadback = null;
  let summary = null;
  let failure = null;

  try {
    const start = await control('/api/package3/probe/start', 'POST', {
      mode: 'readonly_git_status',
      confirm: 'RUN_ONE_READONLY_GIT_STATUS_PILOT',
      probe_id: probeId,
      scope_token: scopeToken
    });
    started = true;
    assert.equal(start.probe.probe_type, 'readonly_git_status');
    assert.equal(start.mission.status, 'running');
    assert.equal(start.mission.tasks.length, 1);
    assert.equal(start.mission.tasks[0].operation, 'git.status');
    assert.deepEqual(start.mission.tasks[0].payload, {});
    assert.ok(Date.parse(start.probe.expires_at) - Date.now() <= 5 * 60 * 1000 + 5000);

    const childEnv = {
      ...process.env,
      ARIA_CONTROL_URL: baseUrl,
      ARIA_WORKER_TOKEN: workerToken,
      ARIA_AUTONOMY_ADAPTER: wrapperPath,
      ARIA_READONLY_PILOT_BASE_ADAPTER: baseAdapter,
      ARIA_WORKSPACE_ROOT: workspaceRoot,
      ARIA_WORKER_ID: workerId,
      ARIA_PACKAGE3_SCOPE_PROBE_ID: probeId,
      ARIA_PACKAGE3_SCOPE_TOKEN: scopeToken,
      ARIA_WORKER_POLL_MS: '500',
      ARIA_WORKER_HEARTBEAT_MS: '5000',
      ARIA_WORKER_PRESENCE_MS: '5000'
    };
    child = spawn(nodePath, [workerScript], {
      cwd: process.cwd(),
      env: childEnv,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { childStdout += chunk.toString(); });
    child.stderr.on('data', chunk => { childStderr += chunk.toString(); });
    child.on('error', error => {
      childStderr += 'SPAWN_ERROR=' + String(error && error.message || error) + '\n';
      childCloseResolve({ code: null, signal: 'spawn_error' });
    });
    child.on('close', (code, signal) => {
      childExit = { code, signal };
      childCloseResolve(childExit);
    });

    finalReadback = await waitForReadback(probeId, readback => {
      const taskJob = (readback.jobs || []).find(job => job.operation === 'task.execute' && job.task_operation === 'git.status');
      const verifyJob = (readback.jobs || []).find(job => job.operation === 'mission.verify');
      return readback.mission && readback.mission.status === 'succeeded' &&
        taskJob && taskJob.status === 'completed' && Number(taskJob.heartbeat_count) >= 1 &&
        verifyJob && verifyJob.status === 'completed' &&
        Number(readback.scope && readback.scope.presence_count) >= 1 &&
        Number(readback.scope && readback.scope.alarm_tick_count) >= 1;
    }, 90000);

    const taskJob = finalReadback.jobs.find(job => job.operation === 'task.execute' && job.task_operation === 'git.status');
    assert.equal(taskJob.attempts, 1);
    assert.ok(Number(taskJob.heartbeat_count) >= 1);
    assert.equal(finalReadback.scope.claim_count, 2);
    assert.ok(Number(finalReadback.scope.presence_count) >= 1);
    assert.equal(finalReadback.scope.last_presence_state, 'idle');
    assert.ok(Number(finalReadback.scope.alarm_tick_count) >= 1);
    assert.equal(finalReadback.mission.progress_percent, 100);
    assert.equal(finalReadback.mission.verification.read_only, true);
    assert.equal(finalReadback.mission.verification.pilot_operation, 'git.status');
    assert.equal(finalReadback.notifications.every(item => item.status === 'suppressed_package3_probe'), true);

    const close = await control('/api/package3/probe/close', 'POST', {
      probe_id: probeId,
      reason: 'readonly_git_status_pilot_verified_and_revoked'
    });
    closed = true;
    assert.equal(close.scope.status, 'closed');
    assert.ok(close.scope.scope_token_revoked_at);
    assert.equal(close.mission.status, 'succeeded');

    const ordinaryMission = await rawRequest('/api/missions', controlToken, 'POST', {
      goal: 'freeze-preservation-check-after-readonly-pilot'
    });
    assert.equal(ordinaryMission.status, 423, 'global mission creation must remain frozen');
    const ordinaryClaim = await rawRequest('/api/worker/claim', workerToken, 'POST', {
      worker_id: 'ordinary-worker-after-readonly-pilot',
      capabilities: ['git.status']
    });
    assert.equal(ordinaryClaim.status, 423, 'ordinary worker claim must remain frozen');

    const exited = childExit || await Promise.race([
      childClosed,
      sleep(10000).then(() => null)
    ]);
    if (!exited) {
      child.kill();
      throw new Error('worker_did_not_stop_after_scope_revocation');
    }
    assert.equal(exited.code, 0, 'worker must stop cleanly after scope revocation');
    assert.match(childStdout, /ARIA_WINDOWS_EXECUTOR_READY=local-workspace; LOCAL_INFERENCE=false/);
    assert.match(childStdout, /ARIA_WINDOWS_WORKER_IDLE_HEARTBEAT=sent/);
    assert.match(childStdout, /ARIA_WINDOWS_WORKER_STOPPED=MISSION_EXECUTION_PAUSED/);
    assert.ok((childStdout.match(/Reported result for /g) || []).length >= 2);
    assert.equal(childStderr.trim(), '');

    finalReadback = await control('/api/package3/probes/' + encodeURIComponent(probeId));
    assert.equal(finalReadback.scope.status, 'closed');
    assert.ok(finalReadback.scope.scope_token_revoked_at);
    assert.equal(finalReadback.mission.status, 'succeeded');
    const output = taskJob.result && taskJob.result.evidence && taskJob.result.evidence.output || '';
    summary = {
      result: 'PASS',
      host: os.hostname(),
      probe_id: probeId,
      mission_id: finalReadback.scope.mission_id,
      worker_id: workerId,
      operation: 'git.status',
      read_only: true,
      worker_exit_code: exited.code,
      job_attempts: taskJob.attempts,
      job_heartbeat_count: taskJob.heartbeat_count,
      idle_presence_count: finalReadback.scope.presence_count,
      scheduler_alarm_tick_count: finalReadback.scope.alarm_tick_count,
      mission_status: finalReadback.mission.status,
      scope_status: finalReadback.scope.status,
      scope_token_revoked: Boolean(finalReadback.scope.scope_token_revoked_at),
      global_freeze_ordinary_create_http: ordinaryMission.status,
      global_freeze_ordinary_claim_http: ordinaryClaim.status,
      local_inference: false,
      git_status_excerpt: String(output).slice(0, 1200),
      worker_stdout_tail: childStdout.slice(-3000)
    };
    writeEvidence(summary);
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } catch (error) {
    failure = error;
  } finally {
    if (started && !closed) {
      try {
        const close = await control('/api/package3/probe/close', 'POST', {
          probe_id: probeId,
          reason: 'readonly_pilot_finally_cleanup'
        });
        closed = close.scope && close.scope.status === 'closed';
      } catch (closeError) {
        childStderr += 'SCOPE_CLEANUP_ERROR=' + String(closeError && closeError.message || closeError) + '\n';
      }
    }
    if (child && !childExit) {
      const exited = await Promise.race([childClosed, sleep(10000).then(() => null)]);
      if (!exited) child.kill();
    }
    try { fs.rmSync(wrapperPath, { force: true }); } catch (_) {}
  }
  if (failure) {
    const failedSummary = {
      result: 'FAIL',
      probe_id: probeId,
      scope_closed: closed,
      worker_exit: childExit,
      worker_stdout_tail: childStdout.slice(-2500),
      worker_stderr_tail: childStderr.slice(-1500),
      error: String(failure && failure.message || failure)
    };
    writeEvidence(failedSummary);
    process.stderr.write(JSON.stringify(failedSummary, null, 2) + '\n');
    process.exitCode = 1;
  }
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
