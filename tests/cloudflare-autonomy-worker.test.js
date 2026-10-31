'use strict';

const assert = require('node:assert/strict');
let AriaMissionStore;
let MISSION_EXECUTION_PAUSED;
let UnpausedTestMissionStore;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
class MemoryStorage {
  constructor() { this.values = new Map(); this.alarmAt = null; this.operationCounts = { get: 0, list: 0, put: 0, setAlarm: 0 }; }
  async get(key) { this.operationCounts.get += 1; return clone(this.values.get(key)); }
  async put(key, value) { this.operationCounts.put += 1; this.values.set(key, clone(value)); }
  async list({ prefix = '' } = {}) {
    this.operationCounts.list += 1;
    return new Map(Array.from(this.values.entries()).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, clone(value)]));
  }
  async setAlarm(value) { this.operationCounts.setAlarm += 1; this.alarmAt = value; }
  resetOperationCounts() { this.operationCounts = { get: 0, list: 0, put: 0, setAlarm: 0 }; }
}
class MemoryState {
  constructor() { this.storage = new MemoryStorage(); this.pending = []; }
  waitUntil(promise) { this.pending.push(Promise.resolve(promise)); }
}
const controlToken = 'control-token-for-tests'.padEnd(40, 'c');
const workerToken = 'worker-token-for-tests'.padEnd(40, 'w');
function createStore({ paused = false } = {}) {
  const state = new MemoryState();
  const Store = paused ? AriaMissionStore : UnpausedTestMissionStore;
  return { state, store: new Store(state, { ARIA_CONTROL_TOKEN: controlToken, ARIA_WORKER_TOKEN: workerToken, ARIA_WORKER_LEASE_MS: 60000 }) };
}
function request(path, { method = 'GET', token = controlToken, body } = {}) {
  return new Request('https://aria-test.invalid' + path, {
    method,
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
function rawRequest(path, { method = 'GET', token = controlToken, body = '{' } = {}) {
  return new Request('https://aria-test.invalid' + path, {
    method,
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body
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

async function testGlobalFreezeStopsMutationsAndAlarmRecovery() {
  assert.equal(MISSION_EXECUTION_PAUSED, true, 'the deployed coordinator must be frozen by default');
  const { state, store } = createStore({ paused: true });
  const now = new Date().toISOString();
  const mission = {
    mission_id: 'mission-preserved',
    goal: 'Preserve this historical mission without executing it',
    status: 'planning',
    tasks: [],
    created_at: now,
    updated_at: now,
    event_sequence: 0
  };
  const job = {
    job_id: 'job-preserved',
    mission_id: mission.mission_id,
    operation: 'mission.plan',
    status: 'leased',
    worker_id: 'existing-worker',
    lease_token: 'existing-lease-token',
    lease_until: new Date(Date.now() - 60000).toISOString(),
    attempts: 1,
    created_at: now,
    updated_at: now
  };
  const notification = {
    notification_id: 'notification-preserved',
    status: 'pending',
    attempts: 0,
    event: { type: 'preserve_pending_notice' },
    created_at: now,
    updated_at: now
  };
  state.storage.values.set('mission:' + mission.mission_id, clone(mission));
  state.storage.values.set('event:' + mission.mission_id + ':00000001', { mission_id: mission.mission_id, sequence: 1, type: 'historical' });
  state.storage.values.set('job:' + job.job_id, clone(job));
  state.storage.values.set('notification:' + notification.notification_id, clone(notification));
  state.storage.alarmAt = 123456789;
  const before = clone(Array.from(state.storage.values.entries()));
  const beforeAlarm = state.storage.alarmAt;
  state.storage.resetOperationCounts();

  const mutationRoutes = [
    ['/api/missions', controlToken],
    ['/api/missions/' + mission.mission_id + '/resume', controlToken],
    ['/api/approvals/approval-preserved', controlToken],
    ['/api/unrecognized-mutation', controlToken],
    ['/api/worker/claim', workerToken],
    ['/api/worker/jobs/' + job.job_id + '/heartbeat', workerToken],
    ['/api/worker/jobs/' + job.job_id + '/complete', workerToken],
    ['/api/worker/jobs/' + job.job_id + '/fail', workerToken]
  ];
  for (const [path, token] of mutationRoutes) {
    const response = await store.fetch(rawRequest(path, { method: 'POST', token, body: '{ malformed json' }));
    assert.equal(response.status, 423, path + ' must be rejected before body parsing or mutation');
    assert.equal((await body(response)).error, 'mission_execution_paused');
  }
  assert.equal((await store.fetch(rawRequest('/api/missions', { method: 'POST', token: 'invalid-control-token', body: '{' }))).status, 401);
  assert.equal((await store.fetch(rawRequest('/api/worker/claim', { method: 'POST', token: controlToken, body: '{' }))).status, 401);

  assert.equal((await store.fetch(request('/health'))).status, 200);
  assert.equal((await store.fetch(request('/api/missions'))).status, 200);
  assert.equal((await store.fetch(request('/api/missions/' + mission.mission_id))).status, 200);
  assert.equal((await store.fetch(request('/api/missions/' + mission.mission_id + '/events'))).status, 200);
  assert.equal((await store.fetch(request('/api/notifications'))).status, 200);
  assert.equal(state.storage.operationCounts.put, 0, 'GET requests must remain read-only');

  state.storage.resetOperationCounts();
  const originalFetch = global.fetch;
  let outboundRequests = 0;
  global.fetch = async () => { outboundRequests += 1; return new Response('unexpected', { status: 200 }); };
  try {
    await store.alarm();
    assert.equal(await store.reconcile(), false);
    assert.equal(await store.scheduleAlarm(), false);
    await assert.rejects(() => store.deliverNotification(notification.notification_id), /mission_execution_paused/);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(outboundRequests, 0, 'alarm/recovery must not deliver external notifications while frozen');

  const directMutationAttempts = [
    () => store.saveMission(mission, 'must_not_write'),
    () => store.notify({ type: 'must_not_write' }),
    () => store.createJob(mission, 'mission.plan', null),
    () => store.createMission(rawRequest('/api/missions', { method: 'POST', body: '{}' })),
    () => store.claim(rawRequest('/api/worker/claim', { method: 'POST', token: workerToken, body: '{}' })),
    () => store.heartbeat(job.job_id, rawRequest('/heartbeat', { method: 'POST', token: workerToken, body: '{}' })),
    () => store.complete(job.job_id, rawRequest('/complete', { method: 'POST', token: workerToken, body: '{}' })),
    () => store.fail(job.job_id, rawRequest('/fail', { method: 'POST', token: workerToken, body: '{}' })),
    () => store.failAfterResult(job, mission, 'must_not_mutate'),
    () => store.handleTaskFailure(job, mission, { task_id: 'task', status: 'pending', attempts: 0, max_attempts: 1 }, 'must_not_mutate'),
    () => store.scheduleNext(mission),
    () => store.decideApproval('approval-preserved', rawRequest('/approval', { method: 'POST', body: '{}' })),
    () => store.resume(mission.mission_id, rawRequest('/resume', { method: 'POST', body: '{}' }))
  ];
  for (const attempt of directMutationAttempts) {
    await assert.rejects(attempt, /mission_execution_paused/);
  }

  assert.deepEqual(Array.from(state.storage.values.entries()), before, 'missions, jobs, events and notifications must remain unchanged');
  assert.equal(state.storage.alarmAt, beforeAlarm, 'the existing alarm must not be changed or rescheduled');
  assert.deepEqual(state.storage.operationCounts, { get: 0, list: 0, put: 0, setAlarm: 0 }, 'alarm/reconcile and direct mutation guards must perform zero storage operations');
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
  ({ AriaMissionStore, MISSION_EXECUTION_PAUSED } = await import('../cloudflare-autonomy/worker.mjs'));
  // Existing positive lifecycle tests run only against an isolated test subclass. The
  // production export and Worker entrypoint always use the hard-coded paused class.
  UnpausedTestMissionStore = class extends AriaMissionStore {
    isMissionExecutionPaused() { return false; }
  };
  await testGlobalFreezeStopsMutationsAndAlarmRecovery();
  await testAuthAndVerifiedMissionLifecycle();
  await testIrreversibleTaskNeedsExplicitApproval();
  await testRetryReplanAndLeaseProtection();
  process.stdout.write('cloudflare-autonomy-worker: all tests passed\n');
})().catch(err => {
  process.stderr.write((err && err.stack) || String(err));
  process.exitCode = 1;
});
