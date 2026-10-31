'use strict';

const assert = require('node:assert/strict');

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const CONTROL_TOKEN = 'package5-cloudflare-control-token'.padEnd(48, 'c');
const WORKER_TOKEN = 'package5-cloudflare-worker-token'.padEnd(48, 'w');

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.alarmAt = null;
  }
  async get(key) { return clone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, clone(value)); }
  async list({ prefix = '' } = {}) {
    return new Map(Array.from(this.values.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, clone(value)]));
  }
  async setAlarm(value) { this.alarmAt = value; }
}

const env = Object.freeze({
  ARIA_CONTROL_TOKEN: CONTROL_TOKEN,
  ARIA_WORKER_TOKEN: WORKER_TOKEN,
  ARIA_WORKER_LEASE_MS: '5000',
  ARIA_ALARM_INTERVAL_MS: '5000'
});

function createState(storage = new MemoryStorage()) {
  return { storage, pending: [], waitUntil(promise) { this.pending.push(Promise.resolve(promise)); } };
}

function makeStore(Store, state) {
  return new Store(state, env);
}

function request(path, { method = 'GET', token = CONTROL_TOKEN, body } = {}) {
  return new Request('https://aria-package5.invalid' + path, {
    method,
    headers: {
      authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function json(response) {
  return response.json();
}

async function claim(store, workerId) {
  const response = await store.fetch(request('/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: { worker_id: workerId, capabilities: ['ollama', 'workspace'] }
  }));
  assert.equal(response.status, 200);
  return (await json(response)).job;
}

async function complete(store, job, result, workerId = job.worker_id) {
  return store.fetch(request('/api/worker/jobs/' + encodeURIComponent(job.job_id) + '/complete', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: { worker_id: workerId, lease_token: job.lease_token, result }
  }));
}

async function expireLease(state, jobId) {
  const key = 'job:' + jobId;
  const job = await state.storage.get(key);
  assert.ok(job, 'leased job must be durable before simulating DO restart');
  job.lease_until = new Date(Date.now() - 1000).toISOString();
  await state.storage.put(key, job);
}

(async () => {
  const { AriaMissionStore, MISSION_EXECUTION_PAUSED } = await import('../cloudflare-autonomy/worker.mjs');
  assert.equal(MISSION_EXECUTION_PAUSED, false, 'temporary Package 5 branch is unpaused only for its controlled LIVE test');

  // The test-only subclass runs a disposable lifecycle against fake storage.
  // The temporary Package 5 branch is isolated from main and is re-frozen by
  // the workflow's always-run restore job after the physical E2E.
  class UnpausedTestMissionStore extends AriaMissionStore {
    isMissionExecutionPaused() { return false; }
  }

  const state = createState();
  let store = makeStore(UnpausedTestMissionStore, state);

  try {
    const createdResponse = await store.fetch(request('/api/missions', {
      method: 'POST',
      body: { goal: 'Verify Durable Object state survives instance recreation.' }
    }));
    assert.equal(createdResponse.status, 201);
    const created = (await json(createdResponse)).mission;
    assert.equal(created.status, 'planning');

    const firstPlanLease = await claim(store, 'do-worker-before-restart');
    assert.equal(firstPlanLease.operation, 'mission.plan');
    assert.equal(firstPlanLease.attempts, 1);
    const initialLeaseToken = firstPlanLease.lease_token;

    // Recreate the DO instance with the same durable storage. Existing job
    // remains leased and is not claimable before its lease expires.
    store = makeStore(UnpausedTestMissionStore, state);
    const restoredMissionResponse = await store.fetch(request('/api/missions/' + created.mission_id));
    assert.equal(restoredMissionResponse.status, 200);
    assert.equal((await json(restoredMissionResponse)).mission.status, 'planning');
    assert.equal(await claim(store, 'do-worker-too-early'), null);

    // Simulate downtime beyond the saved lease deadline, then recreate again.
    await expireLease(state, firstPlanLease.job_id);
    store = makeStore(UnpausedTestMissionStore, state);
    const recoveredPlanLease = await claim(store, 'do-worker-after-restart');
    assert.equal(recoveredPlanLease.job_id, firstPlanLease.job_id);
    assert.equal(recoveredPlanLease.attempts, 2);
    assert.notEqual(recoveredPlanLease.lease_token, initialLeaseToken);

    const stalePlanCompletion = await complete(store, firstPlanLease, {
      passed: true,
      evidence: { tasks: [{ task_id: 'stale', title: 'Must not apply', operation: 'workspace.read', payload: { path: 'stale.txt' }, idempotent: true }] }
    });
    assert.equal(stalePlanCompletion.status, 409, 'the previous DO/worker lease must be fenced');

    const planCompleted = await complete(store, recoveredPlanLease, {
      passed: true,
      evidence: {
        tasks: [{
          task_id: 'recoverable-read',
          title: 'Read a test fixture',
          operation: 'workspace.read',
          payload: { path: 'README.md' },
          idempotent: true,
          depends_on: []
        }]
      }
    });
    assert.equal(planCompleted.status, 200);
    assert.equal((await json(planCompleted)).mission.status, 'running');

    // Recreate the DO before task execution; expire and recover that job too.
    store = makeStore(UnpausedTestMissionStore, state);
    const firstTaskLease = await claim(store, 'task-worker-before-restart');
    assert.equal(firstTaskLease.operation, 'task.execute');
    await expireLease(state, firstTaskLease.job_id);
    store = makeStore(UnpausedTestMissionStore, state);
    const recoveredTaskLease = await claim(store, 'task-worker-after-restart');
    assert.equal(recoveredTaskLease.job_id, firstTaskLease.job_id);
    assert.equal(recoveredTaskLease.attempts, 2);
    assert.notEqual(recoveredTaskLease.lease_token, firstTaskLease.lease_token);

    const staleTaskCompletion = await complete(store, firstTaskLease, {
      passed: true,
      evidence: { stale_worker: true }
    });
    assert.equal(staleTaskCompletion.status, 409, 'stale task worker must not overwrite recovered result');

    const taskCompleted = await complete(store, recoveredTaskLease, {
      passed: true,
      evidence: { path: 'README.md', verified: true, recovered_after_do_restart: true }
    });
    assert.equal(taskCompleted.status, 200);

    // Verification and notification outbox also survive another instance swap.
    store = makeStore(UnpausedTestMissionStore, state);
    const verifyLease = await claim(store, 'verification-worker');
    assert.equal(verifyLease.operation, 'mission.verify');
    const verifyCompleted = await complete(store, verifyLease, {
      passed: true,
      evidence: { verification: { passed: true, reason: 'Recovered Durable Object work verified.' } }
    });
    assert.equal(verifyCompleted.status, 200);
    assert.equal((await json(verifyCompleted)).mission.status, 'succeeded');

    store = makeStore(UnpausedTestMissionStore, state);
    const finalMissionResponse = await store.fetch(request('/api/missions/' + created.mission_id));
    const finalMission = (await json(finalMissionResponse)).mission;
    assert.equal(finalMission.status, 'succeeded');
    assert.equal(finalMission.progress_percent, 100);
    assert.equal(finalMission.tasks[0].evidence[0].recovered_after_do_restart, true);

    const eventsResponse = await store.fetch(request('/api/missions/' + created.mission_id + '/events'));
    const events = (await json(eventsResponse)).events;
    assert.ok(events.some(event => event.type === 'mission_created'));
    assert.ok(events.some(event => event.type === 'mission_planned'));
    assert.ok(events.some(event => event.type === 'task_succeeded'));
    assert.ok(events.some(event => event.type === 'mission_verified_complete'));

    const notificationsResponse = await store.fetch(request('/api/notifications'));
    const notifications = (await json(notificationsResponse)).notifications;
    assert.ok(notifications.some(item =>
      item.event.type === 'mission_completed' && item.status === 'waiting_config'
    ), 'notification outbox must persist across Durable Object recreation');

    // Production class still rejects mutating operations, even with the
    // valid control token; GET health remains available.
    const frozenStore = makeStore(AriaMissionStore, state);
    assert.equal((await frozenStore.fetch(request('/health'))).status, 200);
    const frozenMutation = await frozenStore.fetch(request('/api/missions', {
      method: 'POST',
      body: { goal: 'must stay frozen' }
    }));
    assert.equal(frozenMutation.status, 423);
    assert.equal((await json(frozenMutation)).error, 'mission_execution_paused');

    process.stdout.write('cloudflare-autonomy-restart-recovery-v1: all tests passed\n');
  } catch (error) {
    throw error;
  }
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
