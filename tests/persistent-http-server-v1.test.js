'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createJsonMissionStore, createPersistentAutonomy } = require('../autonomy/persistent-control-plane-v1');
const { createPersistentHttpServer } = require('../autonomy/persistent-http-server-v1');
const { createPersistentWorkerBridge } = require('../autonomy/persistent-worker-bridge-v1');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-http-v1-'));
  const token = 'test-token-with-at-least-32-characters-long';
  const workerToken = 'test-worker-token-with-at-least-32-characters';
  const store = createJsonMissionStore({ directory });
  const autonomy = createPersistentAutonomy({
    store,
    plan: async goal => [{ title: 'Execute: ' + goal, risk: 'low' }],
    executeTask: async task => ({ passed: true, evidence: { test: task.title } }),
    verifyCompletion: async mission => ({ passed: mission.tasks.every(task => task.status === 'succeeded') })
  });
  const workerBridge = createPersistentWorkerBridge({ directory, leaseMs: 10000 });
  const app = createPersistentHttpServer({ store, autonomy, token, workerBridge, workerToken, host: '127.0.0.1', port: 0, runSupervisor: false });
  try {
    const address = await app.listen();
    const base = 'http://127.0.0.1:' + address.port;
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).supabase_independent, true);
    const unauthorized = await fetch(base + '/api/missions');
    assert.equal(unauthorized.status, 401);
    const workerCannotReadControlPlane = await fetch(base + '/api/missions', {
      headers: { authorization: 'Bearer ' + workerToken }
    });
    assert.equal(workerCannotReadControlPlane.status, 401, 'worker token must not authorize control-plane API access');
    const controlCannotClaimWorkerJob = await fetch(base + '/api/worker/claim', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ worker_id: 'wrong-token-worker', capabilities: ['test'] })
    });
    assert.equal(controlCannotClaimWorkerJob.status, 401, 'control token must not authorize worker-bridge access');
    const dashboard = await fetch(base + '/');
    assert.equal(dashboard.status, 200);
    assert.match(await dashboard.text(), /ARIA Mission Control/);
    const createdResponse = await fetch(base + '/api/missions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'HTTP integration test' })
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.mission.goal, 'HTTP integration test');
    const listedResponse = await fetch(base + '/api/missions', { headers: { authorization: 'Bearer ' + token } });
    assert.equal(listedResponse.status, 200);
    assert.equal((await listedResponse.json()).missions.length, 1);
    const malformed = await fetch(base + '/api/missions', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: '{'
    });
    assert.equal(malformed.status, 400);
    await workerBridge.enqueue({ mission_id: created.mission.mission_id, task: { task_id: 'bridge-task', title: 'Bridge task' } });
    const claimResponse = await fetch(base + '/api/worker/claim', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + workerToken, 'content-type': 'application/json' },
      body: JSON.stringify({ worker_id: 'http-test-worker', capabilities: ['test'] })
    });
    assert.equal(claimResponse.status, 200);
    const claim = await claimResponse.json();
    assert.equal(claim.job.status, 'leased');
    const completeResponse = await fetch(base + '/api/worker/jobs/' + encodeURIComponent(claim.job.job_id) + '/complete', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + workerToken, 'content-type': 'application/json' },
      body: JSON.stringify({ worker_id: 'http-test-worker', lease_token: claim.job.lease_token, result: { passed: true, evidence: 'http-worker-test' } })
    });
    assert.equal(completeResponse.status, 200);
    assert.equal((await completeResponse.json()).job.status, 'succeeded');
    process.stdout.write('persistent-http-server-v1: all tests passed\\n');
  } finally {
    await app.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
