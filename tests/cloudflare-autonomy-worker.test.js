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
function createStore({ paused = false, extraEnv = {} } = {}) {
  const state = new MemoryState();
  const Store = paused ? AriaMissionStore : UnpausedTestMissionStore;
  return { state, store: new Store(state, { ARIA_CONTROL_TOKEN: controlToken, ARIA_WORKER_TOKEN: workerToken, ARIA_WORKER_LEASE_MS: 60000, ...extraEnv }) };
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
const readEvidence = path => ({ operation: 'workspace.read', path, content: 'fixture', truncated: false, bytes: 7 });
async function createMission(store, goal = 'Inspect and verify') {
  const response = await store.fetch(request('/api/missions', { method: 'POST', body: { goal } }));
  assert.equal(response.status, 201);
  return (await body(response)).mission;
}
async function claim(store, expectedOperation) {
  const response = await store.fetch(request('/api/worker/claim', { method: 'POST', token: workerToken, body: { worker_id: 'test-worker', capabilities: ['mission.plan', 'mission.replan', 'workspace', 'mission.verify'] } }));
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

async function testControlAndWorkerTokensMustDiffer() {
  const state = new MemoryState();
  const store = new AriaMissionStore(state, { ARIA_CONTROL_TOKEN: controlToken, ARIA_WORKER_TOKEN: controlToken, ARIA_WORKER_LEASE_MS: 60000 });
  assert.equal((await store.fetch(request('/health'))).status, 503);
  assert.equal((await store.fetch(request('/api/missions', { token: controlToken }))).status, 503);
  assert.equal((await store.fetch(request('/api/worker/claim', { method: 'POST', token: controlToken, body: { worker_id: 'same-token' } }))).status, 503);
}

async function testAuthAndVerifiedMissionLifecycle() {
  const { store } = createStore();
  assert.equal((await store.fetch(request('/api/missions', { token: 'wrong-token' }))).status, 401);
  assert.equal((await store.fetch(request('/api/missions', { token: workerToken }))).status, 401, 'worker token must not authorize control-plane reads');
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
  const taskResponse = await complete(store, taskJob, { passed: true, evidence: readEvidence('README.md') });
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

async function testVerificationRejectsIncompleteMissionState() {
  for (const corruption of ['required_task_unfinished', 'active_job_remaining', 'task_evidence_missing', 'task_evidence_arbitrary', 'task_evidence_empty', 'task_evidence_placeholder']) {
    const { state, store } = createStore();
    const mission = await createMission(store, 'Do not report success before all work is complete');
    const planJob = await claim(store, 'mission.plan');
    await complete(store, planJob, {
      passed: true,
      evidence: { tasks: [{ task_id: 'required-read', title: 'Read required input', operation: 'workspace.read', payload: { path: 'README.md' }, depends_on: [], idempotent: true }] }
    });
    const taskJob = await claim(store, 'task.execute');
    await complete(store, taskJob, { passed: true, evidence: readEvidence('README.md') });
    const verifyJob = await claim(store, 'mission.verify');

    if (corruption === 'required_task_unfinished' || corruption.startsWith('task_evidence_')) {
      const persisted = await state.storage.get('mission:' + mission.mission_id);
      if (corruption === 'required_task_unfinished') {
        persisted.tasks.push({ task_id: 'required-followup', status: 'pending', depends_on: [], evidence: [] });
      } else if (corruption === 'task_evidence_missing') {
        persisted.tasks[0].evidence = [];
      } else if (corruption === 'task_evidence_arbitrary') {
        persisted.tasks[0].evidence = [{ foo: 'bar' }];
      } else if (corruption === 'task_evidence_empty') {
        persisted.tasks[0].evidence = [{}];
      } else {
        persisted.tasks[0].evidence = [{ operation: 'workspace.read', path: 'placeholder', content: 'placeholder', bytes: 11, truncated: false }];
      }
      await state.storage.put('mission:' + mission.mission_id, persisted);
    }
    if (corruption === 'active_job_remaining') {
      await state.storage.put('job:orphan-active-job', {
        job_id: 'orphan-active-job', mission_id: mission.mission_id, operation: 'task.execute', status: 'leased'
      });
    }

    const verifyResponse = await complete(store, verifyJob, {
      passed: true,
      evidence: { verification: { passed: true, reason: 'Worker claims the goal is complete.' } }
    });
    assert.equal(verifyResponse.status, 200);
    const final = await state.storage.get('mission:' + mission.mission_id);
    assert.equal(final.status, 'waiting_human', corruption + ' must fail closed');
    assert.equal(final.last_error, 'mission_completion_invariants_failed');
    assert.notEqual(final.progress_percent, 100);
    const notices = Array.from((await state.storage.list({ prefix: 'notification:' })).values());
    assert.ok(notices.some(item => item.event.reason === 'mission_completion_invariants_failed'));
    assert.equal(notices.some(item => item.event.type === 'mission_completed'), false);
  }
}

async function testEvidenceValidatorAcceptsRealWindowsAdapterContracts() {
  const contracts = [
    ['workspace.list', { operation: 'workspace.list', path: '.', entries: [{ path: 'README.md', type: 'file' }], count: 1, truncated: false }],
    ['workspace.read', { operation: 'workspace.read', path: 'README.md', content: 'fixture', truncated: false, bytes: 7 }],
    ['workspace.search', { operation: 'workspace.search', query: 'ARIA', matches: [{ path: 'README.md', line: 1, text: 'ARIA' }, { path: 'README.md', line: 2, text: 'ARIA again' }], count: 2, scanned_files: 1, truncated: false }],
    ['workspace.write', { operation: 'workspace.write', path: 'notes/file.txt', backup: null, bytes_written: 7, sha256: 'a'.repeat(64) }],
    ['workspace.edit', { operation: 'workspace.edit', path: 'notes/file.txt', backup: 'notes/file.txt.bak', bytes_written: 7, sha256: 'b'.repeat(64) }],
    ['tests.run', { operation: 'tests.run', test_file: 'tests/example.test.js', exit_code: 0, stdout: 'PASS', stderr: '' }],
    ['git.status', { operation: 'git.status', output: '## branch' }],
    ['git.diff', { operation: 'git.diff', output: '1 file changed' }]
  ];
  for (const [operation, evidence] of contracts) {
    const { store } = createStore();
    const mission = await createMission(store, 'Accept verified ' + operation + ' adapter evidence');
    const planJob = await claim(store, 'mission.plan');
    await complete(store, planJob, { passed: true, evidence: { tasks: [{ task_id: 'contract-task', operation, payload: {}, depends_on: [] }] } });
    const taskJob = await claim(store, 'task.execute');
    assert.equal(taskJob.task.operation, operation);
    await complete(store, taskJob, { passed: true, evidence });
    const verifyJob = await claim(store, 'mission.verify');
    await complete(store, verifyJob, { passed: true, evidence: { verification: { passed: true, reason: 'Adapter evidence matches its operation contract.' } } });
    const persisted = (await body(await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id))))).mission;
    assert.equal(persisted.status, 'succeeded', operation + ' evidence from the real adapter contract must remain accepted');
  }
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
  await complete(store, taskJob, { passed: true, evidence: { operation: 'workspace.write', path: 'notes/approved.txt', backup: 'notes/approved.txt.bak', bytes_written: 8, sha256: 'a'.repeat(64) } });
  const verifyJob = await claim(store, 'mission.verify');
  await complete(store, verifyJob, { passed: true, evidence: { verification: { passed: true, reason: 'Approved operation verified.' } } });
  const missionAfterApprovalResponse = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id)));
  current = (await body(missionAfterApprovalResponse)).mission;
  assert.equal(current.status, 'succeeded');
}

async function testHumanGateDoesNotStopIndependentTasks() {
  const { store } = createStore();
  const mission = await createMission(store, 'Complete safe independent work while approval is pending');
  const planJob = await claim(store, 'mission.plan');
  await complete(store, planJob, {
    passed: true,
    evidence: { tasks: [
      { task_id: 'gated-write', title: 'Write only after approval', operation: 'workspace.write', payload: { path: 'notes/approved.txt', content: 'approved' }, irreversible: true, depends_on: [] },
      { task_id: 'independent-read', title: 'Read independent context', operation: 'workspace.read', payload: { path: 'README.md' }, depends_on: [] }
    ] }
  });

  let current = (await body(await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id))))).mission;
  assert.equal(current.status, 'running');
  assert.equal(current.approval.status, 'pending');
  assert.equal(current.tasks.find(task => task.task_id === 'gated-write').status, 'waiting_human');
  assert.equal(current.tasks.find(task => task.task_id === 'independent-read').status, 'running');

  const independentJob = await claim(store, 'task.execute');
  assert.equal(independentJob.task.task_id, 'independent-read');
  await complete(store, independentJob, { passed: true, evidence: readEvidence('README.md') });
  current = (await body(await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id))))).mission;
  assert.equal(current.status, 'waiting_human');
  assert.equal(current.tasks.find(task => task.task_id === 'independent-read').status, 'succeeded');
  assert.equal(current.tasks.find(task => task.task_id === 'gated-write').status, 'waiting_human');

  const approval = await store.fetch(request('/api/approvals/' + encodeURIComponent(current.approval.approval_id), {
    method: 'POST', body: { decision: 'approved', actor: 'test-reviewer' }
  }));
  assert.equal(approval.status, 200, 'the gate remains resolvable after independent work finishes');
  const gatedJob = await claim(store, 'task.execute');
  assert.equal(gatedJob.task.task_id, 'gated-write');
  await complete(store, gatedJob, { passed: true, evidence: { operation: 'workspace.write', path: 'notes/approved.txt', backup: null, bytes_written: 8, sha256: 'a'.repeat(64) } });
  const verifyJob = await claim(store, 'mission.verify');
  await complete(store, verifyJob, { passed: true, evidence: { verification: { passed: true, reason: 'Both independent and approved work completed.' } } });
  current = (await body(await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id))))).mission;
  assert.equal(current.status, 'succeeded');
}

async function testRejectedHumanGateDoesNotCancelIndependentWork() {
  const { state, store } = createStore();
  const mission = await createMission(store, 'Keep independent work moving after a gated action is rejected');
  const planJob = await claim(store, 'mission.plan');
  await complete(store, planJob, {
    passed: true,
    evidence: { tasks: [
      { task_id: 'rejected-write', title: 'Write only after approval', operation: 'workspace.write', payload: { path: 'notes/rejected.txt', content: 'blocked' }, irreversible: true, depends_on: [] },
      { task_id: 'independent-read', title: 'Read independent context', operation: 'workspace.read', payload: { path: 'README.md' }, depends_on: [] }
    ] }
  });
  let current = (await body(await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id))))).mission;
  const approval = await store.fetch(request('/api/approvals/' + encodeURIComponent(current.approval.approval_id), {
    method: 'POST', body: { decision: 'rejected', actor: 'test-reviewer' }
  }));
  assert.equal(approval.status, 200);

  const independentJob = await claim(store, 'task.execute');
  assert.equal(independentJob.task.task_id, 'independent-read');
  await complete(store, independentJob, { passed: true, evidence: readEvidence('README.md') });
  current = (await body(await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id))))).mission;
  assert.equal(current.status, 'waiting_human');
  assert.equal(current.tasks.find(task => task.task_id === 'independent-read').status, 'succeeded');
  assert.equal(current.tasks.find(task => task.task_id === 'rejected-write').status, 'failed');
  assert.notEqual(current.status, 'failed', 'a rejected step must not prematurely terminalize the whole mission');
  const resume = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id) + '/resume', { method: 'POST', body: {} }));
  assert.equal(resume.status, 200);
  assert.equal((await body(resume)).mission.tasks.find(task => task.task_id === 'rejected-write').status, 'failed', 'Resume never replays a human-rejected operation');
  const rejectedTaskJobs = Array.from((await state.storage.list({ prefix: 'job:' })).values()).filter(job => job.task_id === 'rejected-write');
  assert.equal(rejectedTaskJobs.length, 0);
}

async function testRecoveryReconcilesJobAndMissionCheckpointDivergence() {
  {
    const { state, store } = createStore();
    const mission = await createMission(store, 'Recover a committed task result after an interrupted checkpoint');
    const planJob = await claim(store, 'mission.plan');
    await complete(store, planJob, {
      passed: true,
      evidence: { tasks: [{ task_id: 'read-once', operation: 'workspace.read', payload: { path: 'README.md' }, depends_on: [], idempotent: true }] }
    });
    const records = await state.storage.list({ prefix: 'job:' });
    const taskJob = Array.from(records.values()).find(job => job.mission_id === mission.mission_id && job.operation === 'task.execute');
    taskJob.status = 'completed';
    taskJob.result = { passed: true, evidence: readEvidence('README.md') };
    taskJob.updated_at = new Date().toISOString();
    await state.storage.put('job:' + taskJob.job_id, taskJob);

    await store.alarm();
    const recovered = await state.storage.get('mission:' + mission.mission_id);
    assert.equal(recovered.tasks[0].status, 'succeeded');
    assert.equal(recovered.tasks[0].evidence[0].operation, 'workspace.read');
    const allJobs = Array.from((await state.storage.list({ prefix: 'job:' })).values());
    assert.equal(allJobs.filter(job => job.mission_id === mission.mission_id && job.operation === 'task.execute').length, 1);
    assert.ok(allJobs.some(job => job.mission_id === mission.mission_id && job.operation === 'mission.verify' && job.status === 'queued'));
  }

  for (const idempotent of [true, false]) {
    const { state, store } = createStore();
    const mission = await createMission(store, 'Recover a missing task job safely');
    const planJob = await claim(store, 'mission.plan');
    await complete(store, planJob, {
      passed: true,
      evidence: { tasks: [{ task_id: 'possibly-applied', operation: 'workspace.write', payload: { path: 'notes/state.txt', content: 'state' }, depends_on: [], idempotent }] }
    });
    const records = await state.storage.list({ prefix: 'job:' });
    const taskJob = Array.from(records.values()).find(job => job.mission_id === mission.mission_id && job.operation === 'task.execute');
    state.storage.values.delete('job:' + taskJob.job_id);

    await store.alarm();
    const recovered = await state.storage.get('mission:' + mission.mission_id);
    const remainingJobs = Array.from((await state.storage.list({ prefix: 'job:' })).values())
      .filter(job => job.mission_id === mission.mission_id && job.operation === 'task.execute');
    if (idempotent) {
      assert.equal(recovered.tasks[0].status, 'running');
      assert.equal(remainingJobs.length, 1, 'an idempotent missing job gets one replacement');
      assert.equal(remainingJobs[0].status, 'queued');
    } else {
      assert.equal(recovered.status, 'waiting_human');
      assert.equal(recovered.tasks[0].status, 'waiting_human');
      assert.equal(recovered.tasks[0].ambiguous_result, true);
      assert.equal(remainingJobs.length, 0, 'a non-idempotent task is not repeated without its durable job result');
    }
  }
}

async function testRetryPolicyDoesNotRepeatAmbiguousNonIdempotentFailure() {
  const { state, store } = createStore();
  const mission = await createMission(store, 'Escalate an ambiguous write timeout without repeating it');
  const planJob = await claim(store, 'mission.plan');
  await complete(store, planJob, {
    passed: true,
    evidence: { tasks: [{ task_id: 'write-once', operation: 'workspace.write', payload: { path: 'notes/once.txt', content: 'once' }, idempotent: false, max_attempts: 3, depends_on: [] }] }
  });
  const writeJob = await claim(store, 'task.execute');
  const failed = await complete(store, writeJob, { passed: false, error: 'provider timeout after remote write may have completed' });
  assert.equal(failed.status, 200);

  const persisted = await state.storage.get('mission:' + mission.mission_id);
  const durableJobs = Array.from((await state.storage.list({ prefix: 'job:' })).values()).filter(job => job.mission_id === mission.mission_id);
  assert.equal(persisted.status, 'waiting_human');
  assert.equal(persisted.tasks[0].attempts, 1, 'an ambiguous non-idempotent operation is never automatically repeated');
  assert.equal(persisted.tasks[0].failure_diagnostics[0].error_code, 'transient_network_or_timeout');
  assert.equal(persisted.tasks[0].failure_diagnostics[0].recovery, 'human_intervention');
  assert.equal(persisted.tasks[0].failure_diagnostics[0].phase, 'task_execution');
  assert.equal(persisted.tasks[0].last_error, 'transient_network_or_timeout');
  assert.equal(persisted.tasks[0].ambiguous_result, true);
  assert.equal(durableJobs.some(job => job.operation === 'mission.replan'), false);
  assert.equal(JSON.stringify(durableJobs).includes('remote write may have completed'), false, 'raw provider detail must not be persisted');

  const resume = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id) + '/resume', { method: 'POST', body: {} }));
  assert.equal(resume.status, 200, 'Resume may continue independent work while preserving the ambiguous gate');
  const afterResume = await state.storage.get('mission:' + mission.mission_id);
  assert.equal(afterResume.tasks[0].status, 'waiting_human');
  assert.equal(Array.from((await state.storage.list({ prefix: 'job:' })).values()).filter(job => job.mission_id === mission.mission_id && job.operation === 'task.execute').length, 1);

  const unauthorizedReplay = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id) + '/resume', {
    method: 'POST', body: { replay_authorizations: [{ task_id: 'write-once', confirmation: 'REPLAY' }] }
  }));
  assert.equal(unauthorizedReplay.status, 422);
  const anonymousReplay = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id) + '/resume', {
    method: 'POST', body: { replay_authorizations: [{ task_id: 'write-once', confirmation: 'REPLAY_THIS_NON_IDEMPOTENT_TASK' }] }
  }));
  assert.equal(anonymousReplay.status, 422, 'task-scoped replay requires an identified human actor');
  const invalidReconciliation = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id) + '/resume', {
    method: 'POST', body: { reconcile_tasks: [{ task_id: 'write-once', outcome: 'completed', evidence: { foo: 'bar' } }] }
  }));
  assert.equal(invalidReconciliation.status, 422, 'arbitrary objects do not qualify as reconciled evidence');
  assert.equal(Array.from((await state.storage.list({ prefix: 'job:' })).values()).filter(job => job.mission_id === mission.mission_id && job.operation === 'task.execute').length, 1);

  const explicitReplay = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id) + '/resume', {
    method: 'POST', body: { actor: 'operator-7', replay_authorizations: [{ task_id: 'write-once', confirmation: 'REPLAY_THIS_NON_IDEMPOTENT_TASK' }] }
  }));
  assert.equal(explicitReplay.status, 200);
  const replayMission = (await body(explicitReplay)).mission;
  assert.equal(replayMission.tasks[0].replay_authorized_by, 'operator-7');
  const replayJob = await claim(store, 'task.execute');
  assert.equal(replayJob.task.task_id, 'write-once');
  assert.equal(replayJob.task.attempts, 2, 'explicit replay is tied to the one ambiguous task and does not reset attempt history');
}

async function testAmbiguousOutcomeCanBeReconciledWithoutReplay() {
  const { state, store } = createStore();
  const mission = await createMission(store, 'Reconcile a completed remote write without repeating it');
  const planJob = await claim(store, 'mission.plan');
  await complete(store, planJob, { passed: true, evidence: { tasks: [{ task_id: 'write-once', operation: 'workspace.write', payload: { relative_path: 'notes/once.txt', content: 'once' }, idempotent: false, depends_on: [] }] } });
  const writeJob = await claim(store, 'task.execute');
  await complete(store, writeJob, { passed: false, error: 'timeout after write may have completed' });
  const reconciled = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id) + '/resume', {
    method: 'POST', body: { actor: 'operator-8', reconcile_tasks: [{
      task_id: 'write-once', outcome: 'completed',
      evidence: { operation: 'workspace.write', path: 'notes/once.txt', backup: null, bytes_written: 4, sha256: 'b'.repeat(64) }
    }] }
  }));
  assert.equal(reconciled.status, 200);
  const result = (await body(reconciled)).mission.tasks[0];
  assert.equal(result.status, 'succeeded');
  assert.equal(result.reconciled_by, 'operator-8');
  const jobs = Array.from((await state.storage.list({ prefix: 'job:' })).values()).filter(job => job.mission_id === mission.mission_id && job.operation === 'task.execute');
  assert.equal(jobs.length, 1, 'reconciliation records the outcome without creating a replay job');
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

async function testNotificationPayloadAllowlistAndAutomaticRetry() {
  const originalFetch = global.fetch;
  const payloads = [];
  let responseStatus = 503;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://notify.example.test/aria');
    payloads.push({ body: JSON.parse(options.body), headers: options.headers, redirect: options.redirect });
    return new Response('mocked', { status: responseStatus });
  };
  try {
    const { state, store } = createStore({ extraEnv: {
      ARIA_NOTIFICATION_WEBHOOK_URL: 'https://notify.example.test/aria',
      ARIA_NOTIFICATION_ALLOWED_HOSTS: 'notify.example.test',
      ARIA_NOTIFICATION_TOKEN: 'notification-secret-for-test'
    } });
    const notice = await store.notify({
      type: 'human_intervention_required',
      mission_id: 'mission_safe',
      task_id: 'task_safe',
      reason: 'r'.repeat(1200),
      details: 'A human should review this.',
      secret_field: 'must-not-leave-the-coordinator'
    });
    await Promise.all(state.pending);

    let persisted = await state.storage.get('notification:' + notice.notification_id);
    assert.equal(persisted.status, 'pending');
    assert.equal(persisted.attempts, 1);
    assert.ok(state.storage.alarmAt, 'a failed initial delivery must automatically schedule its retry');
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].body.type, 'human_intervention_required');
    assert.equal(payloads[0].body.mission_id, 'mission_safe');
    assert.equal(payloads[0].body.task_id, 'task_safe');
    assert.equal(payloads[0].body.reason.length, 1000);
    assert.equal(payloads[0].body.secret_field, undefined);
    assert.equal(JSON.stringify(payloads[0].body).includes('notification-secret-for-test'), false);
    assert.equal(payloads[0].headers.authorization, 'Bearer notification-secret-for-test');
    assert.equal(payloads[0].redirect, 'manual');

    responseStatus = 200;
    const restartedStore = new UnpausedTestMissionStore(state, store.env);
    await restartedStore.alarm();
    persisted = await state.storage.get('notification:' + notice.notification_id);
    assert.equal(persisted.status, 'delivered');
    assert.equal(persisted.attempts, 2);
    assert.equal(payloads.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testNotificationGuidanceMatchesGateEvent() {
  const { state, store } = createStore();
  const cases = [
    [{ type: 'human_approval_required', mission_id: 'm0', task_id: 't0', approval_id: 'a0', reason: 'approval_required' }, /Aprueba o rechaza explícitamente esta aprobación/],
    [{ type: 'mission_rejected', mission_id: 'm1', task_id: 't1', approval_id: 'a1', reason: 'human_rejected' }, /El rechazo ya quedó registrado/, /Aprueba o rechaza/, null],
    [{ type: 'ambiguous_result', mission_id: 'm2', task_id: 't2', reason: 'ambiguous_non_idempotent_result' }, /Comprueba en el sistema destino/, /Reanudar/, /aprobar/],
    [{ type: 'human_intervention_required', mission_id: 'm3', reason: 'task_dependency_blocked' }, /revisa las dependencias/, /Pulsa Reanudar/, /Resume/],
    [{ type: 'human_intervention_required', mission_id: 'm4', reason: 'provider_or_auth_configuration' }, /Revisa el diagnóstico y el proveedor/]
  ];
  for (const [event, required, forbiddenA, forbiddenB] of cases) {
    const record = await store.notify(event);
    assert.match(record.event.resolution_steps.join(' '), required);
    if (event.type === 'mission_rejected') assert.match(record.event.resolution_steps.join(' '), /no uses Reanudar/);
    if (forbiddenA) assert.doesNotMatch(record.event.resolution_steps.join(' '), forbiddenA);
    if (forbiddenB) assert.doesNotMatch(record.event.resolution_steps.join(' '), forbiddenB);
  }
  const firstCompletion = await store.notify({ type: 'mission_completed', mission_id: 'same-completion', details: 'verification wording one' });
  const duplicateCompletion = await store.notify({ details: 'verification wording changed', mission_id: 'same-completion', type: 'mission_completed' });
  assert.equal(firstCompletion.notification_id, duplicateCompletion.notification_id, 'semantic dedupe ignores changing presentation details for a persisted mission transition');
  await Promise.all(state.pending);
}

async function testTelegramNotificationDeliveryAndRetry() {
  const originalFetch = global.fetch;
  const token = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm';
  const chatId = '987654321';
  const calls = [];
  let responseStatus = 429;
  global.fetch = async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    if (responseStatus === 429) {
      return new Response(JSON.stringify({ ok: false, description: 'Too Many Requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const { state, store } = createStore({ extraEnv: {
      ARIA_TELEGRAM_BOT_TOKEN: token,
      ARIA_TELEGRAM_CHAT_ID: chatId
    } });
    await state.storage.put('mission:mission_telegram', { mission_id: 'mission_telegram', goal: 'Approve the deployment plan after reviewing its evidence.' });
    const event = {
      type: 'human_intervention_required',
      mission_id: 'mission_telegram',
      task_id: 'approval_task',
      approval_id: 'approval_telegram',
      reason: 'Needs a human review.',
      details: 'Review the pending approval.',
      secret_field: 'must-not-be-sent'
    };
    const [notice, duplicate] = await Promise.all([
      store.notify(event),
      store.notify({ details: 'Updated prose after restart', reason: event.reason, approval_id: event.approval_id, task_id: event.task_id, mission_id: event.mission_id, type: event.type, secret_field: 'different-detail' })
    ]);
    assert.equal(duplicate.notification_id, notice.notification_id, 'semantic identity is stable across object key order and detail changes');
    await Promise.all(state.pending);

    let persisted = await state.storage.get('notification:' + notice.notification_id);
    assert.equal(persisted.status, 'pending');
    assert.equal(persisted.attempts, 1);
    assert.ok(state.storage.alarmAt, 'Telegram 429 must schedule an automatic retry');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.telegram.org/bot' + token + '/sendMessage');
    assert.equal(calls[0].body.chat_id, chatId);
    assert.match(calls[0].body.text, /ARIA · human_intervention_required/);
    assert.match(calls[0].body.text, /Misión: mission_telegram/);
    assert.match(calls[0].body.text, /Objetivo: Approve the deployment plan/);
    assert.match(calls[0].body.text, /Motivo: Needs a human review\./);
    assert.match(calls[0].body.text, /1\. Abre ARIA Mission Control/);
    assert.match(calls[0].body.text, /Aprueba o rechaza explícitamente esta aprobación/);
    assert.match(calls[0].body.text, /https:\/\/aria-autonomy-coordinator\.robvg9\.workers\.dev\//);
    assert.match(calls[0].body.text, /Después: ARIA continúa desde el checkpoint persistido/);
    assert.equal(calls[0].body.secret_field, undefined);
    assert.equal(calls[0].options.redirect, 'manual');
    assert.equal(calls[0].options.headers.authorization, undefined);
    assert.equal(JSON.stringify(persisted).includes(token), false);

    responseStatus = 200;
    const restartedStore = new UnpausedTestMissionStore(state, store.env);
    await restartedStore.alarm();
    persisted = await state.storage.get('notification:' + notice.notification_id);
    assert.equal(persisted.status, 'delivered');
    assert.equal(persisted.attempts, 2);
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testAuthenticatedTelegramProbeWorksDuringGlobalFreeze() {
  const originalFetch = global.fetch;
  const token = '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm';
  const chatId = '1472893961';
  const outbound = [];
  global.fetch = async (url, options) => {
    outbound.push({ url, body: JSON.parse(options.body), options });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  try {
    const { state, store } = createStore({ paused: true, extraEnv: {
      ARIA_TELEGRAM_BOT_TOKEN: token,
      ARIA_TELEGRAM_CHAT_ID: chatId
    } });

    const unauthenticated = await store.fetch(request('/api/notifications/test', {
      method: 'POST', token: 'wrong-token', body: { confirm: 'SEND_TELEGRAM_TEST_ONCE' }
    }));
    assert.equal(unauthenticated.status, 401);

    const notConfirmed = await store.fetch(request('/api/notifications/test', {
      method: 'POST', body: { confirm: 'no' }
    }));
    assert.equal(notConfirmed.status, 400);
    assert.equal(outbound.length, 0);

    const response = await store.fetch(request('/api/notifications/test', {
      method: 'POST', body: { confirm: 'SEND_TELEGRAM_TEST_ONCE' }
    }));
    assert.equal(response.status, 200);
    const result = await body(response);
    assert.equal(result.notification.status, 'delivered');
    assert.equal(result.notification.attempts, 1);
    assert.ok(result.notification.delivered_at);
    assert.equal(result.notification.last_error, null);
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].url, 'https://api.telegram.org/bot' + token + '/sendMessage');
    assert.equal(outbound[0].body.chat_id, chatId);
    assert.match(outbound[0].body.text, /ARIA · telegram_connection_test/);
    assert.match(outbound[0].body.text, /Prueba de conexión/);
    assert.equal(outbound[0].options.redirect, 'manual');

    assert.equal(MISSION_EXECUTION_PAUSED, true);
    assert.equal(store.isMissionExecutionPaused(), true);
    const blockedMission = await store.fetch(request('/api/missions', {
      method: 'POST', body: { goal: 'This mutation must remain blocked' }
    }));
    assert.equal(blockedMission.status, 423);
    const blockedClaim = await store.fetch(request('/api/worker/claim', {
      method: 'POST', token: workerToken, body: { worker_id: 'freeze-probe' }
    }));
    assert.equal(blockedClaim.status, 423);

    const missions = await state.storage.list({ prefix: 'mission:' });
    const jobs = await state.storage.list({ prefix: 'job:' });
    assert.equal(missions.size, 0);
    assert.equal(jobs.size, 0);

    const throttled = await store.fetch(request('/api/notifications/test', {
      method: 'POST', body: { confirm: 'SEND_TELEGRAM_TEST_ONCE' }
    }));
    assert.equal(throttled.status, 429);
    assert.equal(outbound.length, 1, 'the probe must be rate limited to one attempt per minute');
  } finally {
    global.fetch = originalFetch;
  }
}

async function testTelegramIncompleteConfigurationWaitsSafely() {
  const originalFetch = global.fetch;
  let outbound = 0;
  global.fetch = async () => { outbound += 1; return new Response('unexpected', { status: 200 }); };
  try {
    const { state, store } = createStore({ extraEnv: {
      ARIA_TELEGRAM_BOT_TOKEN: '123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm'
    } });
    const notice = await store.notify({ type: 'telegram_setup_pending' });
    await Promise.all(state.pending);
    let persisted = await state.storage.get('notification:' + notice.notification_id);
    assert.equal(persisted.status, 'waiting_config');
    assert.equal(persisted.last_error, 'telegram_configuration_incomplete');
    assert.equal(outbound, 0, 'incomplete Telegram credentials must never make an outbound request');
    assert.ok(state.storage.alarmAt, 'waiting_config notices are scheduled for recovery');
    store.env.ARIA_TELEGRAM_CHAT_ID = '1472893961';
    global.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    const restartedStore = new UnpausedTestMissionStore(state, store.env);
    await restartedStore.alarm();
    persisted = await state.storage.get('notification:' + notice.notification_id);
    assert.equal(persisted.status, 'delivered', 'alarm recovery retries after configuration is completed');
    assert.equal(persisted.attempts, 1);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testNotificationRejectsUnapprovedHostAndPermanentFailure() {
  const originalFetch = global.fetch;
  let outbound = 0;
  try {
    global.fetch = async () => { outbound += 1; return new Response('unexpected', { status: 200 }); };
    const blocked = createStore({ extraEnv: {
      ARIA_NOTIFICATION_WEBHOOK_URL: 'https://unapproved.example.test/aria',
      ARIA_NOTIFICATION_ALLOWED_HOSTS: 'notify.example.test'
    } });
    const blockedNotice = await blocked.store.notify({ type: 'blocked_host' });
    await Promise.all(blocked.state.pending);
    let persisted = await blocked.state.storage.get('notification:' + blockedNotice.notification_id);
    assert.equal(persisted.status, 'failed');
    assert.equal(persisted.last_error, 'notification_webhook_host_not_allowlisted');
    assert.equal(persisted.attempts, 0);
    assert.equal(outbound, 0, 'the coordinator must not contact a host outside the explicit allowlist');

    global.fetch = async () => new Response('rejected', { status: 400 });
    const permanent = createStore({ extraEnv: {
      ARIA_NOTIFICATION_WEBHOOK_URL: 'https://notify.example.test/aria',
      ARIA_NOTIFICATION_ALLOWED_HOSTS: 'notify.example.test'
    } });
    const failedNotice = await permanent.store.notify({ type: 'permanent_failure' });
    await Promise.all(permanent.state.pending);
    persisted = await permanent.state.storage.get('notification:' + failedNotice.notification_id);
    assert.equal(persisted.status, 'failed', 'non-retryable 4xx responses must fail without looping');
    assert.equal(persisted.attempts, 1);
    assert.equal(permanent.state.storage.alarmAt, null);
  } finally {
    global.fetch = originalFetch;
  }
}

async function testNotificationRetryLimit() {
  const originalFetch = global.fetch;
  let outbound = 0;
  try {
    global.fetch = async () => { outbound += 1; return new Response('unavailable', { status: 503 }); };
    const { state, store } = createStore({ extraEnv: {
      ARIA_NOTIFICATION_WEBHOOK_URL: 'https://notify.example.test/aria',
      ARIA_NOTIFICATION_ALLOWED_HOSTS: 'notify.example.test'
    } });
    const notice = await store.notify({ type: 'temporary_failure' });
    await Promise.all(state.pending);
    for (let attempt = 1; attempt < 5; attempt += 1) await store.alarm();
    const persisted = await state.storage.get('notification:' + notice.notification_id);
    assert.equal(persisted.status, 'failed', 'transient failures must stop at the retry cap');
    assert.equal(persisted.attempts, 5);
    assert.equal(outbound, 5);
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
    evidence: { tasks: [
      { task_id: 'unstable', title: 'Unstable task', operation: 'workspace.read', payload: { path: 'missing.txt' }, idempotent: true, max_attempts: 1, depends_on: [] },
      { task_id: 'independent-pending', title: 'Independent pending read', operation: 'workspace.read', payload: { path: 'README.md' }, idempotent: true, depends_on: [] }
    ] }
  });
  const taskJob = await claim(store, 'task.execute');
  const failed = await complete(store, taskJob, { passed: false, error: 'hard failure' });
  assert.equal(failed.status, 200);
  const beforeReplan = (await body(await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id))))).mission;
  assert.equal(beforeReplan.tasks.find(task => task.task_id === 'independent-pending').status, 'pending', 'bounded replan must preserve independent authorized work');
  assert.equal(beforeReplan.tasks.find(task => task.task_id === 'unstable').status, 'failed', 'failed work remains required until a replacement is recorded');
  await store.alarm();
  const replanJob = await claim(store, 'mission.replan');
  const stale = await complete(store, { ...replanJob, lease_token: 'stale-lease' }, { passed: true, evidence: { tasks: [] } });
  assert.equal(stale.status, 409);
  await complete(store, replanJob, {
    passed: true,
    evidence: { tasks: [{ task_id: 'recovery-step', replaces_task_id: 'unstable', title: 'Read a valid file', operation: 'workspace.read', payload: { path: 'README.md' }, idempotent: true, depends_on: [] }] }
  });
  const afterPlan = (await body(await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id))))).mission;
  assert.equal(afterPlan.tasks.find(task => task.task_id === 'unstable').status, 'failed', 'the replacement declaration alone cannot skip failed work');
  const preservedJob = await claim(store, 'task.execute');
  assert.equal(preservedJob.task.task_id, 'independent-pending');
  await complete(store, preservedJob, { passed: true, evidence: readEvidence('README.md') });
  const recoveryJob = await claim(store, 'task.execute');
  assert.equal(recoveryJob.task.task_id, 'recovery-step');
  await complete(store, recoveryJob, { passed: true, evidence: readEvidence('README.md') });
  const afterReplacement = (await body(await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id))))).mission;
  assert.equal(afterReplacement.tasks.find(task => task.task_id === 'unstable').status, 'skipped');
  const verifyJob = await claim(store, 'mission.verify');
  await complete(store, verifyJob, { passed: true, evidence: { verification: { passed: true, reason: 'Replanned work verified.' } } });
  const finalMissionResponse = await store.fetch(request('/api/missions/' + encodeURIComponent(mission.mission_id)));
  const finalMission = (await body(finalMissionResponse)).mission;
  assert.equal(finalMission.status, 'succeeded');
  assert.equal(finalMission.progress_percent, 100);
}

async function testSubmittedReplanMustProveFailedTaskReplacement() {
  const { state, store } = createStore();
  const mission = await createMission(store, 'Require replacement proof for planner-submitted replan');
  const planJob = await claim(store, 'mission.plan');
  await complete(store, planJob, { passed: true, evidence: { tasks: [{ task_id: 'failed-required', operation: 'workspace.read', payload: { path: 'missing.txt' }, idempotent: true, max_attempts: 1, depends_on: [] }] } });
  const taskJob = await claim(store, 'task.execute');
  await complete(store, taskJob, { passed: false, error: 'permanent read failure' });

  const missingReplacement = await store.submitPlan(mission.mission_id, request('/api/missions/' + mission.mission_id + '/plan', {
    method: 'POST', body: { tasks: [{ task_id: 'replacement-no-link', operation: 'workspace.read', payload: { path: 'README.md' }, depends_on: [] }] }
  }));
  assert.equal(missingReplacement.status, 422);
  let persisted = await state.storage.get('mission:' + mission.mission_id);
  assert.equal(persisted.tasks[0].status, 'failed');
  assert.equal(persisted.tasks.length, 1, 'unproven plan output cannot silently discard the failed required step');

  const validReplacement = await store.submitPlan(mission.mission_id, request('/api/missions/' + mission.mission_id + '/plan', {
    method: 'POST', body: { tasks: [{ task_id: 'replacement-proven', replaces_task_id: 'failed-required', operation: 'workspace.read', payload: { path: 'README.md' }, depends_on: [] }] }
  }));
  assert.equal(validReplacement.status, 201);
  persisted = await state.storage.get('mission:' + mission.mission_id);
  assert.equal(persisted.tasks[0].status, 'failed', 'a declared replacement is not enough to skip required work');
  assert.equal(persisted.tasks[0].replacement_task_id, 'replacement-proven');
  assert.equal(persisted.tasks[1].status, 'running');
  const replacementJob = await claim(store, 'task.execute');
  await complete(store, replacementJob, { passed: true, evidence: readEvidence('README.md') });
  persisted = await state.storage.get('mission:' + mission.mission_id);
  assert.equal(persisted.tasks[0].status, 'skipped', 'only a completed, evidence-backed replacement supersedes the failed task');
  assert.equal(persisted.tasks[0].superseded_by_task_id, 'replacement-proven');
}

(async () => {
  ({ AriaMissionStore, MISSION_EXECUTION_PAUSED } = await import('../cloudflare-autonomy/worker.mjs'));
  // Existing positive lifecycle tests run only against an isolated test subclass. The
  // production export and Worker entrypoint always use the hard-coded paused class.
  UnpausedTestMissionStore = class extends AriaMissionStore {
    isMissionExecutionPaused() { return false; }
  };
  await testGlobalFreezeStopsMutationsAndAlarmRecovery();
  await testControlAndWorkerTokensMustDiffer();
  await testAuthAndVerifiedMissionLifecycle();
  await testVerificationRejectsIncompleteMissionState();
  await testEvidenceValidatorAcceptsRealWindowsAdapterContracts();
  await testIrreversibleTaskNeedsExplicitApproval();
  await testHumanGateDoesNotStopIndependentTasks();
  await testRejectedHumanGateDoesNotCancelIndependentWork();
  await testRecoveryReconcilesJobAndMissionCheckpointDivergence();
  await testRetryPolicyDoesNotRepeatAmbiguousNonIdempotentFailure();
  await testAmbiguousOutcomeCanBeReconciledWithoutReplay();
  await testNotificationPayloadAllowlistAndAutomaticRetry();
  await testNotificationGuidanceMatchesGateEvent();
  await testTelegramNotificationDeliveryAndRetry();
  await testAuthenticatedTelegramProbeWorksDuringGlobalFreeze();
  await testTelegramIncompleteConfigurationWaitsSafely();
  await testNotificationRejectsUnapprovedHostAndPermanentFailure();
  await testNotificationRetryLimit();
  await testRetryReplanAndLeaseProtection();
  await testSubmittedReplanMustProveFailedTaskReplacement();
  process.stdout.write('cloudflare-autonomy-worker: all tests passed\n');
})().catch(err => {
  process.stderr.write((err && err.stack) || String(err));
  process.exitCode = 1;
});
