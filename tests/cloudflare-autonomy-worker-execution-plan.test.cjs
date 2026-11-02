'use strict';

const assert = require('node:assert/strict');
const CONTROL_TOKEN = 'execution-plan-control-token'.padEnd(48, 'c');
const WORKER_TOKEN = 'execution-plan-worker-token'.padEnd(48, 'w');

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

async function call(store, route, { method = 'GET', token = CONTROL_TOKEN, body } = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return store.fetch(new Request('https://coordinator.test' + route, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
}

(async () => {
  const { AriaMissionStore, MISSION_EXECUTION_PAUSED } = await import('../cloudflare-autonomy/worker.mjs');
  assert.equal(MISSION_EXECUTION_PAUSED, true, 'production default freeze must remain true');
  const state = { storage: new MemoryStorage(), waitUntil() {} };
  const store = new AriaMissionStore(state, {
    ARIA_CONTROL_TOKEN: CONTROL_TOKEN,
    ARIA_WORKER_TOKEN: WORKER_TOKEN,
    ARIA_WORKER_LEASE_MS: '60000',
    ARIA_ALARM_INTERVAL_MS: '5000'
  });

  // This instance override models the separately reviewed/unfrozen control
  // plane for contract testing only; production's exported constant stays true.
  store.isMissionExecutionPaused = () => false;

  const created = await call(store, '/api/missions', {
    method: 'POST',
    body: {
      goal: 'Execute a remote-approved, bounded workspace task',
      policy: { max_risk: 'medium', require_human_approval: true, max_steps: 2 }
    }
  });
  assert.equal(created.status, 201);
  const missionId = (await created.json()).mission.mission_id;

  const workerTokenCannotSubmitPlan = await call(store, '/api/missions/' + missionId + '/plan', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: { tasks: [] }
  });
  assert.equal(workerTokenCannotSubmitPlan.status, 401);

  const workerCannotClaimPlannerJob = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: {
      worker_id: 'robvg-execution-only',
      capabilities: ['workspace.write', 'mission.verify']
    }
  });
  assert.equal(workerCannotClaimPlannerJob.status, 200);
  assert.equal((await workerCannotClaimPlannerJob.json()).job, null,
    'an execution-only worker must not claim mission.plan jobs');

  const plannerPlan = [{
    task_id: 'write-proof',
    title: 'Write a bounded proof file',
    description: 'Create one text file in the approved workspace.',
    operation: 'workspace.write',
    payload: { path: 'proof/remote-plan.txt', content: 'remote plan accepted\n' },
    depends_on: [],
    idempotent: true,
    max_attempts: 2
  }];
  const planResponse = await call(store, '/api/missions/' + missionId + '/plan', {
    method: 'POST',
    body: { tasks: plannerPlan }
  });
  assert.equal(planResponse.status, 201);
  const planned = (await planResponse.json()).mission;
  assert.equal(planned.status, 'running');
  assert.equal(planned.tasks.length, 1);
  assert.equal(planned.tasks[0].task_id, 'write-proof');

  const planJobs = await state.storage.list({ prefix: 'job:' });
  const obsoletePlanJob = Array.from(planJobs.values()).find(job =>
    job.mission_id === missionId && job.operation === 'mission.plan'
  );
  assert.ok(obsoletePlanJob);
  assert.equal(obsoletePlanJob.status, 'cancelled',
    'remote plan acceptance must fence/cancel the planner queue job');

  const executionClaim = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: {
      worker_id: 'robvg-execution-only',
      capabilities: ['workspace.write', 'mission.verify']
    }
  });
  assert.equal(executionClaim.status, 200);
  const executionJob = (await executionClaim.json()).job;
  assert.equal(executionJob.operation, 'task.execute');
  assert.equal(executionJob.task.operation, 'workspace.write');

  const executionComplete = await call(store, '/api/worker/jobs/' + encodeURIComponent(executionJob.job_id) + '/complete', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: {
      worker_id: 'robvg-execution-only',
      lease_token: executionJob.lease_token,
      result: {
        passed: true,
        evidence: { path: 'proof/remote-plan.txt', sha256: 'a'.repeat(64) }
      }
    }
  });
  assert.equal(executionComplete.status, 200);
  assert.equal((await executionComplete.json()).mission.tasks[0].status, 'succeeded');

  const verificationClaim = await call(store, '/api/worker/claim', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: {
      worker_id: 'robvg-execution-only',
      capabilities: ['workspace.write', 'mission.verify']
    }
  });
  assert.equal(verificationClaim.status, 200);
  const verificationJob = (await verificationClaim.json()).job;
  assert.equal(verificationJob.operation, 'mission.verify');

  const verificationComplete = await call(store, '/api/worker/jobs/' + encodeURIComponent(verificationJob.job_id) + '/complete', {
    method: 'POST',
    token: WORKER_TOKEN,
    body: {
      worker_id: 'robvg-execution-only',
      lease_token: verificationJob.lease_token,
      result: {
        passed: true,
        evidence: { verification: { passed: true, reason: 'remote plan executed and evidence returned' } }
      }
    }
  });
  assert.equal(verificationComplete.status, 200);
  const completed = (await verificationComplete.json()).mission;
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.progress_percent, 100);

  const badPlanMission = await call(store, '/api/missions', {
    method: 'POST',
    body: { goal: 'Reject unsafe plans' }
  });
  assert.equal(badPlanMission.status, 201);
  const badMissionId = (await badPlanMission.json()).mission.mission_id;
  const unsafePlan = await call(store, '/api/missions/' + badMissionId + '/plan', {
    method: 'POST',
    body: {
      tasks: [{
        task_id: 'unsafe-shell',
        operation: 'shell.execute',
        payload: { command: 'whoami' },
        depends_on: []
      }]
    }
  });
  assert.equal(unsafePlan.status, 422);
  assert.equal((await unsafePlan.json()).error, 'plan_operation_rejected:shell.execute');
  assert.equal((await store.getMission(badMissionId)).status, 'planning');

  process.stdout.write('cloudflare execution-only remote-plan contract: PASS\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
