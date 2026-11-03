'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BASE_URL = String(process.env.ARIA_CONTROL_URL || 'https://aria-autonomy-coordinator.robvg9.workers.dev').replace(/\/+$/, '');
const CONTROL_TOKEN = String(process.env.ARIA_CONTROL_TOKEN || '');
const WORKER_TOKEN = String(process.env.ARIA_WORKER_TOKEN || '');
const PROBE_ID = String(process.env.ARIA_PACKAGE3_PROBE_ID || '');
const EVIDENCE_PATH = String(process.env.ARIA_PACKAGE3_EVIDENCE_PATH || path.join(os.tmpdir(), 'aria-package3-live-evidence.json'));
const WORKER_SCRIPT = path.resolve(__dirname, 'aria-persistent-windows-worker-v1.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

function assertSafeConfiguration() {
  assert.ok(/^https:\/\//i.test(BASE_URL), 'ARIA_CONTROL_URL must use HTTPS');
  assert.ok(CONTROL_TOKEN.length >= 32, 'ARIA_CONTROL_TOKEN missing or too short');
  assert.ok(WORKER_TOKEN.length >= 32, 'ARIA_WORKER_TOKEN missing or too short');
  assert.notEqual(CONTROL_TOKEN, WORKER_TOKEN, 'control and worker credentials must be distinct');
  assert.match(PROBE_ID, /^[a-z0-9][a-z0-9-]{7,70}$/, 'probe ID invalid');
  assert.equal(process.platform, 'win32', 'this LIVE proof must execute the worker on a Windows runner');
}

async function api(route, {
  method = 'GET',
  token = CONTROL_TOKEN,
  body,
  probeId,
  scopeToken,
  expectedStatus
} = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (probeId) {
    headers['x-aria-package3-probe-id'] = probeId;
    headers['x-aria-package3-worker-id'] = String(body && body.worker_id || '');
  }
  if (scopeToken) headers['x-aria-package3-scope-token'] = scopeToken;
  const response = await fetch(BASE_URL + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch (_) { data = { raw: raw.slice(0, 1000) }; }
  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error('unexpected_http_' + response.status + '_for_' + route + ': ' + JSON.stringify(data).slice(0, 1800));
  }
  return { status: response.status, data };
}

async function waitUntil(predicate, description, timeoutMs = 30000, child = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error('worker_exited_before_' + description + ': ' + (child.__output || '').slice(-3000));
    }
    const value = await predicate();
    if (value) return value;
    await sleep(300);
  }
  throw new Error('timeout_waiting_for_' + description + (child ? ': ' + (child.__output || '').slice(-3000) : ''));
}

function waitForExit(child, timeoutMs = 10000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      reject(new Error('worker_process_exit_timeout'));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', onExit);
  });
}

async function killWorker(child) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGKILL'); } catch (_) {}
    try { await waitForExit(child, 5000); }
    catch (_) {
      const { spawnSync } = require('node:child_process');
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      await waitForExit(child, 5000);
    }
  }
}

function safeName(value) {
  return String(value || '').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
}

function createAdapterSource({ probeId, relativePath, content, artifactPath, attemptsPath, firstSignal }) {
  return [
    "'use strict';",
    "const fs = require('node:fs');",
    "const crypto = require('node:crypto');",
    "const expectedProbeId = " + JSON.stringify(probeId) + ";",
    "const relativePath = " + JSON.stringify(relativePath) + ";",
    "const content = " + JSON.stringify(content) + ";",
    "const artifactPath = " + JSON.stringify(artifactPath) + ";",
    "const attemptsPath = " + JSON.stringify(attemptsPath) + ";",
    "const firstSignal = " + JSON.stringify(firstSignal) + ";",
    "function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }",
    "function readAttempts() {",
    "  try { return Number(JSON.parse(fs.readFileSync(attemptsPath, 'utf8')).count || 0); }",
    "  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }",
    "}",
    "module.exports = Object.freeze({",
    "  supabaseIndependent: true,",
    "  localInference: false,",
    "  capabilities: Object.freeze(['workspace', 'mission.verify']),",
    "  async health() { return { ok: true, local_inference: false, adapter: 'isolated-package3-file-adapter' }; },",
    "  async executeTask(task, mission, context) {",
    "    if (!task || task.operation !== 'workspace.write') throw new Error('unexpected_task_operation');",
    "    if (mission.metadata.probe_id !== expectedProbeId) throw new Error('mission_probe_id_mismatch');",
    "    if (task.payload.relative_path !== relativePath || task.payload.content !== content) throw new Error('artifact_allowlist_rejected');",
    "    const current = fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, 'utf8') : null;",
    "    let writeAction = 'already_identical';",
    "    if (current !== content) {",
    "      const temporary = artifactPath + '.tmp';",
    "      fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'w' });",
    "      fs.renameSync(temporary, artifactPath);",
    "      writeAction = 'atomic_create';",
    "    }",
    "    const attempts = readAttempts() + 1;",
    "    fs.writeFileSync(attemptsPath, JSON.stringify({ count: attempts }), 'utf8');",
    "    if (attempts === 1) {",
    "      fs.writeFileSync(firstSignal, JSON.stringify({ job_id: context.job_id, attempt: attempts, worker_id: context.worker_id }), 'utf8');",
    "      await new Promise(() => {});",
    "    }",
    "    if (attempts !== 2) throw new Error('unexpected_execution_attempt_' + attempts);",
    "    const bytes = fs.readFileSync(artifactPath);",
    "    return { passed: true, evidence: { relative_path: relativePath, bytes: bytes.length, sha256: sha256(bytes), execution_attempt: attempts, write_action: writeAction } };",
    "  },",
    "  async verifyCompletion(mission) {",
    "    const task = (mission.tasks || []).find(item => item.task_id === 'package3-live-write-proof');",
    "    const evidence = task && task.evidence && task.evidence[0];",
    "    const bytes = fs.readFileSync(artifactPath);",
    "    const actualHash = sha256(bytes);",
    "    const passed = Boolean(task && task.status === 'succeeded' && evidence &&",
    "      bytes.toString('utf8') === content && evidence.sha256 === actualHash &&",
    "      evidence.relative_path === relativePath && evidence.execution_attempt === 2);",
    "    return { passed, reason: passed ? 'Independent filesystem read and SHA-256 match the recovered task evidence.' : 'Independent artifact verification mismatch.', artifact: { relative_path: relativePath, bytes: bytes.length, sha256: actualHash, independent_read: true } };",
    "  }",
    "});"
  ].join('\n');
}

function spawnWorker({ workerId, root, adapterPath, leaseEvidenceDir, probeId, scopeToken }) {
  const child = spawn(process.execPath, [WORKER_SCRIPT], {
    cwd: root,
    env: {
      ...process.env,
      ARIA_CONTROL_URL: BASE_URL,
      ARIA_WORKER_TOKEN: WORKER_TOKEN,
      ARIA_AUTONOMY_ADAPTER: adapterPath,
      ARIA_WORKSPACE_ROOT: root,
      ARIA_WORKER_ID: workerId,
      ARIA_WORKER_POLL_MS: '500',
      ARIA_WORKER_HEARTBEAT_MS: '5000',
      ARIA_PACKAGE3_SCOPE_PROBE_ID: probeId,
      ARIA_PACKAGE3_SCOPE_TOKEN: scopeToken,
      ARIA_PACKAGE3_LEASE_EVIDENCE_DIR: leaseEvidenceDir
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.__output = '';
  child.stdout.on('data', chunk => {
    const value = chunk.toString();
    child.__output += value;
    process.stdout.write(value);
  });
  child.stderr.on('data', chunk => {
    const value = chunk.toString();
    child.__output += value;
    process.stderr.write(value);
  });
  return child;
}

(async () => {
  assertSafeConfiguration();
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'aria-package3-live-'));
  const relativePath = 'package3-proof-' + PROBE_ID + '.txt';
  const artifactPath = path.join(root, relativePath);
  const attemptsPath = path.join(root, 'execution-attempts.json');
  const firstSignal = path.join(root, 'first-execution-started.json');
  const adapterPath = path.join(root, 'package3-live-adapter.cjs');
  const leaseEvidenceDir = path.join(root, 'lease-evidence');
  const evidence = {
    version: 'v1',
    probe_id: PROBE_ID,
    started_at: new Date().toISOString(),
    coordinator: BASE_URL,
    environment: 'production',
    global_freeze_expected: true,
    result: 'running',
    checks: {}
  };
  let scopeClosed = false;
  let workerBefore = null;
  let workerAfter = null;
  let missionId = null;
  let scopeToken = crypto.randomBytes(48).toString('base64url');

  try {
    const health = await api('/health', { expectedStatus: 200 });
    assert.equal(health.data.ok, true);
    assert.equal(health.data.storage, 'durable-object');
    assert.equal(health.data.supabase_independent, true);
    evidence.checks.durable_object_health = 'PASS';

    const frozenCreate = await api('/api/missions', {
      method: 'POST',
      body: { goal: 'This ordinary mission must remain frozen.' },
      expectedStatus: 423
    });
    assert.equal(frozenCreate.data.error, 'mission_execution_paused');
    const frozenClaim = await api('/api/worker/claim', {
      method: 'POST',
      token: WORKER_TOKEN,
      body: { worker_id: 'ordinary-package3-live-worker' },
      expectedStatus: 423
    });
    assert.equal(frozenClaim.data.error, 'mission_execution_paused');
    evidence.checks.global_freeze_preflight = 'PASS';

    // Prove the exact one-shot route is reachable while the global freeze is
    // active, without creating a scope or mission: invalid confirmation must
    // be rejected by the route's own validator (400), not by the generic freeze (423).
    const scopedRouteGuard = await api('/api/package3/probe/start', {
      method: 'POST',
      body: {
        confirm: 'INTENTIONALLY_INVALID_PACKAGE3_CONFIRMATION',
        probe_id: PROBE_ID,
        scope_token: crypto.randomBytes(48).toString('base64url')
      },
      expectedStatus: 400
    });
    assert.equal(scopedRouteGuard.data.error, 'explicit_package3_probe_confirmation_required');
    evidence.checks.scoped_probe_route_reached_while_global_freeze_active = 'PASS';

    const unauthorized = await api('/api/package3/probe/start', {
      method: 'POST',
      token: '',
      body: {
        confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE',
        probe_id: PROBE_ID,
        scope_token: scopeToken
      },
      expectedStatus: 401
    });
    assert.equal(unauthorized.data.error, 'unauthorized');

    const started = await api('/api/package3/probe/start', {
      method: 'POST',
      body: {
        confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE',
        probe_id: PROBE_ID,
        scope_token: scopeToken
      },
      expectedStatus: 201
    });
    missionId = started.data.mission.mission_id;
    assert.equal(started.data.probe.status, 'active');
    assert.equal(started.data.mission.status, 'running');
    assert.equal(started.data.mission.tasks.length, 1);
    assert.equal(started.data.mission.tasks[0].operation, 'workspace.write');
    assert.equal(started.data.mission.metadata.probe_id, PROBE_ID);
    evidence.mission_id = missionId;
    evidence.checks.single_allowlisted_mission_created = 'PASS';

    const concurrentProbeId = PROBE_ID + '-parallel';
    const concurrentProbe = await api('/api/package3/probe/start', {
      method: 'POST',
      body: {
        confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE',
        probe_id: concurrentProbeId,
        scope_token: crypto.randomBytes(48).toString('base64url')
      },
      expectedStatus: 409
    });
    assert.equal(concurrentProbe.data.error, 'package3_probe_already_active');
    evidence.checks.second_concurrent_probe_rejected = 'PASS';

    const outOfScopeWorker = await api('/api/worker/claim', {
      method: 'POST',
      token: WORKER_TOKEN,
      probeId: PROBE_ID,
      scopeToken,
      body: { worker_id: 'unlisted-package3-worker' },
      expectedStatus: 423
    });
    assert.equal(outOfScopeWorker.data.error, 'mission_execution_paused');
    evidence.checks.unlisted_worker_denied_before_claim = 'PASS';

    const content = 'Mission Wonder 2 Package 3 LIVE proof ' + PROBE_ID + '\n';
    await fsp.writeFile(adapterPath, createAdapterSource({
      probeId: PROBE_ID,
      relativePath,
      content,
      artifactPath,
      attemptsPath,
      firstSignal
    }), 'utf8');

    const adapter = require(adapterPath);
    assert.equal(adapter.supabaseIndependent, true);
    assert.equal(adapter.localInference, false);
    assert.equal(typeof adapter.plan, 'undefined');
    assert.equal(typeof adapter.replan, 'undefined');
    assert.equal(typeof adapter.executeTask, 'function');
    assert.equal(typeof adapter.verifyCompletion, 'function');

    const beforeWorkerId = 'mw2p3-' + PROBE_ID + '-before';
    const afterWorkerId = 'mw2p3-' + PROBE_ID + '-after';
    workerBefore = spawnWorker({
      workerId: beforeWorkerId,
      root,
      adapterPath,
      leaseEvidenceDir,
      probeId: PROBE_ID,
      scopeToken
    });

    const signal = await waitUntil(async () => {
      if (!fs.existsSync(firstSignal)) return null;
      return JSON.parse(await fsp.readFile(firstSignal, 'utf8'));
    }, 'first_live_task_execution', 45000, workerBefore);

    let readback = (await api('/api/package3/probes/' + PROBE_ID, { expectedStatus: 200 })).data;
    const firstTaskJob = readback.jobs.find(job => job.job_id === signal.job_id);
    assert.ok(firstTaskJob, 'the first task job must be persisted in the production Durable Object');
    assert.equal(firstTaskJob.operation, 'task.execute');
    assert.equal(firstTaskJob.status, 'leased');
    assert.equal(firstTaskJob.attempts, 1);
    assert.equal(firstTaskJob.worker_id, beforeWorkerId);
    assert.equal(readback.mission.status, 'running');
    assert.ok(fs.existsSync(artifactPath), 'the first process must create the isolated artifact before interruption');
    evidence.first_task_job_id = firstTaskJob.job_id;
    evidence.first_lease_until = firstTaskJob.lease_until;
    evidence.checks.production_durable_object_persisted_claim_and_artifact = 'PASS';

    await killWorker(workerBefore);
    workerBefore = null;
    evidence.checks.first_worker_process_interrupted = 'PASS';

    const oldLeasePath = path.join(
      leaseEvidenceDir,
      safeName(beforeWorkerId) + '__' + safeName(firstTaskJob.job_id) + '.json'
    );
    const oldLease = JSON.parse(await fsp.readFile(oldLeasePath, 'utf8'));
    assert.equal(oldLease.job_id, firstTaskJob.job_id);
    assert.equal(oldLease.attempts, 1);
    assert.ok(oldLease.lease_token);

    await waitUntil(async () => {
      const current = (await api('/api/package3/probes/' + PROBE_ID, { expectedStatus: 200 })).data;
      const job = current.jobs.find(item => item.job_id === firstTaskJob.job_id);
      return job && Date.parse(job.lease_until) <= Date.now() ? job : null;
    }, 'durable_object_lease_expiry', 30000);

    workerAfter = spawnWorker({
      workerId: afterWorkerId,
      root,
      adapterPath,
      leaseEvidenceDir,
      probeId: PROBE_ID,
      scopeToken
    });

    // The recovered worker can finish task.execute and transition the job to
    // "completed" before the next 300 ms poll. Observe the durable claim record
    // written synchronously by the worker, then reconcile it with Durable Object
    // state. Never require sampling the transient "leased" status.
    const afterLeasePath = path.join(
      leaseEvidenceDir,
      safeName(afterWorkerId) + '__' + safeName(firstTaskJob.job_id) + '.json'
    );
    const recoveredClaim = await waitUntil(async () => {
      if (!fs.existsSync(afterLeasePath)) return null;
      let lease;
      try {
        lease = JSON.parse(await fsp.readFile(afterLeasePath, 'utf8'));
      } catch (_) {
        return null;
      }
      if (lease.probe_id !== PROBE_ID ||
          lease.job_id !== firstTaskJob.job_id ||
          lease.worker_id !== afterWorkerId ||
          lease.attempts !== 2 ||
          !lease.lease_token) return null;

      const current = (await api('/api/package3/probes/' + PROBE_ID, { expectedStatus: 200 })).data;
      const job = current.jobs.find(item => item.job_id === firstTaskJob.job_id);
      return job &&
        job.attempts === 2 &&
        job.worker_id === afterWorkerId &&
        ['leased', 'completed'].includes(job.status)
        ? { current, job, lease }
        : null;
    }, 'same_job_reclaimed_by_second_process_and_persisted', 45000, workerAfter);
    const newLease = recoveredClaim.lease;
    evidence.reclaimed_job_observation = {
      status: recoveredClaim.job.status,
      attempts: recoveredClaim.job.attempts,
      worker_id: recoveredClaim.job.worker_id
    };
    evidence.checks.same_durable_job_reclaimed_after_process_restart = 'PASS';

    const completed = await waitUntil(async () => {
      const current = (await api('/api/package3/probes/' + PROBE_ID, { expectedStatus: 200 })).data;
      return current.mission && current.mission.status === 'succeeded' ? current : null;
    }, 'mission_terminal_success', 45000, workerAfter);
    await killWorker(workerAfter);
    workerAfter = null;

    const recoveredTaskJob = completed.jobs.find(job => job.job_id === firstTaskJob.job_id);
    assert.equal(recoveredTaskJob.status, 'completed');
    assert.equal(recoveredTaskJob.attempts, 2);
    assert.equal(newLease.job_id, oldLease.job_id);
    assert.equal(newLease.attempts, 2);
    assert.notEqual(newLease.lease_token, oldLease.lease_token);

    const stale = await api('/api/worker/jobs/' + encodeURIComponent(firstTaskJob.job_id) + '/complete', {
      method: 'POST',
      token: WORKER_TOKEN,
      probeId: PROBE_ID,
      scopeToken,
      body: {
        worker_id: beforeWorkerId,
        lease_token: oldLease.lease_token,
        result: { passed: true, evidence: { stale_worker: true } }
      },
      expectedStatus: 409
    });
    assert.equal(stale.data.error, 'lease_mismatch');
    evidence.checks.stale_lease_rejected_with_409 = 'PASS';

    const artifactBytes = await fsp.readFile(artifactPath);
    const artifactSha = digest(artifactBytes);
    const task = completed.mission.tasks[0];
    const taskEvidence = task && task.evidence && task.evidence[0];
    assert.equal(completed.mission.status, 'succeeded');
    assert.equal(completed.mission.progress_percent, 100);
    assert.equal(completed.mission.tasks.length, 1);
    assert.equal(task.status, 'succeeded');
    assert.equal(taskEvidence.relative_path, relativePath);
    assert.equal(taskEvidence.sha256, artifactSha);
    assert.equal(taskEvidence.execution_attempt, 2);
    assert.equal(taskEvidence.write_action, 'already_identical');
    assert.equal(completed.mission.verification.passed, true);
    assert.equal(completed.mission.verification.artifact.sha256, artifactSha);
    assert.equal(completed.mission.verification.artifact.independent_read, true);
    evidence.artifact = {
      relative_path: relativePath,
      bytes: artifactBytes.length,
      sha256: artifactSha,
      execution_attempts: 2,
      write_action_after_recovery: taskEvidence.write_action
    };
    evidence.checks.independent_artifact_sha256_and_terminal_100_percent = 'PASS';

    const jobs = completed.jobs;
    assert.equal(jobs.length, 3);
    assert.deepEqual(jobs.map(job => job.operation).sort(), ['mission.plan', 'mission.verify', 'task.execute']);
    assert.equal(jobs.find(job => job.operation === 'mission.plan').status, 'cancelled');
    assert.equal(jobs.find(job => job.operation === 'mission.plan').last_error, 'superseded_by_package3_scoped_static_plan');
    assert.ok(jobs.filter(job => job.operation !== 'mission.plan').every(job => job.status === 'completed'));
    assert.equal(jobs.find(job => job.operation === 'task.execute').attempts, 2);
    const eventTypes = completed.events.map(event => event.type);
    for (const type of ['mission_created', 'mission_plan_submitted', 'task_started', 'task_succeeded', 'mission_verified_complete']) {
      assert.equal(eventTypes.filter(value => value === type).length, 1, 'duplicate or missing lifecycle event: ' + type);
    }
    assert.equal(completed.events.length, 5);
    assert.equal(completed.notifications.length, 1);
    assert.equal(completed.notifications[0].status, 'suppressed_package3_probe');
    assert.equal(completed.notifications[0].attempts, 0);
    evidence.checks.no_duplicate_jobs_events_or_external_notifications = 'PASS';

    const probeMission = await api('/api/missions/' + encodeURIComponent(missionId), { expectedStatus: 200 });
    assert.equal(probeMission.data.mission.metadata.probe_id, PROBE_ID);
    evidence.checks.single_probe_mission_in_durable_object = 'PASS';

    const closed = await api('/api/package3/probe/close', {
      method: 'POST',
      body: { probe_id: PROBE_ID, reason: 'live_e2e_verified' },
      expectedStatus: 200
    });
    scopeClosed = true;
    assert.equal(closed.data.scope.status, 'closed');
    assert.equal(closed.data.scope.claim_count, 3);
    assert.ok(closed.data.scope.scope_token_revoked_at);
    assert.equal(closed.data.mission.status, 'succeeded');
    evidence.checks.scope_revoked_and_closed = 'PASS';

    const frozenCreateAfter = await api('/api/missions', {
      method: 'POST',
      body: { goal: 'ordinary mission must remain frozen after the Package 3 probe' },
      expectedStatus: 423
    });
    assert.equal(frozenCreateAfter.data.error, 'mission_execution_paused');
    const frozenClaimAfter = await api('/api/worker/claim', {
      method: 'POST',
      token: WORKER_TOKEN,
      body: { worker_id: 'ordinary-worker-after-probe' },
      expectedStatus: 423
    });
    assert.equal(frozenClaimAfter.data.error, 'mission_execution_paused');
    const closedScopeClaim = await api('/api/worker/claim', {
      method: 'POST',
      token: WORKER_TOKEN,
      probeId: PROBE_ID,
      scopeToken,
      body: { worker_id: afterWorkerId },
      expectedStatus: 423
    });
    assert.equal(closedScopeClaim.data.error, 'mission_execution_paused');
    evidence.checks.global_freeze_and_worker_denylist_restored = 'PASS';

    const finalHealth = await api('/health', { expectedStatus: 200 });
    assert.equal(finalHealth.data.storage, 'durable-object');
    evidence.result = 'PASS';
  } catch (error) {
    evidence.result = 'FAIL';
    evidence.error = String(error && error.stack || error).slice(0, 6000);
    throw error;
  } finally {
    await killWorker(workerBefore).catch(() => {});
    await killWorker(workerAfter).catch(() => {});
    if (!scopeClosed) {
      try {
        const existingScope = await api('/api/package3/probes/' + PROBE_ID);
        if (existingScope.status === 404) {
          // The start request never persisted a scope, so no mission can be claimed.
          scopeClosed = true;
          evidence.cleanup = 'NO_SCOPE_CREATED';
        } else if (existingScope.status === 200) {
          const cleanup = await api('/api/package3/probe/close', {
            method: 'POST',
            body: { probe_id: PROBE_ID, reason: 'workflow_finally_cleanup' },
            expectedStatus: 200
          });
          scopeClosed = cleanup.data.scope.status === 'closed';
          evidence.cleanup = scopeClosed ? 'PASS' : 'INCOMPLETE';
        } else {
          throw new Error('unexpected_scope_cleanup_readback_http_' + existingScope.status);
        }
      } catch (error) {
        evidence.cleanup = 'FAILED';
        evidence.cleanup_error = String(error && error.message || error).slice(0, 1000);
      }
    }
    await fsp.rm(leaseEvidenceDir, { recursive: true, force: true }).catch(() => {});
    evidence.scope_closed = scopeClosed;
    evidence.completed_at = new Date().toISOString();
    await fsp.mkdir(path.dirname(EVIDENCE_PATH), { recursive: true });
    await fsp.writeFile(EVIDENCE_PATH, JSON.stringify(evidence, null, 2), 'utf8');
  }

  if (evidence.result !== 'PASS' || evidence.cleanup === 'FAILED') {
    throw new Error('PACKAGE3_LIVE_E2E_NOT_CLOSED');
  }
  for (const [name, value] of Object.entries(evidence.checks)) {
    process.stdout.write('PACKAGE3_LIVE_' + name.toUpperCase() + '=' + value + '\n');
  }
  process.stdout.write('PACKAGE3_LIVE_DURABLE_OBJECT_E2E=PASS\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
