'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CONTROL_TOKEN = 'package3-isolated-control-token'.padEnd(48, 'c');
const WORKER_TOKEN = 'package3-isolated-worker-token'.padEnd(48, 'w');
const CONTENT = 'Mission Wonder 2 Package 3 — isolated artifact — v1\n';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
  }
  async get(key) {
    const value = this.values.get(key);
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  async put(key, value) {
    this.values.set(key, JSON.parse(JSON.stringify(value)));
  }
  async list({ prefix = '' } = {}) {
    return new Map(Array.from(this.values.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
  }
  async setAlarm(value) {
    this.alarmAt = value;
  }
}

class TestState {
  constructor(storage = new MemoryStorage()) {
    this.storage = storage;
    this.pending = [];
  }
  waitUntil(promise) {
    this.pending.push(Promise.resolve(promise));
  }
}

function waitForExit(child, timeoutMs = 5000) {
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

async function waitUntil(predicate, description, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await sleep(25);
  }
  throw new Error('timeout_waiting_for_' + description);
}

async function readJson(response, expectedStatus = 200) {
  assert.equal(response.status, expectedStatus, await response.clone().text());
  return response.json();
}

(async () => {
  const { AriaMissionStore, MISSION_EXECUTION_PAUSED } = await import('../cloudflare-autonomy/worker.mjs');
  assert.equal(MISSION_EXECUTION_PAUSED, true, 'production Worker must stay globally frozen');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-package3-process-e2e-'));
  const artifactPath = path.join(root, 'package3-proof.txt');
  const attemptsPath = path.join(root, 'execution-attempts.json');
  const firstSignal = path.join(root, 'first-execution-started');
  const secondSignal = path.join(root, 'second-execution-started');
  const continueSignal = path.join(root, 'continue-recovered-worker');
  const adapterPath = path.join(root, 'package3-e2e-adapter.cjs');
  const workerPath = path.join(__dirname, '..', 'scripts', 'aria-persistent-windows-worker-v1.js');

  const adapterSource = [
    "'use strict';",
    "const crypto = require('node:crypto');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const workspace = process.env.ARIA_WORKSPACE_ROOT;",
    "const artifactPath = path.join(workspace, 'package3-proof.txt');",
    "const attemptsPath = process.env.PACKAGE3_E2E_ATTEMPTS_FILE;",
    "const firstSignal = process.env.PACKAGE3_E2E_FIRST_SIGNAL;",
    "const secondSignal = process.env.PACKAGE3_E2E_SECOND_SIGNAL;",
    "const continueSignal = process.env.PACKAGE3_E2E_CONTINUE_SIGNAL;",
    "const content = process.env.PACKAGE3_E2E_CONTENT;",
    "const delay = ms => new Promise(resolve => setTimeout(resolve, ms));",
    "function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }",
    "function countAttempts() {",
    "  try { return JSON.parse(fs.readFileSync(attemptsPath, 'utf8')).count || 0; }",
    "  catch (error) { if (error.code === 'ENOENT') return 0; throw error; }",
    "}",
    "module.exports = Object.freeze({",
    "  supabaseIndependent: true,",
    "  capabilities: Object.freeze(['workspace']),",
    "  async health() { return { ok: true, model: 'isolated-package3-fixture' }; },",
    "  async plan(goal) {",
    "    if (!String(goal).includes('package 3 isolated E2E')) throw new Error('unexpected_mission_goal');",
    "    return [{",
    "      task_id: 'write-proof-artifact',",
    "      title: 'Create isolated proof artifact',",
    "      operation: 'workspace.write',",
    "      payload: { relative_path: 'package3-proof.txt', content },",
    "      risk: 'medium',",
    "      idempotent: true,",
    "      max_attempts: 3,",
    "      depends_on: []",
    "    }];",
    "  },",
    "  async executeTask(task) {",
    "    if (!task || task.operation !== 'workspace.write') throw new Error('unexpected_task_operation');",
    "    if (task.payload.relative_path !== 'package3-proof.txt' || task.payload.content !== content) {",
    "      throw new Error('artifact_path_or_content_rejected');",
    "    }",
    "    const current = fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, 'utf8') : null;",
    "    let writeAction = 'already_identical';",
    "    if (current !== content) {",
    "      const temporary = artifactPath + '.tmp';",
    "      fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'w' });",
    "      fs.renameSync(temporary, artifactPath);",
    "      writeAction = 'atomic_create';",
    "    }",
    "    const attempts = countAttempts() + 1;",
    "    fs.writeFileSync(attemptsPath, JSON.stringify({ count: attempts }), 'utf8');",
    "    if (attempts === 1) {",
    "      fs.writeFileSync(firstSignal, 'claimed-and-written');",
    "      await new Promise(() => {});",
    "    }",
    "    if (attempts === 2) {",
    "      fs.writeFileSync(secondSignal, 'reclaimed-after-restart');",
    "      while (!fs.existsSync(continueSignal)) await delay(20);",
    "    }",
    "    const bytes = fs.readFileSync(artifactPath);",
    "    return {",
    "      passed: true,",
    "      evidence: { relative_path: 'package3-proof.txt', bytes: bytes.length, sha256: digest(bytes), write_action: writeAction, execution_attempt: attempts }",
    "    };",
    "  },",
    "  async verifyCompletion(mission) {",
    "    const task = (mission.tasks || []).find(item => item.task_id === 'write-proof-artifact');",
    "    const evidence = task && task.evidence && task.evidence[0];",
    "    const bytes = fs.readFileSync(artifactPath);",
    "    const actualHash = digest(bytes);",
    "    const passed = Boolean(task && task.status === 'succeeded' && evidence &&",
    "      bytes.toString('utf8') === content && evidence.sha256 === actualHash &&",
    "      evidence.relative_path === 'package3-proof.txt');",
    "    return {",
    "      passed,",
    "      reason: passed ? 'Independent filesystem read and SHA-256 match the completed task evidence.' : 'Artifact verification mismatch.',",
    "      artifact: { relative_path: 'package3-proof.txt', bytes: bytes.length, sha256: actualHash, independent_read: true }",
    "    };",
    "  }",
    "});"
  ].join('\n');

  const storage = new MemoryStorage();
  const state = new TestState(storage);
  const env = {
    ARIA_CONTROL_TOKEN: CONTROL_TOKEN,
    ARIA_WORKER_TOKEN: WORKER_TOKEN,
    ARIA_WORKER_LEASE_MS: '60000',
    ARIA_ALARM_INTERVAL_MS: '5000'
  };
  class IsolatedMissionStore extends AriaMissionStore {
    isMissionExecutionPaused() { return false; }
  }
  let activeStore = new IsolatedMissionStore(state, env);
  let server = null;
  let workerBefore = null;
  let workerAfter = null;
  let workerBeforeOutput = '';
  let workerAfterOutput = '';

  function startWorker(workerId) {
    const child = spawn(process.execPath, [workerPath], {
      cwd: root,
      env: {
        ...process.env,
        ARIA_CONTROL_URL: baseUrl,
        ARIA_WORKER_TOKEN: WORKER_TOKEN,
        ARIA_AUTONOMY_ADAPTER: adapterPath,
        ARIA_WORKSPACE_ROOT: root,
        ARIA_WORKER_ID: workerId,
        ARIA_WORKER_POLL_MS: '500',
        ARIA_WORKER_HEARTBEAT_MS: '5000',
        PACKAGE3_E2E_ATTEMPTS_FILE: attemptsPath,
        PACKAGE3_E2E_FIRST_SIGNAL: firstSignal,
        PACKAGE3_E2E_SECOND_SIGNAL: secondSignal,
        PACKAGE3_E2E_CONTINUE_SIGNAL: continueSignal,
        PACKAGE3_E2E_CONTENT: CONTENT
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => {
      if (workerId === 'package3-worker-before-restart') workerBeforeOutput += chunk.toString();
      else workerAfterOutput += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      if (workerId === 'package3-worker-before-restart') workerBeforeOutput += chunk.toString();
      else workerAfterOutput += chunk.toString();
    });
    return child;
  }

  let baseUrl = '';
  try {
    await fs.writeFile(adapterPath, adapterSource, 'utf8');
    server = http.createServer(async (incoming, outgoing) => {
      try {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
        const rawBody = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : String(value));
        }
        const request = new Request('http://127.0.0.1' + incoming.url, {
          method: incoming.method,
          headers,
          body: ['GET', 'HEAD'].includes(incoming.method) ? undefined : rawBody
        });
        const response = await activeStore.fetch(request);
        outgoing.statusCode = response.status;
        response.headers.forEach((value, name) => outgoing.setHeader(name, value));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        outgoing.statusCode = 500;
        outgoing.setHeader('content-type', 'application/json');
        outgoing.end(JSON.stringify({ error: String(error.message || error) }));
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    baseUrl = 'http://127.0.0.1:' + address.port;

    async function api(route, { method = 'GET', token = CONTROL_TOKEN, body, headers = {} } = {}) {
      return fetch(baseUrl + route, {
        method,
        headers: {
          authorization: 'Bearer ' + token,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    }

    const idempotencyKey = 'package3-e2e-' + crypto.randomUUID();
    const requestBody = {
      goal: 'Run package 3 isolated E2E and create a verified local artifact.',
      metadata: { mission: 'Mission Wonder 2', package: 3, environment: 'isolated-test' },
      policy: { max_risk: 'medium', require_human_approval: true, max_steps: 2 }
    };
    const createdResponse = await api('/api/missions', {
      method: 'POST',
      body: requestBody,
      headers: { 'Idempotency-Key': idempotencyKey }
    });
    const createdPayload = await readJson(createdResponse, 201);
    const missionId = createdPayload.mission.mission_id;
    assert.match(missionId, /^mission_/);
    assert.equal(createdPayload.mission.status, 'planning');

    // Simulate a Durable Object instance recreation before the first worker run.
    activeStore = new IsolatedMissionStore(state, env);
    const replayResponse = await api('/api/missions', {
      method: 'POST',
      body: requestBody,
      headers: { 'Idempotency-Key': idempotencyKey }
    });
    const replayPayload = await readJson(replayResponse, 200);
    assert.equal(replayPayload.idempotent_replay, true);
    assert.equal(replayPayload.mission.mission_id, missionId);

    const conflictResponse = await api('/api/missions', {
      method: 'POST',
      body: { ...requestBody, goal: requestBody.goal + ' altered' },
      headers: { 'Idempotency-Key': idempotencyKey }
    });
    const conflictPayload = await readJson(conflictResponse, 409);
    assert.equal(conflictPayload.error, 'idempotency_key_conflict');

    let missions = await storage.list({ prefix: 'mission:' });
    let jobs = await storage.list({ prefix: 'job:' });
    assert.equal(missions.size, 1, 'idempotent create replay must not duplicate a mission');
    assert.equal(jobs.size, 1, 'idempotent create replay must not duplicate the plan job');

    workerBefore = startWorker('package3-worker-before-restart');
    await waitUntil(() => fsSync.existsSync(firstSignal), 'first_worker_task_execution_started');
    jobs = await storage.list({ prefix: 'job:' });
    const interruptedJob = Array.from(jobs.values()).find(job => job.operation === 'task.execute');
    assert.ok(interruptedJob, 'the real worker process must claim the planned task');
    assert.equal(interruptedJob.status, 'leased');
    assert.equal(interruptedJob.attempts, 1);
    assert.equal(interruptedJob.worker_id, 'package3-worker-before-restart');
    const oldJobId = interruptedJob.job_id;
    const oldLeaseToken = interruptedJob.lease_token;

    workerBefore.kill('SIGKILL');
    await waitForExit(workerBefore);

    // Recreate the coordinator object while preserving its durable storage.
    activeStore = new IsolatedMissionStore(state, env);
    const expiredJob = await storage.get('job:' + oldJobId);
    expiredJob.lease_until = new Date(Date.now() - 1000).toISOString();
    await storage.put('job:' + oldJobId, expiredJob);

    workerAfter = startWorker('package3-worker-after-restart');
    await waitUntil(() => fsSync.existsSync(secondSignal), 'recovered_worker_task_execution_started');
    const recoveredJob = await storage.get('job:' + oldJobId);
    assert.equal(recoveredJob.job_id, oldJobId, 'recovery must reuse the original job, not enqueue a duplicate');
    assert.equal(recoveredJob.status, 'leased');
    assert.equal(recoveredJob.attempts, 2);
    assert.equal(recoveredJob.worker_id, 'package3-worker-after-restart');
    assert.notEqual(recoveredJob.lease_token, oldLeaseToken, 'recovered lease must have a new fencing token');

    const staleCompletion = await api('/api/worker/jobs/' + encodeURIComponent(oldJobId) + '/complete', {
      method: 'POST',
      token: WORKER_TOKEN,
      body: {
        worker_id: 'package3-worker-before-restart',
        lease_token: oldLeaseToken,
        result: { passed: true, evidence: { stale_worker: true } }
      }
    });
    const stalePayload = await readJson(staleCompletion, 409);
    assert.equal(stalePayload.error, 'lease_mismatch', 'stale worker must be fenced after recovery');

    await fs.writeFile(continueSignal, 'allow-completion');
    await waitUntil(async () => {
      const response = await api('/api/missions/' + encodeURIComponent(missionId));
      if (!response.ok) return false;
      const payload = await response.json();
      return payload.mission && payload.mission.status === 'succeeded';
    }, 'mission_verified_terminal_state');

    // Stop the real worker process after it has completed execution and independent verification.
    workerAfter.kill('SIGTERM');
    await waitForExit(workerAfter);

    const finalMissionResponse = await api('/api/missions/' + encodeURIComponent(missionId));
    const finalPayload = await readJson(finalMissionResponse, 200);
    const mission = finalPayload.mission;
    assert.equal(mission.status, 'succeeded');
    assert.equal(mission.progress_percent, 100);
    assert.equal(mission.tasks.length, 1);
    assert.equal(mission.tasks[0].status, 'succeeded');
    assert.equal(mission.tasks[0].evidence.length, 1);
    assert.equal(mission.verification.passed, true);
    assert.equal(mission.verification.artifact.independent_read, true);

    const artifact = await fs.readFile(artifactPath);
    const evidence = mission.tasks[0].evidence[0];
    assert.equal(artifact.toString('utf8'), CONTENT);
    assert.equal(crypto.createHash('sha256').update(artifact).digest('hex'), evidence.sha256);
    assert.equal(mission.verification.artifact.sha256, evidence.sha256);

    const attemptState = JSON.parse(await fs.readFile(attemptsPath, 'utf8'));
    assert.equal(attemptState.count, 2, 'the interrupted idempotent task must be retried exactly once');

    jobs = await storage.list({ prefix: 'job:' });
    assert.equal(jobs.size, 3, 'exactly one plan, one task, and one verification job must exist');
    const jobValues = Array.from(jobs.values());
    assert.deepEqual(jobValues.map(job => job.operation).sort(), ['mission.plan', 'mission.verify', 'task.execute']);
    assert.ok(jobValues.every(job => job.status === 'completed'));
    assert.equal(jobValues.find(job => job.operation === 'task.execute').attempts, 2);

    missions = await storage.list({ prefix: 'mission:' });
    assert.equal(missions.size, 1);
    const events = await storage.list({ prefix: 'event:' + missionId + ':' });
    const eventValues = Array.from(events.values());
    for (const eventType of ['mission_created', 'mission_planned', 'task_started', 'task_succeeded', 'mission_verified_complete']) {
      assert.equal(eventValues.filter(event => event.type === eventType).length, 1, 'duplicate event: ' + eventType);
    }
    assert.equal(eventValues.length, 5, 'mission lifecycle must have one deterministic event per completed phase');

    const notices = await storage.list({ prefix: 'notification:' });
    assert.equal(Array.from(notices.values()).filter(item => item.event.type === 'mission_completed').length, 1);

    // The production class still returns 423 and cannot mutate this isolated store.
    const productionStore = new AriaMissionStore(state, env);
    const beforeFrozenAttempt = (await storage.list({ prefix: 'mission:' })).size;
    const frozenResponse = await productionStore.fetch(new Request('http://127.0.0.1/api/missions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + CONTROL_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'must remain frozen' })
    }));
    assert.equal(frozenResponse.status, 423);
    assert.equal((await storage.list({ prefix: 'mission:' })).size, beforeFrozenAttempt);

    assert.ok(workerAfterOutput.includes('ARIA Windows worker started: package3-worker-after-restart'));
    assert.ok(workerAfterOutput.includes('mission_execution_paused') === false);
    process.stdout.write('PACKAGE3_REAL_WORKER_PROCESS_E2E=PASS\n');
    process.stdout.write('PACKAGE3_IDEMPOTENT_MISSION_CREATE=PASS\n');
    process.stdout.write('PACKAGE3_RESTART_RECOVERY_SAME_JOB_NO_DUPLICATES=PASS\n');
    process.stdout.write('PACKAGE3_STALE_LEASE_FENCED=PASS\n');
    process.stdout.write('PACKAGE3_INDEPENDENT_ARTIFACT_VERIFICATION=PASS\n');
    process.stdout.write('PACKAGE3_MISSION_TERMINAL_SUCCEEDED_100_PERCENT=PASS\n');
    process.stdout.write('PACKAGE3_PRODUCTION_FREEZE_REMAINS_TRUE=PASS\n');
  } finally {
    for (const child of [workerBefore, workerAfter]) {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await waitForExit(child).catch(() => {});
      }
    }
    if (server) await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
