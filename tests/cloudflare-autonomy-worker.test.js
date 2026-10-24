'use strict';

const assert = require('node:assert/strict');
let AriaMissionStore;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
class MemoryStorage {
  constructor() { this.values = new Map(); this.alarmAt = null; }
  async get(key) { return clone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, clone(value)); }
  async list({ prefix = '' } = {}) {
    return new Map(Array.from(this.values.entries()).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, clone(value)]));
  }
  async setAlarm(value) { this.alarmAt = value; }
}
class MemoryState {
  constructor() { this.storage = new MemoryStorage(); this.pending = []; }
  waitUntil(promise) { this.pending.push(Promise.resolve(promise)); }
}
const controlToken = 'control-token-for-tests'.padEnd(40, 'c');
const workerToken = 'worker-token-for-tests'.padEnd(40, 'w');
function createStore(extraEnv = {}) {
  const state = new MemoryState();
  return { state, store: new AriaMissionStore(state, { ARIA_CONTROL_TOKEN: controlToken, ARIA_WORKER_TOKEN: workerToken, ARIA_WORKER_LEASE_MS: 60000, ...extraEnv }) };
}
function request(path, { method = 'GET', token = controlToken, body } = {}) {
  return new Request('https://aria-test.invalid' + path, {
    method,
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
async function body(response) { return response.json(); }
async function createMission(store, goal = 'Inspect and verify') {
  const response = await store.fetch(request('/api/missions', { method: 'POST', body: { goal } }));
  assert.equal(response.status, 201);
  return (await body(response)).mission;
}
async function claim(store, expectedOperation) {
  const response = await store.fetch(request('/api/worker/claim', { method: 'POST', token: workerToken, body: { worker_id: 'test-worker', capabilities: ['ollama', 'workspace'] } }));
  assert.equal(response.status, 200);
  const result = await body(response);
  assert.equal(result.job && result.job.operation, expectedOperation);
  return result.job;
}
async function complete(store, job, result) {
  return store.fetch(request('/api/worker/jobs/' + encodeURIComponent(job.job_id) + '/complete', {
    method: 'POST', token: workerToken,
    body: { worker_id: 'test-worker', lease_token: job.lease_token, result }
  }));
}

async function testAuthAndVerifiedMissionLifecycle() {
  const { store } = createStore();
  assert.equal((await store.fetch(request('/api/missions', { token: 'wrong-token' }))).status, 401);
  assert.equal((await store.fetch(request('/api/worker/claim', { method: 'POST', token: controlToken, body: { worker_id: 'bad' } }))).status, 401);

  const created = await createMission(store);
  assert.equal(created.status, 'planning');
  const planJob = await claim(store, 'mission.plan');
  const planResponse = await complete(store, planJob, {
    passed: true,
    evidence: { tasks: [{ task_id: 'readme', title: 'Read workspace README', operation: 'workspace.read', payload: { path: 'README.md' }, depends_on: [], idempotent: true }] }
  });
  assert.equal(planResponse.status, 200);
  const taskJob = await claim(store, 'task.execute');
  assert.equal(taskJob.task.operation, 'workspace.read');
  const taskResponse = await complete(store, taskJob, { passed: true, evidence: { path: 'README.md', bytes: 24, verified: true } });
  assert.equal(taskResponse.status, 200);
  const verifyJob = await claim(store, 'mission.verify');
  const verifyResponse = await complete(store, verifyJob, { passed: true, evidence: { verification: { passed: true, reason: 'The task evidence directly supports the goal.' } } });
  assert.equal(verifyResponse.status, 200);

  const missionResponse = await store.fetch(request('/api/missions/' + encodeURIComponent(created.mission_id)));
  const mission = (await body(missionResponse)).mission;
  assert.equal(mission.status, 'succeeded');
  assert.equal(mission.progress_percent, 100);
  assert.equal(mission.tasks[0].status, 'succeeded');
  const events = await store.fetch(request('/api/missions/' + encodeURIComponent(created.mission_id) + '/events'));
  assert.ok((await body(events)).events.some(event => event.type === 'mission_verified_complete'));
  const notices = await store.fetch(request('/api/notifications'));
  assert.ok((await body(notices)).notifications.some(item => item.event.type === 'mission_completed' && item.status === 'waiting_config'));
}

async function testIrreversibleTaskNeedsExplicitApproval() {
  const { store } = createStore();
  const mission = await createMission(store, 'Make an irreversible change only after approval');
  const planJob = await claim(store, 'mission.plan');
  await complete(store, planJob, {
    passed: true,
    evidence: { tasks: [{ task_id: 'irreversible', title: 'Irreversible change', operation: 'workspace.write', payload: { path: 'notes/approved.txt', content: 'approved' }, irreversible: true, idempotent: true, depends_on: [] }] }
  });
  const missionAfterGateResponse = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id)));
  let current = (await body(missionAfterGateResponse)).mission;
  assert.equal(current.status, 'waiting_human');
  assert.equal(current.approval.status, 'pending');
  const claimEmpty = await store.fetch(request('/api/worker/claim', { method: 'POST', token: workerToken, body: { worker_id: 'test-worker' } }));
  assert.equal((await body(claimEmpty)).job, null);

  const approval = await store.fetch(request('/api/approvals/' + encodeURIComponent(current.approval.approval_id), {
    method: 'POST', body: { decision: 'approved', actor: 'test-reviewer' }
  }));
  assert.equal(approval.status, 200);
  const taskJob = await claim(store, 'task.execute');
  assert.equal(taskJob.task.task_id, 'irreversible');
  await complete(store, taskJob, { passed: true, evidence: { approved: true, backup: 'notes/approved.txt.bak' } });
  const verifyJob = await claim(store, 'mission.verify');
  await complete(store, verifyJob, { passed: true, evidence: { verification: { passed: true, reason: 'Approved operation verified.' } } });
  const missionAfterApprovalResponse = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id)));
  current = (await body(missionAfterApprovalResponse)).mission;
  assert.equal(current.status, 'succeeded');
}


async function testNotificationPayloadAllowlistAndRetry() {
  const originalFetch = global.fetch;
  const payloads = [];
  let shouldFail = true;
  global.fetch = async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return shouldFail ? { ok: false, status: 503 } : { ok: true, status: 200 };
  };
  try {
    const { state, store } = createStore({
      ARIA_NOTIFICATION_WEBHOOK_URL: 'https://notify.example.test/aria',
      ARIA_NOTIFICATION_TOKEN: 'notification-secret-for-test'
    });
    const notice = await store.notify({
      type: 'human_intervention_required',
      mission_id: 'mission_safe',
      details: 'A human should review this.',
      secret_field: 'must-not-leave-the-coordinator'
    });
    await Promise.all(state.pending);
    let persisted = await state.storage.get('notification:' + notice.notification_id);
    assert.equal(persisted.status, 'pending');
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].type, 'human_intervention_required');
    assert.equal(payloads[0].mission_id, 'mission_safe');
    assert.equal(payloads[0].secret_field, undefined);
    assert.equal(JSON.stringify(payloads[0]).includes('notification-secret-for-test'), false);

    await store.scheduleAlarm();
    assert.ok(state.storage.alarmAt, 'pending notification must keep an alarm scheduled for retry');
    shouldFail = false;
    await store.alarm();
    persisted = await state.storage.get('notification:' + notice.notification_id);
    assert.equal(persisted.status, 'delivered');
    assert.equal(persisted.attempts, 2);
    assert.equal(payloads.length, 2);
    assert.equal(payloads[1].secret_field, undefined);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testRetryReplanAndLeaseProtection() {
  const { store } = createStore();
  const mission = await createMission(store, 'Recover a failed task by replanning');
  const planJob = await claim(store, 'mission.plan');
  await complete(store, planJob, {
    passed: true,
    evidence: { tasks: [{ task_id: 'unstable', title: 'Unstable task', operation: 'workspace.read', payload: { path: 'missing.txt' }, idempotent: false, max_attempts: 1, depends_on: [] }] }
  });
  const taskJob = await claim(store, 'task.execute');
  const failed = await complete(store, taskJob, { passed: false, error: 'hard failure' });
  assert.equal(failed.status, 200);
  await store.alarm();
  const replanJob = await claim(store, 'mission.replan');
  const stale = await complete(store, { ...replanJob, lease_token: 'stale-lease' }, { passed: true, evidence: { tasks: [] } });
  assert.equal(stale.status, 409);
  await complete(store, replanJob, {
    passed: true,
    evidence: { tasks: [{ task_id: 'recovery-step', title: 'Read a valid file', operation: 'workspace.read', payload: { path: 'README.md' }, idempotent: true, depends_on: [] }] }
  });
  const recoveryJob = await claim(store, 'task.execute');
  assert.equal(recoveryJob.task.task_id, 'recovery-step');
  await complete(store, recoveryJob, { passed: true, evidence: { path: 'README.md', verified: true } });
  const verifyJob = await claim(store, 'mission.verify');
  await complete(store, verifyJob, { passed: true, evidence: { verification: { passed: true, reason: 'Replanned work verified.' } } });
  const finalMissionResponse = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id)));
  const finalMission = (await body(finalMissionResponse)).mission;
  assert.equal(finalMission.status, 'succeeded');
  assert.equal(finalMission.progress_percent, 100);
}

(async () => {
  ({ AriaMissionStore } = await import('../cloudflare-autonomy/worker.mjs'));
  await testAuthAndVerifiedMissionLifecycle();
  await testIrreversibleTaskNeedsExplicitApproval();
  await testRetryReplanAndLeaseProtection();
  await testNotificationPayloadAllowlistAndRetry();
  process.stdout.write('cloudflare-autonomy-worker: all tests passed\n');
})().catch(err => {
  process.stderr.write((err && err.stack) || String(err));
  process.exitCode = 1;
});
