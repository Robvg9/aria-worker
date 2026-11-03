'use strict';

const assert = require('node:assert/strict');
let AriaMissionStore;
let MISSION_EXECUTION_PAUSED;

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
class MemoryStorage {
  constructor() { this.values = new Map(); this.alarmAt = null; }
  async get(key) { return clone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, clone(value)); }
  async list({ prefix = '' } = {}) {
    return new Map(Array.from(this.values.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, clone(value)]));
  }
  async setAlarm(value) { this.alarmAt = value; }
}
function createState() {
  return { storage: new MemoryStorage(), waitUntil() {} };
}
const CONTROL_TOKEN = 'readonly-pilot-control-token'.padEnd(48, 'c');
const WORKER_TOKEN = 'readonly-pilot-worker-token'.padEnd(48, 'w');
function request(path, {
  method = 'GET',
  token = CONTROL_TOKEN,
  body,
  probeId,
  scopeToken
} = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (probeId) {
    headers['x-aria-package3-probe-id'] = probeId;
    headers['x-aria-package3-worker-id'] = String(body && body.worker_id || '');
  }
  if (scopeToken) headers['x-aria-package3-scope-token'] = scopeToken;
  return new Request('https://readonly-pilot.test' + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
}
async function payload(response) { return response.json(); }

(async () => {
  const imported = await import('../cloudflare-autonomy/worker.mjs');
  AriaMissionStore = imported.AriaMissionStore;
  MISSION_EXECUTION_PAUSED = imported.MISSION_EXECUTION_PAUSED;
  assert.equal(MISSION_EXECUTION_PAUSED, true, 'global freeze must remain enabled');

  const state = createState();
  const store = new AriaMissionStore(state, {
    ARIA_CONTROL_TOKEN: CONTROL_TOKEN,
    ARIA_WORKER_TOKEN: WORKER_TOKEN,
    ARIA_WORKER_LEASE_MS: '60000',
    ARIA_ALARM_INTERVAL_MS: '5000'
  });
  const probeId = 'readonly-pilot-unit-001';
  const scopeToken = 'readonly-pilot-scope-token'.padEnd(64, 's');
  const workerId = 'mw2p3-' + probeId + '-before';

  const ordinaryCreateBefore = await store.fetch(request('/api/missions', {
    method: 'POST', body: { goal: 'must remain frozen' }
  }));
  assert.equal(ordinaryCreateBefore.status, 423);

  const wrongConfirmation = await store.fetch(request('/api/package3/probe/start', {
    method: 'POST',
    body: { mode: 'readonly_git_status', confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE', probe_id: probeId, scope_token: scopeToken }
  }));
  assert.equal(wrongConfirmation.status, 400);

  const started = await store.fetch(request('/api/package3/probe/start', {
    method: 'POST',
    body: {
      mode: 'readonly_git_status',
      confirm: 'RUN_ONE_READONLY_GIT_STATUS_PILOT',
      probe_id: probeId,
      scope_token: scopeToken
    }
  }));
  assert.equal(started.status, 201);
  const startedBody = await payload(started);
  assert.equal(startedBody.probe.probe_type, 'readonly_git_status');
  assert.equal(startedBody.mission.status, 'running');
  assert.equal(startedBody.mission.tasks.length, 1);
  assert.equal(startedBody.mission.tasks[0].operation, 'git.status');
  assert.deepEqual(startedBody.mission.tasks[0].payload, {});
  assert.equal(startedBody.mission.tasks[0].max_attempts, 1);

  const ordinaryCreateDuring = await store.fetch(request('/api/missions', {
    method: 'POST', body: { goal: 'must remain frozen during pilot' }
  }));
  assert.equal(ordinaryCreateDuring.status, 423);

  const wrongWorker = await store.fetch(request('/api/worker/claim', {
    method: 'POST', token: WORKER_TOKEN, probeId, scopeToken,
    body: { worker_id: 'mw2p3-' + probeId + '-after', capabilities: ['git.status', 'mission.verify'] }
  }));
  assert.equal(wrongWorker.status, 423, 'readonly pilot permits only its one designated worker');

  const scopeBefore = await state.storage.get('package3:probe:' + probeId);
  assert.equal(scopeBefore.probe_type, 'readonly_git_status');
  assert.equal(scopeBefore.allowed_job_ids.length, 1);

  // Inject a malicious write task into this mission and allow-list its ID:
  // the scope's operation-level policy must still refuse to claim it.
  const maliciousJobId = 'job-readonly-pilot-malicious-write';
  scopeBefore.allowed_job_ids.push(maliciousJobId);
  await state.storage.put('package3:probe:' + probeId, scopeBefore);
  await state.storage.put('job:' + maliciousJobId, {
    job_id: maliciousJobId,
    mission_id: startedBody.mission.mission_id,
    operation: 'task.execute',
    task_id: 'malicious-write',
    task: { operation: 'workspace.write', payload: { path: 'should-never-write.txt', content: 'blocked' } },
    status: 'queued',
    worker_id: null,
    lease_token: null,
    lease_until: null,
    attempts: 0,
    created_at: '9999-01-01T00:00:00.000Z',
    updated_at: '9999-01-01T00:00:00.000Z'
  });

  const claimResponse = await store.fetch(request('/api/worker/claim', {
    method: 'POST', token: WORKER_TOKEN, probeId, scopeToken,
    body: { worker_id: workerId, capabilities: ['git.status', 'mission.verify', 'workspace'] }
  }));
  assert.equal(claimResponse.status, 200);
  const claimed = (await payload(claimResponse)).job;
  assert.equal(claimed.task.operation, 'git.status');
  assert.notEqual(claimed.job_id, maliciousJobId);

  // Invoke the real Durable Object alarm entrypoint while frozen; the scoped
  // reconciler must run for this mission only and must not touch foreign jobs.
  await state.storage.put('mission:foreign-mission', {
    mission_id: 'foreign-mission', status: 'running', tasks: [], current_task_id: null,
    event_sequence: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  });
  await state.storage.put('job:foreign-queued-job', {
    job_id: 'foreign-queued-job', mission_id: 'foreign-mission', operation: 'task.execute',
    task_id: 'foreign-task', task: { operation: 'git.status', payload: {} }, status: 'queued',
    worker_id: null, lease_token: null, lease_until: null, attempts: 0,
    created_at: '2000-01-01T00:00:00.000Z', updated_at: '2000-01-01T00:00:00.000Z'
  });
  await store.alarm();
  const scopeAfterAlarm = await state.storage.get('package3:probe:' + probeId);
  assert.equal(scopeAfterAlarm.alarm_tick_count, 1);
  assert.ok(scopeAfterAlarm.last_alarm_at);
  assert.equal((await state.storage.get('job:foreign-queued-job')).status, 'queued');

  const heartbeat = await store.fetch(request('/api/worker/jobs/' + encodeURIComponent(claimed.job_id) + '/heartbeat', {
    method: 'POST', token: WORKER_TOKEN, probeId, scopeToken,
    body: { worker_id: workerId, lease_token: claimed.lease_token }
  }));
  assert.equal(heartbeat.status, 200);
  const taskJobAfterHeartbeat = await state.storage.get('job:' + claimed.job_id);
  assert.equal(taskJobAfterHeartbeat.heartbeat_count, 1);
  assert.ok(taskJobAfterHeartbeat.last_heartbeat_at);

  const completion = await store.fetch(request('/api/worker/jobs/' + encodeURIComponent(claimed.job_id) + '/complete', {
    method: 'POST', token: WORKER_TOKEN, probeId, scopeToken,
    body: {
      worker_id: workerId,
      lease_token: claimed.lease_token,
      result: { passed: true, evidence: { operation: 'git.status', output: '## fix/readonly-pilot\n' } }
    }
  }));
  assert.equal(completion.status, 200);

  const verifyResponse = await store.fetch(request('/api/worker/claim', {
    method: 'POST', token: WORKER_TOKEN, probeId, scopeToken,
    body: { worker_id: workerId, capabilities: ['git.status', 'mission.verify'] }
  }));
  assert.equal(verifyResponse.status, 200);
  const verifyJob = (await payload(verifyResponse)).job;
  assert.equal(verifyJob.operation, 'mission.verify');

  const verifyComplete = await store.fetch(request('/api/worker/jobs/' + encodeURIComponent(verifyJob.job_id) + '/complete', {
    method: 'POST', token: WORKER_TOKEN, probeId, scopeToken,
    body: {
      worker_id: workerId,
      lease_token: verifyJob.lease_token,
      result: {
        passed: true,
        evidence: {
          verification: {
            passed: true,
            reason: 'Readonly git status evidence and completion invariants passed.'
          }
        }
      }
    }
  }));
  assert.equal(verifyComplete.status, 200);
  assert.equal((await payload(verifyComplete)).mission.status, 'succeeded');

  const presence = await store.fetch(request('/api/worker/presence', {
    method: 'POST', token: WORKER_TOKEN, probeId, scopeToken,
    body: { worker_id: workerId, state: 'idle' }
  }));
  assert.equal(presence.status, 200);
  assert.equal((await payload(presence)).presence_count, 1);

  const readback = await payload(await store.fetch(request('/api/package3/probes/' + probeId)));
  assert.equal(readback.scope.status, 'active');
  assert.equal(readback.scope.probe_type, 'readonly_git_status');
  assert.equal(readback.scope.claim_count, 2);
  assert.equal(readback.scope.presence_count, 1);
  assert.equal(readback.scope.last_presence_state, 'idle');
  assert.equal(readback.scope.alarm_tick_count, 1);
  assert.equal(readback.mission.status, 'succeeded');
  assert.equal(readback.mission.progress_percent, 100);
  assert.equal(readback.mission.verification.read_only, true);
  assert.equal(readback.mission.verification.pilot_operation, 'git.status');
  const taskJob = readback.jobs.find(job => job.task_operation === 'git.status');
  assert.ok(taskJob);
  assert.equal(taskJob.status, 'completed');
  assert.equal(taskJob.heartbeat_count, 1);
  assert.equal(taskJob.attempts, 1);
  assert.ok(readback.jobs.some(job => job.operation === 'mission.verify' && job.status === 'completed'));
  assert.equal(readback.jobs.some(job => job.job_id === maliciousJobId && job.status === 'leased'), false);
  assert.equal(readback.notifications.every(item => item.status === 'suppressed_package3_probe'), true);

  const closedResponse = await store.fetch(request('/api/package3/probe/close', {
    method: 'POST', body: { probe_id: probeId, reason: 'readonly_pilot_test_cleanup' }
  }));
  assert.equal(closedResponse.status, 200);
  const closed = await payload(closedResponse);
  assert.equal(closed.scope.status, 'closed');
  assert.ok(closed.scope.scope_token_revoked_at);
  assert.equal(closed.mission.status, 'succeeded');

  const staleClaim = await store.fetch(request('/api/worker/claim', {
    method: 'POST', token: WORKER_TOKEN, probeId, scopeToken,
    body: { worker_id: workerId, capabilities: ['git.status', 'mission.verify'] }
  }));
  assert.equal(staleClaim.status, 423);
  const ordinaryClaimAfter = await store.fetch(request('/api/worker/claim', {
    method: 'POST', token: WORKER_TOKEN, body: { worker_id: 'ordinary-worker' }
  }));
  assert.equal(ordinaryClaimAfter.status, 423);
  const ordinaryCreateAfter = await store.fetch(request('/api/missions', {
    method: 'POST', body: { goal: 'global freeze must remain on after readonly pilot' }
  }));
  assert.equal(ordinaryCreateAfter.status, 423);
  assert.equal((await state.storage.get('job:foreign-queued-job')).status, 'queued');

  process.stdout.write('READONLY_PILOT_ONE_GIT_STATUS_JOB=PASS\n');
  process.stdout.write('READONLY_PILOT_ONLY_ONE_ALLOWED_WORKER=PASS\n');
  process.stdout.write('READONLY_PILOT_WORKSPACE_WRITE_BLOCKED=PASS\n');
  process.stdout.write('READONLY_PILOT_LEASE_HEARTBEAT=PASS\n');
  process.stdout.write('READONLY_PILOT_IDLE_PRESENCE=PASS\n');
  process.stdout.write('READONLY_PILOT_ALARM_RECONCILE_SCOPED=PASS\n');
  process.stdout.write('READONLY_PILOT_VERIFIED_MISSION=PASS\n');
  process.stdout.write('READONLY_PILOT_SCOPE_REVOKED=PASS\n');
  process.stdout.write('READONLY_PILOT_GLOBAL_FREEZE_REMAINS_TRUE=PASS\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
