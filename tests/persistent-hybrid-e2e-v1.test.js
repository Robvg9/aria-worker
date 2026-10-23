'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJsonMissionStore, createPersistentAutonomy } = require('../autonomy/persistent-control-plane-v1');
const {
  createPersistentWorkerBridge,
  createWorkerBackedExecutor,
  createWorkerBackedPlanner,
  createWorkerBackedVerifier
} = require('../autonomy/persistent-worker-bridge-v1');
const { createPersistentHttpServer } = require('../autonomy/persistent-http-server-v1');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-hybrid-e2e-v1-'));
  const token = 'dashboard-test-token-'.padEnd(40, 'x');
  const workerToken = 'worker-test-token-'.padEnd(40, 'y');
  const store = createJsonMissionStore({ directory });
  const bridge = createPersistentWorkerBridge({ directory, leaseMs: 10000 });
  const autonomy = createPersistentAutonomy({
    store,
    plan: createWorkerBackedPlanner({ bridge, timeoutMs: 1500, pollMs: 250 }),
    executeTask: createWorkerBackedExecutor({ bridge, timeoutMs: 5000, pollMs: 250 }),
    verifyCompletion: createWorkerBackedVerifier({ bridge, timeoutMs: 1500, pollMs: 250 }),
    notify: async () => {},
    deferPlanning: true
  });
  const app = createPersistentHttpServer({
    store, autonomy, token, workerBridge: bridge, workerToken,
    host: '127.0.0.1', port: 0, runSupervisor: true,
    supervisorIntervalMs: 500, notify: async () => {}
  });
  let stopWorker = false;
  const address = await app.listen();
  const baseUrl = 'http://127.0.0.1:' + address.port;
  const workerId = 'e2e-windows-worker';
  const workerLoop = (async () => {
    while (!stopWorker) {
      const job = await bridge.claimNext({ worker_id: workerId, capabilities: ['ollama', 'workspace'] });
      if (!job) { await sleep(10); continue; }
      let result;
      if (job.task.operation === 'mission.plan') {
        result = {
          passed: true,
          evidence: {
            tasks: [{
              task_id: 'inspect-workspace',
              title: 'Inspect workspace',
              operation: 'workspace.read',
              payload: { path: 'README.md' },
              risk: 'low',
              idempotent: true,
              depends_on: []
            }]
          }
        };
      } else if (job.task.operation === 'mission.verify') {
        const mission = job.context.mission;
        result = {
          passed: true,
          evidence: {
            verification: {
              passed: Array.isArray(mission.tasks) && mission.tasks.length === 1 && mission.tasks[0].status === 'succeeded' && mission.tasks[0].evidence.length > 0,
              reason: 'The simulated Windows worker returned evidence for the planned task.'
            }
          }
        };
      } else {
        result = { passed: true, evidence: { worker_id: workerId, operation: job.task.operation, path: job.task.payload && job.task.payload.path, verified: true } };
      }
      await bridge.complete(job.job_id, { worker_id: workerId, lease_token: job.lease_token, result });
    }
  })();

  try {
    const createdResponse = await fetch(baseUrl + '/api/missions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Inspect the workspace and report verified evidence.' })
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).mission;
    assert.equal(created.status, 'planning');
    assert.equal(created.tasks.length, 0);

    let completed = null;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const response = await fetch(baseUrl + '/api/missions/' + encodeURIComponent(created.mission_id), {
        headers: { authorization: 'Bearer ' + token }
      });
      const data = await response.json();
      if (data.mission && ['succeeded', 'waiting_human', 'failed'].includes(data.mission.status)) {
        completed = data.mission;
        break;
      }
      await sleep(100);
    }
    assert.ok(completed, 'mission should reach a terminal or human-gate state before timeout');
    assert.equal(completed.status, 'succeeded', JSON.stringify(completed));
    assert.equal(completed.progress_percent, 100);
    assert.equal(completed.tasks[0].status, 'succeeded');
    assert.equal(completed.tasks[0].evidence[0].verified, true);
    assert.equal(completed.verification.passed, true);
    assert.ok((await store.events(created.mission_id)).some(event => event.type === 'mission_verified_complete'));

    const unauthorized = await fetch(baseUrl + '/api/missions', { headers: { authorization: 'Bearer wrong-token' } });
    assert.equal(unauthorized.status, 401);
    process.stdout.write('persistent-hybrid-e2e-v1: all tests passed\n');
  } finally {
    await app.close();
    stopWorker = true;
    await workerLoop;
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
