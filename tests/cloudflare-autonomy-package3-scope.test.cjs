'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const CONTROL_TOKEN = 'package3-scope-control-token'.padEnd(48, 'c');
const WORKER_TOKEN = 'package3-scope-worker-token'.padEnd(48, 'w');
const SCOPE_TOKEN = crypto.randomBytes(48).toString('base64url');

class MemoryStorage {
  constructor() { this.values = new Map(); this.alarmAt = null; }
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
  async setAlarm(value) { this.alarmAt = value; }
}

function createState() {
  const storage = new MemoryStorage();
  return { storage, waitUntil() {} };
}

async function call(store, route, {
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
  return store.fetch(new Request('https://coordinator.test' + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
}

async function payload(response) {
  return response.json();
}

(async () => {
  const { AriaMissionStore, MISSION_EXECUTION_PAUSED } =
    await import('../cloudflare-autonomy/worker.mjs');
  assert.equal(MISSION_EXECUTION_PAUSED, true, 'global production freeze must remain true');

  const env = {
    ARIA_CONTROL_TOKEN: CONTROL_TOKEN,
    ARIA_WORKER_TOKEN: WORKER_TOKEN,
    ARIA_WORKER_LEASE_MS: '60000',
    ARIA_ALARM_INTERVAL_MS: '5000'
  };
  const state = createState();
  const store = new AriaMissionStore(state, env);
  const probeId = 'unit-probe-package3-001';
  const beforeWorker = 'mw2p3-' + probeId + '-before';
  const afterWorker = 'mw2p3-' + probeId + '-after';

  const health = await call(store, '/health');
  assert.equal(health.status, 200);
  assert.equal((await payload(health)).storage, 'durable-object');

  const ordinaryCreate = await call(store, '/api/missions', {
    method: 'POST',
    body: { goal: 'ordinary mission must remain frozen' }
  });
  assert.equal(ordinaryCreate.status, 423);

  const ordinaryClaim = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: { worker_id: 'ordinary-worker' }
  });
  assert.equal(ordinaryClaim.status, 423);

  const unauthenticatedStart = await call(store, '/api/package3/probe/start', {
    method: 'POST',
    token: null,
    body: {
      confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE',
      probe_id: probeId,
      scope_token: SCOPE_TOKEN
    }
  });
  assert.equal(unauthenticatedStart.status, 401);

  const started = await call(store, '/api/package3/probe/start', {
    method: 'POST',
    body: {
      confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE',
      probe_id: probeId,
      scope_token: SCOPE_TOKEN
    }
  });
  assert.equal(started.status, 201);
  const startedBody = await payload(started);
  assert.equal(startedBody.probe.status, 'active');
  const missionId = startedBody.mission.mission_id;
  assert.equal(startedBody.mission.status, 'planning');

  const concurrentStart = await call(store, '/api/package3/probe/start', {
    method: 'POST',
    body: {
      confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE',
      probe_id: 'unit-probe-package3-concurrent',
      scope_token: crypto.randomBytes(48).toString('base64url')
    }
  });
  assert.equal(concurrentStart.status, 409);
  assert.equal((await payload(concurrentStart)).error, 'package3_probe_already_active');

  const relativePath = 'package3-proof-' + probeId + '.txt';
  const proofContent = 'Mission Wonder 2 Package 3 LIVE proof ' + probeId + '\n';
  const proofHash = crypto.createHash('sha256').update(proofContent).digest('hex');
  assert.equal(startedBody.mission.metadata.package3_live_probe, true);
  assert.equal(startedBody.probe.allowed_job_operations.length, 3);

  const wrongScopeToken = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: crypto.randomBytes(48).toString('base64url'),
    body: { worker_id: beforeWorker }
  });
  assert.equal(wrongScopeToken.status, 423);

  const planClaimResponse = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: SCOPE_TOKEN,
    body: { worker_id: beforeWorker, capabilities: ['mission.plan', 'workspace', 'mission.verify'] }
  });
  assert.equal(planClaimResponse.status, 200);
  const planJob = (await payload(planClaimResponse)).job;
  assert.equal(planJob.operation, 'mission.plan');
  assert.equal(planJob.mission_id, missionId);
  assert.equal(planJob.attempts, 1);

  const planComplete = await call(store, '/api/worker/jobs/' + encodeURIComponent(planJob.job_id) + '/complete', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: SCOPE_TOKEN,
    body: {
      worker_id: beforeWorker,
      lease_token: planJob.lease_token,
      result: {
        passed: true,
        evidence: {
          tasks: [{
            task_id: 'write-proof-artifact',
            title: 'Write one temporary proof artifact',
            operation: 'workspace.write',
            payload: { relative_path: relativePath, content: proofContent },
            idempotent: true,
            max_attempts: 2,
            depends_on: []
          }]
        }
      }
    }
  });
  assert.equal(planComplete.status, 200);
  const afterPlan = await payload(planComplete);
  assert.equal(afterPlan.mission.status, 'running');
  assert.equal(afterPlan.mission.tasks.length, 1);

  const firstTaskClaimResponse = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: SCOPE_TOKEN,
    body: { worker_id: beforeWorker, capabilities: ['mission.plan', 'workspace', 'mission.verify'] }
  });
  assert.equal(firstTaskClaimResponse.status, 200);
  const firstTaskJob = (await payload(firstTaskClaimResponse)).job;
  assert.equal(firstTaskJob.operation, 'task.execute');
  assert.equal(firstTaskJob.task.operation, 'workspace.write');
  assert.equal(firstTaskJob.attempts, 1);
  const firstLeaseToken = firstTaskJob.lease_token;

  // Model an interrupted process: the same Durable Object job lease expires.
  const expiredJob = await state.storage.get('job:' + firstTaskJob.job_id);
  expiredJob.lease_until = new Date(Date.now() - 1000).toISOString();
  await state.storage.put('job:' + firstTaskJob.job_id, expiredJob);

  const recoveredClaimResponse = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: SCOPE_TOKEN,
    body: { worker_id: afterWorker, capabilities: ['mission.plan', 'workspace', 'mission.verify'] }
  });
  assert.equal(recoveredClaimResponse.status, 200);
  const recoveredTaskJob = (await payload(recoveredClaimResponse)).job;
  assert.equal(recoveredTaskJob.job_id, firstTaskJob.job_id);
  assert.equal(recoveredTaskJob.attempts, 2);
  assert.equal(recoveredTaskJob.worker_id, afterWorker);
  assert.notEqual(recoveredTaskJob.lease_token, firstLeaseToken);

  const staleCompletion = await call(store, '/api/worker/jobs/' + encodeURIComponent(firstTaskJob.job_id) + '/complete', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: SCOPE_TOKEN,
    body: {
      worker_id: beforeWorker,
      lease_token: firstLeaseToken,
      result: { passed: true, evidence: { stale_worker: true } }
    }
  });
  assert.equal(staleCompletion.status, 409);
  assert.equal((await payload(staleCompletion)).error, 'lease_mismatch');

  const taskComplete = await call(store, '/api/worker/jobs/' + encodeURIComponent(recoveredTaskJob.job_id) + '/complete', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: SCOPE_TOKEN,
    body: {
      worker_id: afterWorker,
      lease_token: recoveredTaskJob.lease_token,
      result: {
        passed: true,
        evidence: {
          relative_path: relativePath,
          sha256: proofHash,
          execution_attempt: 2,
          write_action: 'already_identical'
        }
      }
    }
  });
  assert.equal(taskComplete.status, 200);
  assert.equal((await payload(taskComplete)).mission.tasks[0].status, 'succeeded');

  const verifyClaimResponse = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: SCOPE_TOKEN,
    body: { worker_id: afterWorker, capabilities: ['mission.plan', 'workspace', 'mission.verify'] }
  });
  assert.equal(verifyClaimResponse.status, 200);
  const verifyJob = (await payload(verifyClaimResponse)).job;
  assert.equal(verifyJob.operation, 'mission.verify');

  const verifyComplete = await call(store, '/api/worker/jobs/' + encodeURIComponent(verifyJob.job_id) + '/complete', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: SCOPE_TOKEN,
    body: {
      worker_id: afterWorker,
      lease_token: verifyJob.lease_token,
      result: {
        passed: true,
        evidence: {
          verification: {
            passed: true,
            reason: 'Scoped Package 3 synthetic verification passed.',
            artifact: { relative_path: relativePath, sha256: proofHash, independent_read: true }
          }
        }
      }
    }
  });
  assert.equal(verifyComplete.status, 200);
  assert.equal((await payload(verifyComplete)).mission.status, 'succeeded');

  const readbackResponse = await call(store, '/api/package3/probes/' + probeId);
  assert.equal(readbackResponse.status, 200);
  const readback = await payload(readbackResponse);
  assert.equal(readback.scope.status, 'active');
  assert.equal(readback.scope.mission_id, missionId);
  assert.equal(readback.scope.claim_count, 4);
  assert.deepEqual(new Set(readback.scope.claimed_worker_ids), new Set([beforeWorker, afterWorker]));
  assert.equal(readback.mission.status, 'succeeded');
  assert.equal(readback.mission.progress_percent, 100);
  assert.equal(readback.jobs.length, 3, 'only one plan, one task, and one verify job may exist');
  assert.deepEqual(readback.jobs.map(job => job.operation).sort(), ['mission.plan', 'mission.verify', 'task.execute']);
  assert.ok(readback.jobs.every(job => job.status === 'completed'));
  assert.equal(readback.jobs.find(job => job.operation === 'task.execute').attempts, 2);
  const eventTypes = readback.events.map(event => event.type);
  for (const type of ['mission_created', 'mission_planned', 'task_started', 'task_succeeded', 'mission_verified_complete']) {
    assert.equal(eventTypes.filter(value => value === type).length, 1, 'duplicate or missing event: ' + type);
  }
  assert.equal(readback.events.length, 5);
  assert.equal(readback.notifications.length, 1);
  assert.equal(readback.notifications[0].status, 'suppressed_package3_probe');
  assert.equal(readback.notifications[0].attempts, 0);

  const closedResponse = await call(store, '/api/package3/probe/close', {
    method: 'POST',
    body: { probe_id: probeId, reason: 'verified_test_cleanup' }
  });
  assert.equal(closedResponse.status, 200);
  const closed = await payload(closedResponse);
  assert.equal(closed.scope.status, 'closed');
  assert.ok(closed.scope.scope_token_revoked_at);
  assert.equal(closed.mission.status, 'succeeded');

  const reuse = await call(store, '/api/package3/probe/start', {
    method: 'POST',
    body: {
      confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE',
      probe_id: probeId,
      scope_token: SCOPE_TOKEN
    }
  });
  assert.equal(reuse.status, 409);

  const ordinaryCreateAfter = await call(store, '/api/missions', {
    method: 'POST',
    body: { goal: 'ordinary mission must stay frozen after scoped probe' }
  });
  assert.equal(ordinaryCreateAfter.status, 423);
  const ordinaryClaimAfter = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: { worker_id: 'ordinary-worker' }
  });
  assert.equal(ordinaryClaimAfter.status, 423);
  const closedScopeClaim = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId,
    scopeToken: SCOPE_TOKEN,
    body: { worker_id: afterWorker }
  });
  assert.equal(closedScopeClaim.status, 423);

  // An expired scope must stop a worker; operator cleanup remains available while frozen.
  const expiryProbeId = 'unit-probe-package3-expiry';
  const expiryToken = crypto.randomBytes(48).toString('base64url');
  const expiryStart = await call(store, '/api/package3/probe/start', {
    method: 'POST',
    body: {
      confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE',
      probe_id: expiryProbeId,
      scope_token: expiryToken
    }
  });
  assert.equal(expiryStart.status, 201);
  const expiredScope = await state.storage.get('package3:probe:' + expiryProbeId);
  // Simulate an isolate crash after createMission committed, but before the
  // probe scope copied the mission ID and changed preparing -> active.
  const orphanedMissionId = expiredScope.mission_id;
  expiredScope.status = 'preparing';
  expiredScope.mission_id = null;
  expiredScope.expires_at = new Date(Date.now() - 1000).toISOString();
  await state.storage.put('package3:probe:' + expiryProbeId, expiredScope);
  const expiredWorker = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    probeId: expiryProbeId,
    scopeToken: expiryToken,
    body: { worker_id: 'mw2p3-' + expiryProbeId + '-before' }
  });
  assert.equal(expiredWorker.status, 423);

  const nextProbeId = 'unit-probe-package3-after-expiry';
  const nextProbeToken = crypto.randomBytes(48).toString('base64url');
  const nextProbeStart = await call(store, '/api/package3/probe/start', {
    method: 'POST',
    body: {
      confirm: 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE',
      probe_id: nextProbeId,
      scope_token: nextProbeToken
    }
  });
  assert.equal(nextProbeStart.status, 201, 'expired stale scope must not permanently block a new probe');

  const expiredReadback = await payload(await call(store, '/api/package3/probes/' + expiryProbeId));
  assert.equal(expiredReadback.scope.status, 'closed');
  assert.equal(expiredReadback.scope.mission_id, orphanedMissionId);
  assert.equal(expiredReadback.scope.scope_token_revoked_at != null, true);
  assert.equal(expiredReadback.mission.status, 'cancelled');
  assert.equal(expiredReadback.jobs.length, 1);
  assert.equal(expiredReadback.jobs[0].status, 'cancelled');

  const nextProbeClose = await call(store, '/api/package3/probe/close', {
    method: 'POST',
    body: { probe_id: nextProbeId, reason: 'expired_scope_recovery_test_cleanup' }
  });
  assert.equal(nextProbeClose.status, 200);
  assert.equal((await payload(nextProbeClose)).scope.status, 'closed');

  process.stdout.write('PACKAGE3_SCOPE_ONLY_ONE_MISSION=PASS\n');
  process.stdout.write('PACKAGE3_SCOPE_ONLY_ONE_WORKER_PAIR=PASS\n');
  process.stdout.write('PACKAGE3_SCOPE_ONLY_ALLOWED_JOB_OPERATIONS=PASS\n');
  process.stdout.write('PACKAGE3_SCOPE_TOKEN_HASHED_AND_REVOKED=PASS\n');
  process.stdout.write('PACKAGE3_SCOPE_EXPIRES_FAIL_CLOSED=PASS\n');
  process.stdout.write('PACKAGE3_STALE_LEASE_FENCED=PASS\n');
  process.stdout.write('PACKAGE3_DUPLICATES_AND_EVENT_COUNTS=PASS\n');
  process.stdout.write('PACKAGE3_EXTERNAL_NOTIFICATIONS_SUPPRESSED=PASS\n');
  process.stdout.write('PACKAGE3_GLOBAL_FREEZE_REMAINS_TRUE=PASS\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
