'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJsonMissionStore, createPersistentAutonomy } = require('../autonomy/persistent-control-plane-v1');
const {
  createPersistentWorkerBridge,
  createWorkerBackedPlanner,
  createWorkerBackedExecutor,
  createWorkerBackedVerifier
} = require('../autonomy/persistent-worker-bridge-v1');
const { createPersistentHttpServer } = require('../autonomy/persistent-http-server-v1');
const { classifyClaimError } = require('../autonomy/persistent-worker-error-policy-v1');

const CONTROL_TOKEN = 'recovery-control-token-'.padEnd(48, 'c');
const WORKER_TOKEN = 'recovery-worker-token-'.padEnd(48, 'w');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withDirectory(prefix, callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  try { await callback(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

function createLocalRuntime(directory) {
  const store = createJsonMissionStore({ directory });
  const bridge = createPersistentWorkerBridge({ directory, leaseMs: 10000 });
  let executions = 0;
  const autonomy = createPersistentAutonomy({
    store,
    plan: async () => [{
      task_id: 'restart-safe-read',
      title: 'Read a test fixture',
      operation: 'workspace.read',
      payload: { path: 'README.md' },
      risk: 'low',
      idempotent: true
    }],
    executeTask: async task => {
      executions += 1;
      return { passed: true, evidence: { operation: task.operation, path: task.payload.path, execution: executions } };
    },
    verifyCompletion: async mission => ({
      passed: mission.tasks.length === 1 &&
        mission.tasks[0].status === 'succeeded' &&
        mission.tasks[0].evidence.length > 0,
      reason: 'local restart recovery verification'
    }),
    notify: async () => {},
    deferPlanning: true
  });
  const app = createPersistentHttpServer({
    store,
    autonomy,
    token: CONTROL_TOKEN,
    workerBridge: bridge,
    workerToken: WORKER_TOKEN,
    host: '127.0.0.1',
    port: 0,
    runSupervisor: false,
    notify: async () => {}
  });
  return { store, bridge, autonomy, app, get executions() { return executions; } };
}

async function testCoordinatorRestartKeepsMissionLedgerAndEvents() {
  await withDirectory('aria-package5-coordinator-restart-', async directory => {
    let first = null;
    let second = null;
    try {
      first = createLocalRuntime(directory);
      const firstAddress = await first.app.listen();
      const firstBase = 'http://127.0.0.1:' + firstAddress.port;
      const createdResponse = await fetch(firstBase + '/api/missions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + CONTROL_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'Persist a local mission before worker availability.' })
      });
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()).mission;
      assert.equal(created.status, 'planning');
      assert.equal(created.tasks.length, 0);

      await first.app.close();
      first = null;

      second = createLocalRuntime(directory);
      const secondAddress = await second.app.listen();
      const secondBase = 'http://127.0.0.1:' + secondAddress.port;
      const listingResponse = await fetch(secondBase + '/api/missions', {
        headers: { authorization: 'Bearer ' + CONTROL_TOKEN }
      });
      assert.equal(listingResponse.status, 200);
      const listing = await listingResponse.json();
      assert.equal(listing.missions.length, 1);
      assert.equal(listing.missions[0].mission_id, created.mission_id);
      assert.equal(listing.missions[0].status, 'planning');

      const eventsResponse = await fetch(secondBase + '/api/missions/' + encodeURIComponent(created.mission_id) + '/events', {
        headers: { authorization: 'Bearer ' + CONTROL_TOKEN }
      });
      assert.equal(eventsResponse.status, 200);
      const eventsBeforeRecovery = (await eventsResponse.json()).events;
      assert.ok(eventsBeforeRecovery.some(event => event.type === 'mission_created'));

      const recovered = await second.autonomy.tick(created.mission_id);
      assert.equal(recovered.status, 'succeeded');
      assert.equal(recovered.progress_percent, 100);
      assert.equal(recovered.tasks[0].status, 'succeeded');
      assert.equal(recovered.tasks[0].evidence[0].operation, 'workspace.read');
      assert.equal(second.executions, 1);

      const reopenedStore = createJsonMissionStore({ directory });
      const durable = await reopenedStore.get(created.mission_id);
      assert.equal(durable.status, 'succeeded');
      assert.equal(durable.verification.passed, true);
      const finalEvents = await reopenedStore.events(created.mission_id);
      assert.ok(finalEvents.some(event => event.type === 'mission_plan_created'));
      assert.ok(finalEvents.some(event => event.type === 'mission_verified_complete'));
    } finally {
      if (first) await first.app.close();
      if (second) await second.app.close();
    }
  });
}

async function testBridgeRestartReclaimsExpiredLeaseAndFencesOldWorker() {
  await withDirectory('aria-package5-bridge-restart-', async directory => {
    const bridgeBeforeRestart = createPersistentWorkerBridge({ directory, leaseMs: 5000 });
    const queued = await bridgeBeforeRestart.enqueue({
      mission_id: 'mission_package5_bridge_restart',
      task: { task_id: 'recover-job', operation: 'workspace.read', payload: { path: 'README.md' }, idempotent: true },
      context: { goal: 'Recover an interrupted worker job.' }
    });
    const firstClaim = await bridgeBeforeRestart.claimNext({
      worker_id: 'worker-before-restart',
      capabilities: ['workspace']
    });
    assert.equal(firstClaim.job_id, queued.job_id);
    assert.equal(firstClaim.status, 'leased');
    assert.ok(firstClaim.lease_token);

    const heartbeat = await bridgeBeforeRestart.heartbeat(firstClaim.job_id, {
      worker_id: 'worker-before-restart',
      lease_token: firstClaim.lease_token
    });
    assert.ok(Date.parse(heartbeat.lease_until) > Date.now());

    const bridgeAfterRestart = createPersistentWorkerBridge({ directory, leaseMs: 5000 });
    assert.equal((await bridgeAfterRestart.get(firstClaim.job_id)).status, 'leased');
    assert.equal(await bridgeAfterRestart.claimNext({ worker_id: 'worker-too-early' }), null);

    // Simulate process downtime beyond the durable lease deadline, without
    // sleeping for the full lease window or contacting any external service.
    const jobPath = path.join(directory, 'worker-jobs', firstClaim.job_id + '.json');
    const persisted = JSON.parse(await fs.readFile(jobPath, 'utf8'));
    persisted.lease_until = new Date(Date.now() - 1000).toISOString();
    await fs.writeFile(jobPath, JSON.stringify(persisted, null, 2), 'utf8');

    const simultaneousClaims = await Promise.all([
      bridgeAfterRestart.claimNext({ worker_id: 'worker-after-restart-a', capabilities: ['workspace'] }),
      bridgeAfterRestart.claimNext({ worker_id: 'worker-after-restart-b', capabilities: ['workspace'] })
    ]);
    assert.equal(simultaneousClaims.filter(Boolean).length, 1);
    const recoveredClaim = simultaneousClaims.find(Boolean);
    assert.equal(recoveredClaim.job_id, firstClaim.job_id);
    assert.equal(recoveredClaim.status, 'leased');
    assert.equal(recoveredClaim.attempts, 2);
    assert.notEqual(recoveredClaim.lease_token, firstClaim.lease_token);

    await assert.rejects(
      () => bridgeBeforeRestart.complete(firstClaim.job_id, {
        worker_id: 'worker-before-restart',
        lease_token: firstClaim.lease_token,
        result: { passed: true, evidence: { stale_worker: true } }
      }),
      /worker_lease_mismatch/
    );

    const completed = await bridgeAfterRestart.complete(recoveredClaim.job_id, {
      worker_id: recoveredClaim.worker_id,
      lease_token: recoveredClaim.lease_token,
      result: { passed: true, evidence: { recovered_by: recoveredClaim.worker_id, verified: true } }
    });
    assert.equal(completed.status, 'succeeded');

    const bridgeAfterCompletion = createPersistentWorkerBridge({ directory, leaseMs: 5000 });
    const durable = await bridgeAfterCompletion.get(queued.job_id);
    assert.equal(durable.status, 'succeeded');
    assert.equal(durable.result.evidence.verified, true);
    assert.deepEqual(await bridgeAfterCompletion.waitForResult(queued.job_id), durable.result);
  });
}

async function createInterruptedMission(directory, goal, taskId, idempotent) {
  const initialStore = createJsonMissionStore({ directory });
  const created = await initialStore.create({
    goal,
    tasks: [{
      task_id: taskId,
      title: 'Task interrupted by simulated process shutdown',
      operation: 'workspace.read',
      payload: { path: 'README.md' },
      risk: 'low',
      idempotent
    }]
  });
  await initialStore.update(created.mission_id, mission => {
    mission.status = 'running';
    mission.tasks[0].status = 'running';
    mission.tasks[0].attempts = 1;
    mission.current_task_id = taskId;
  }, 'simulated_process_interruption');
  return created.mission_id;
}

async function testMissionRecoveryAfterStoreRecreationHonorsIdempotency() {
  await withDirectory('aria-package5-mission-restart-', async root => {
    const safeDirectory = path.join(root, 'safe');
    const unsafeDirectory = path.join(root, 'unsafe');
    const safeMissionId = await createInterruptedMission(
      safeDirectory, 'Recover an idempotent task after restart.', 'safe-read', true
    );
    const unsafeMissionId = await createInterruptedMission(
      unsafeDirectory, 'Pause an unsafe task after restart.', 'unsafe-read', false
    );

    let safeExecutions = 0;
    const safeStoreAfterRestart = createJsonMissionStore({ directory: safeDirectory });
    const safeAutonomyAfterRestart = createPersistentAutonomy({
      store: safeStoreAfterRestart,
      plan: async () => [],
      executeTask: async () => {
        safeExecutions += 1;
        return { passed: true, evidence: { recovered: true } };
      },
      verifyCompletion: async mission => ({
        passed: mission.tasks[0].status === 'succeeded' && mission.tasks[0].evidence.length > 0
      })
    });
    const safeResult = await safeAutonomyAfterRestart.tick(safeMissionId);
    assert.equal(safeResult.status, 'succeeded');
    assert.equal(safeExecutions, 1);
    assert.ok((await safeStoreAfterRestart.events(safeMissionId)).some(event => event.type === 'idempotent_task_recovered'));
    const safeFinalStore = createJsonMissionStore({ directory: safeDirectory });
    assert.equal((await safeFinalStore.get(safeMissionId)).status, 'succeeded');

    let unsafeExecutions = 0;
    const notices = [];
    const unsafeStoreAfterRestart = createJsonMissionStore({ directory: unsafeDirectory });
    const unsafeAutonomyAfterRestart = createPersistentAutonomy({
      store: unsafeStoreAfterRestart,
      plan: async () => [],
      executeTask: async () => {
        unsafeExecutions += 1;
        return { passed: true, evidence: { resumed_after_human_review: true } };
      },
      verifyCompletion: async mission => ({
        passed: mission.tasks[0].status === 'succeeded' && mission.tasks[0].evidence.length > 0
      }),
      notify: async event => notices.push(event)
    });
    const blocked = await unsafeAutonomyAfterRestart.tick(unsafeMissionId);
    assert.equal(blocked.status, 'waiting_human');
    assert.equal(unsafeExecutions, 0);
    assert.ok(notices.some(event => event.reason === 'interrupted_non_idempotent_task'));
    assert.ok((await unsafeStoreAfterRestart.events(unsafeMissionId)).some(event => event.type === 'recovery_requires_human_review'));

    const explicitlyResumed = await unsafeAutonomyAfterRestart.resume(unsafeMissionId, { actor: 'package5-test-reviewer' });
    assert.equal(explicitlyResumed.status, 'succeeded');
    assert.equal(explicitlyResumed.manual_resume_by, 'package5-test-reviewer');
    assert.equal(unsafeExecutions, 1);
    const unsafeFinalStore = createJsonMissionStore({ directory: unsafeDirectory });
    assert.equal((await unsafeFinalStore.get(unsafeMissionId)).status, 'succeeded');
  });
}

async function testActualWorkerProcessAgainstEphemeralCoordinator() {
  await withDirectory('aria-package5-worker-process-', async directory => {
    const workspace = path.join(directory, 'workspace');
    await fs.mkdir(workspace, { recursive: true });
    const adapterPath = path.join(directory, 'fixture-adapter.cjs');
    const adapterSource = `'use strict';
module.exports = {
  createAdapter: ({ workspaceRoot }) => ({
    supabaseIndependent: true,
    capabilities: ['ollama', 'workspace'],
    health: async () => ({ ok: true, model: 'package5-fixture-model' }),
    plan: async () => [{
      task_id: 'worker-process-read',
      title: 'Read a disposable fixture',
      operation: 'workspace.read',
      payload: { path: 'fixture.txt' },
      risk: 'low',
      idempotent: true
    }],
    executeTask: async task => ({
      passed: true,
      evidence: {
        operation: task.operation,
        path: task.payload.path,
        workspace_root: workspaceRoot,
        verified: true
      }
    }),
    verifyCompletion: async mission => ({
      passed: mission.tasks.length === 1 &&
        mission.tasks[0].status === 'succeeded' &&
        mission.tasks[0].evidence.length > 0
    })
  })
};
`;
    await fs.writeFile(adapterPath, adapterSource, 'utf8');

    const store = createJsonMissionStore({ directory });
    const bridge = createPersistentWorkerBridge({ directory, leaseMs: 10000 });
    const autonomy = createPersistentAutonomy({
      store,
      plan: createWorkerBackedPlanner({ bridge, timeoutMs: 12000, pollMs: 25 }),
      executeTask: createWorkerBackedExecutor({ bridge, timeoutMs: 12000, pollMs: 25 }),
      verifyCompletion: createWorkerBackedVerifier({ bridge, timeoutMs: 12000, pollMs: 25 }),
      notify: async () => {},
      deferPlanning: true
    });
    const app = createPersistentHttpServer({
      store,
      autonomy,
      token: CONTROL_TOKEN,
      workerBridge: bridge,
      workerToken: WORKER_TOKEN,
      host: '127.0.0.1',
      port: 0,
      runSupervisor: false,
      notify: async () => {}
    });

    let child = null;
    let childExit = null;
    let workerOutput = '';
    try {
      const address = await app.listen();
      child = spawn(process.execPath, [
        path.join(__dirname, '..', 'scripts', 'aria-persistent-windows-worker-v1.js')
      ], {
        env: {
          ...process.env,
          ARIA_CONTROL_URL: 'http://127.0.0.1:' + address.port,
          ARIA_WORKER_TOKEN: WORKER_TOKEN,
          ARIA_AUTONOMY_ADAPTER: adapterPath,
          ARIA_WORKSPACE_ROOT: workspace,
          ARIA_OLLAMA_MODEL: 'package5-fixture-model',
          ARIA_WORKER_POLL_MS: '25',
          ARIA_WORKER_HEARTBEAT_MS: '5000'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', chunk => { workerOutput += chunk.toString(); });
      child.stderr.on('data', chunk => { workerOutput += chunk.toString(); });
      childExit = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });

      const created = await autonomy.start({ goal: 'Run a disposable local mission through the real worker process.' });
      assert.equal(created.status, 'planning');
      const completed = await autonomy.tick(created.mission_id, { max_steps: 8, max_runtime_ms: 20000 });
      assert.equal(completed.status, 'succeeded', workerOutput);
      assert.equal(completed.progress_percent, 100);
      assert.equal(completed.tasks.length, 1);
      assert.equal(completed.tasks[0].status, 'succeeded');
      assert.equal(completed.tasks[0].evidence[0].verified, true);
      assert.equal(completed.verification.passed, true);
      assert.ok(workerOutput.includes('ARIA Windows worker started:'));
      assert.ok(workerOutput.includes('Reported result for'));
      assert.equal(workerOutput.includes(WORKER_TOKEN), false);
      assert.equal((await bridge.list()).every(job => job.status === 'succeeded'), true);
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const result = await Promise.race([
          childExit,
          sleep(3000).then(() => { throw new Error('temporary worker process did not stop'); })
        ]);
        assert.equal(result.code, 0, workerOutput);
      }
      await app.close();
    }
  });
}

async function testWorkerPauseAndAuthErrorsAreTerminalButTransientFailuresRetry() {
  const workerSource = await fs.readFile(path.join(__dirname, '..', 'scripts', 'aria-persistent-windows-worker-v1.js'), 'utf8');
  assert.match(workerSource, /classifyClaimError\(error\)/);
  assert.match(workerSource, /claimPolicy\.action === 'stop'/);
  assert.match(workerSource, /stopping = true;\s*break;/);
  assert.deepEqual(
    classifyClaimError(new Error('coordinator_http_423:mission_execution_paused')),
    { action: 'stop', reason: 'MISSION_EXECUTION_PAUSED', exitCode: 0 }
  );
  assert.deepEqual(
    classifyClaimError(new Error('coordinator_http_401:worker_unauthorized')),
    { action: 'stop', reason: 'AUTHENTICATION_REJECTED', exitCode: 1 }
  );
  assert.deepEqual(
    classifyClaimError(new Error('coordinator_http_403:forbidden')),
    { action: 'stop', reason: 'AUTHENTICATION_REJECTED', exitCode: 1 }
  );
  assert.deepEqual(
    classifyClaimError(new Error('coordinator_http_429:rate_limited')),
    { action: 'retry', reason: 'RETRYABLE_HTTP_429', exitCode: 0 }
  );
  assert.deepEqual(
    classifyClaimError(new Error('coordinator_http_503:temporarily_unavailable')),
    { action: 'retry', reason: 'RETRYABLE_HTTP_503', exitCode: 0 }
  );
  assert.deepEqual(
    classifyClaimError(new Error('fetch failed')),
    { action: 'retry', reason: 'TRANSIENT_OR_UNKNOWN', exitCode: 0 }
  );
  assert.deepEqual(
    classifyClaimError(new Error('coordinator_http_400:invalid_request')),
    { action: 'stop', reason: 'NON_RETRYABLE_HTTP_400', exitCode: 1 }
  );
}

(async () => {
  await testCoordinatorRestartKeepsMissionLedgerAndEvents();
  await testBridgeRestartReclaimsExpiredLeaseAndFencesOldWorker();
  await testMissionRecoveryAfterStoreRecreationHonorsIdempotency();
  await testActualWorkerProcessAgainstEphemeralCoordinator();
  await testWorkerPauseAndAuthErrorsAreTerminalButTransientFailuresRetry();
  process.stdout.write('persistent-recovery-e2e-v1: all tests passed\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
