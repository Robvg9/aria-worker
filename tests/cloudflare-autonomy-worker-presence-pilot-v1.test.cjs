'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const CONTROL_TOKEN = 'a3-presence-control-token'.padEnd(48, 'c');
const WORKER_TOKEN = 'a3-presence-worker-token'.padEnd(48, 'w');
const SCOPE_TOKEN = crypto.randomBytes(48).toString('base64url');
const PROBE_ID = 'a3-presence-pilot-0001';
const WORKER_ID = 'ROBVG-ARIA-A3-PRESENCE';

class MemoryStorage {
  constructor() { this.values = new Map(); this.alarmAt = null; }
  async get(key) {
    const value = this.values.get(key);
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }
  async put(key, value) { this.values.set(key, JSON.parse(JSON.stringify(value))); }
  async list({ prefix = '' } = {}) {
    return new Map(Array.from(this.values.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key, JSON.parse(JSON.stringify(value))]));
  }
}

async function call(store, route, {
  method = 'GET', token = CONTROL_TOKEN, body, probeId, scopeToken, workerId, instanceId
} = {}) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (probeId) headers['x-aria-worker-presence-probe-id'] = probeId;
  if (scopeToken) headers['x-aria-worker-presence-scope-token'] = scopeToken;
  if (workerId) headers['x-aria-worker-presence-worker-id'] = workerId;
  if (instanceId) headers['x-aria-worker-presence-instance-id'] = instanceId;
  return store.fetch(new Request('https://coordinator.test' + route, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  }));
}

async function payload(response) { return response.json(); }

(async () => {
  const { AriaMissionStore, MISSION_EXECUTION_PAUSED } =
    await import('../cloudflare-autonomy/worker.mjs');
  assert.equal(MISSION_EXECUTION_PAUSED, true, 'global production freeze must remain true');
  const storage = new MemoryStorage();
  const store = new AriaMissionStore({ storage, waitUntil() {} }, {
    ARIA_CONTROL_TOKEN: CONTROL_TOKEN,
    ARIA_WORKER_TOKEN: WORKER_TOKEN,
    ARIA_ALARM_INTERVAL_MS: '5000'
  });

  const unauthorizedStart = await call(store, '/api/worker-presence/probe/start', {
    method: 'POST', token: null,
    body: { confirm: 'RUN_ONE_WORKER_PRESENCE_ONLY_PILOT', probe_id: PROBE_ID, worker_id: WORKER_ID, scope_token: SCOPE_TOKEN }
  });
  assert.equal(unauthorizedStart.status, 401);

  const ordinaryCreateBefore = await call(store, '/api/missions', {
    method: 'POST', body: { goal: 'must remain frozen before A3 presence pilot' }
  });
  const ordinaryClaimBefore = await call(store, '/api/worker/claim', {
    method: 'POST', token: WORKER_TOKEN, body: { worker_id: WORKER_ID }
  });
  assert.equal(ordinaryCreateBefore.status, 423);
  assert.equal(ordinaryClaimBefore.status, 423);

  const start = await call(store, '/api/worker-presence/probe/start', {
    method: 'POST',
    body: { confirm: 'RUN_ONE_WORKER_PRESENCE_ONLY_PILOT', probe_id: PROBE_ID, worker_id: WORKER_ID, scope_token: SCOPE_TOKEN }
  });
  assert.equal(start.status, 201, await payload(start));
  const startBody = await payload(start);
  assert.equal(startBody.scope.status, 'active');
  assert.equal(startBody.scope.probe_type, 'presence_only');
  assert.equal(startBody.scope.worker_id, WORKER_ID);
  assert.equal(startBody.scope.mission_created, false);
  assert.equal(startBody.scope.jobs_created, 0);
  assert.equal(startBody.scope.presence_count, 0);
  assert.ok(Date.parse(startBody.scope.expires_at) - Date.now() <= 8 * 60 * 1000);

  const duplicatePilot = await call(store, '/api/worker-presence/probe/start', {
    method: 'POST',
    body: { confirm: 'RUN_ONE_WORKER_PRESENCE_ONLY_PILOT', probe_id: 'a3-presence-pilot-0002', worker_id: WORKER_ID, scope_token: crypto.randomBytes(48).toString('base64url') }
  });
  assert.equal(duplicatePilot.status, 409);
  assert.equal((await payload(duplicatePilot)).error, 'worker_presence_pilot_already_active');

  const unauthenticatedPresence = await call(store, '/api/worker/presence', {
    method: 'POST', token: null, body: { worker_id: WORKER_ID, instance_id: 'instance-a3-00000001', state: 'idle' },
    probeId: PROBE_ID, scopeToken: SCOPE_TOKEN, workerId: WORKER_ID, instanceId: 'instance-a3-00000001'
  });
  assert.equal(unauthenticatedPresence.status, 401);

  const unscopedPresence = await call(store, '/api/worker/presence', {
    method: 'POST', token: WORKER_TOKEN, body: { worker_id: WORKER_ID, instance_id: 'instance-a3-00000001', state: 'idle' }
  });
  assert.equal(unscopedPresence.status, 423);

  const wrongToken = await call(store, '/api/worker/presence', {
    method: 'POST', token: WORKER_TOKEN,
    body: { worker_id: WORKER_ID, instance_id: 'instance-a3-00000001', state: 'idle' },
    probeId: PROBE_ID, scopeToken: crypto.randomBytes(48).toString('base64url'), workerId: WORKER_ID, instanceId: 'instance-a3-00000001'
  });
  assert.equal(wrongToken.status, 423);

  const first = await call(store, '/api/worker/presence', {
    method: 'POST', token: WORKER_TOKEN,
    body: { worker_id: WORKER_ID, instance_id: 'instance-a3-00000001', state: 'idle' },
    probeId: PROBE_ID, scopeToken: SCOPE_TOKEN, workerId: WORKER_ID, instanceId: 'instance-a3-00000001'
  });
  assert.equal(first.status, 200);
  assert.equal((await payload(first)).presence_count, 1);

  const duplicateInstance = await call(store, '/api/worker/presence', {
    method: 'POST', token: WORKER_TOKEN,
    body: { worker_id: WORKER_ID, instance_id: 'instance-a3-00000002', state: 'idle' },
    probeId: PROBE_ID, scopeToken: SCOPE_TOKEN, workerId: WORKER_ID, instanceId: 'instance-a3-00000002'
  });
  assert.equal(duplicateInstance.status, 409);
  assert.equal((await payload(duplicateInstance)).error, 'worker_presence_instance_already_active');

  const sameInstance = await call(store, '/api/worker/presence', {
    method: 'POST', token: WORKER_TOKEN,
    body: { worker_id: WORKER_ID, instance_id: 'instance-a3-00000001', state: 'idle' },
    probeId: PROBE_ID, scopeToken: SCOPE_TOKEN, workerId: WORKER_ID, instanceId: 'instance-a3-00000001'
  });
  assert.equal(sameInstance.status, 200);
  assert.equal((await payload(sameInstance)).presence_count, 2);

  const persistedScope = await storage.get('worker-presence:probe:' + PROBE_ID);
  persistedScope.instance_lease_until = new Date(Date.now() - 1000).toISOString();
  await storage.put('worker-presence:probe:' + PROBE_ID, persistedScope);
  const recoveredInstance = await call(store, '/api/worker/presence', {
    method: 'POST', token: WORKER_TOKEN,
    body: { worker_id: WORKER_ID, instance_id: 'instance-a3-00000002', state: 'idle' },
    probeId: PROBE_ID, scopeToken: SCOPE_TOKEN, workerId: WORKER_ID, instanceId: 'instance-a3-00000002'
  });
  assert.equal(recoveredInstance.status, 200);
  const recoveredBody = await payload(recoveredInstance);
  assert.equal(recoveredBody.presence_count, 3);
  assert.equal(recoveredBody.instance_takeover_count, 1);

  const staleInstance = await call(store, '/api/worker/presence', {
    method: 'POST', token: WORKER_TOKEN,
    body: { worker_id: WORKER_ID, instance_id: 'instance-a3-00000001', state: 'idle' },
    probeId: PROBE_ID, scopeToken: SCOPE_TOKEN, workerId: WORKER_ID, instanceId: 'instance-a3-00000001'
  });
  assert.equal(staleInstance.status, 409);

  const readback = await call(store, '/api/worker-presence/probes/' + PROBE_ID);
  assert.equal(readback.status, 200);
  const readbackBody = await payload(readback);
  assert.equal(readbackBody.scope.status, 'active');
  assert.equal(readbackBody.scope.presence_count, 3);
  assert.equal(readbackBody.scope.instance_takeover_count, 1);
  assert.equal(readbackBody.scope.active_instance_id, 'instance-a3-00000002');
  assert.equal(readbackBody.scope.mission_created, false);
  assert.equal(readbackBody.scope.jobs_created, 0);

  const missionsBeforeClose = await storage.list({ prefix: 'mission:' });
  const jobsBeforeClose = await storage.list({ prefix: 'job:' });
  assert.equal(missionsBeforeClose.size, 0, 'presence pilot must create no mission records');
  assert.equal(jobsBeforeClose.size, 0, 'presence pilot must create no job or lease records');

  const close = await call(store, '/api/worker-presence/probe/close', {
    method: 'POST', body: { probe_id: PROBE_ID, reason: 'a3_presence_pilot_verified' }
  });
  assert.equal(close.status, 200);
  const closedBody = await payload(close);
  assert.equal(closedBody.scope.status, 'closed');
  assert.ok(closedBody.scope.scope_token_revoked_at);
  assert.equal(closedBody.scope.active_instance_id, null);

  const postCloseHeartbeat = await call(store, '/api/worker/presence', {
    method: 'POST', token: WORKER_TOKEN,
    body: { worker_id: WORKER_ID, instance_id: 'instance-a3-00000002', state: 'idle' },
    probeId: PROBE_ID, scopeToken: SCOPE_TOKEN, workerId: WORKER_ID, instanceId: 'instance-a3-00000002'
  });
  assert.equal(postCloseHeartbeat.status, 423);

  const ordinaryCreateAfter = await call(store, '/api/missions', {
    method: 'POST', body: { goal: 'must remain frozen after A3 presence pilot' }
  });
  const ordinaryClaimAfter = await call(store, '/api/worker/claim', {
    method: 'POST', token: WORKER_TOKEN, body: { worker_id: WORKER_ID }
  });
  assert.equal(ordinaryCreateAfter.status, 423);
  assert.equal(ordinaryClaimAfter.status, 423);

  const missionsAfterClose = await storage.list({ prefix: 'mission:' });
  const jobsAfterClose = await storage.list({ prefix: 'job:' });
  assert.equal(missionsAfterClose.size, 0);
  assert.equal(jobsAfterClose.size, 0);

  process.stdout.write('A3_GLOBAL_MISSION_FREEZE_PRESERVED=PASS\n');
  process.stdout.write('A3_SCOPED_IDLE_HEARTBEAT_ONLY=PASS\n');
  process.stdout.write('A3_SINGLE_ACTIVE_INSTANCE_LEASE=PASS\n');
  process.stdout.write('A3_INSTANCE_TAKEOVER_AFTER_EXPIRY=PASS\n');
  process.stdout.write('A3_NO_MISSION_JOB_OR_JOB_LEASE_CREATED=PASS\n');
  process.stdout.write('A3_SCOPE_CLOSE_AND_TOKEN_REVOCATION=PASS\n');
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
