import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

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
    return new Map(Array.from(this.values.entries()).filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, clone(value)]));
  }
  async setAlarm(value) { this.alarmAt = value; }
}
class MemoryState {
  constructor() { this.storage = new MemoryStorage(); }
  waitUntil() {}
}
const controlToken = 'mission-wonder-2-a3-control-test-token'.padEnd(40, 'c');
const workerToken = 'mission-wonder-2-a3-worker-test-token'.padEnd(40, 'w');
const base = 'https://aria-test.invalid';
function request(route, { method = 'GET', token = controlToken, body, headers = {} } = {}) {
  return new Request(base + route, {
    method,
    headers: { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
async function json(response) { return response.json(); }

async function run() {
  ({ AriaMissionStore, MISSION_EXECUTION_PAUSED } = await import('../cloudflare-autonomy/worker.mjs'));
  assert.equal(MISSION_EXECUTION_PAUSED, true, 'the production coordinator remains globally frozen');

  const state = new MemoryState();
  const store = new AriaMissionStore(state, {
    ARIA_CONTROL_TOKEN: controlToken,
    ARIA_WORKER_TOKEN: workerToken,
    ARIA_ALARM_INTERVAL_MS: 5000
  });
  // Seed existing historical records to prove the A3 probe never changes them.
  state.storage.values.set('mission:historical', { mission_id: 'historical', status: 'planning' });
  state.storage.values.set('job:historical', { job_id: 'historical', status: 'queued' });

  const startPath = '/api/mission-wonder-2/a3/presence-probes/start';
  const closePath = '/api/mission-wonder-2/a3/presence-probes/close';
  const id = 'mw2-a3-test-probe-0001';
  const scopeToken = 'a3-probe-token-' + 'x'.repeat(48);
  const startBody = {
    confirm: 'RUN_MISSION_WONDER_2_A3_PRESENCE_ONLY',
    probe_id: id,
    scope_token: scopeToken,
    ttl_ms: 120000,
    heartbeat_interval_ms: 5000
  };

  assert.equal((await store.fetch(request(startPath, { method: 'POST', token: 'wrong-control-token', body: startBody }))).status, 401);
  assert.equal((await store.fetch(request(startPath, { method: 'POST', body: { ...startBody, confirm: 'NO' } }))).status, 400);

  const started = await store.fetch(request(startPath, { method: 'POST', body: startBody }));
  assert.equal(started.status, 201);
  const startedBody = await json(started);
  assert.equal(startedBody.probe.presence_only, true);
  assert.equal(startedBody.probe.mission_execution_paused, true);
  assert.ok(state.storage.alarmAt, 'the coordinator schedules a TTL/staleness watchdog alarm');

  const duplicate = await store.fetch(request(startPath, {
    method: 'POST',
    body: { ...startBody, probe_id: 'mw2-a3-test-probe-0002', scope_token: scopeToken + 'z' }
  }));
  assert.equal(duplicate.status, 409, 'only one A3 presence scope may be active');

  const headers = {
    'x-aria-mw2-a3-probe-id': id,
    'x-aria-mw2-a3-scope-token': scopeToken,
    'x-aria-mw2-a3-worker-id': 'ROBVG-101'
  };
  assert.equal((await store.fetch(request('/api/worker/presence', {
    method: 'POST', token: 'wrong-worker-token', body: { worker_id: 'ROBVG-101', state: 'idle' }, headers
  }))).status, 401);
  assert.equal((await store.fetch(request('/api/worker/presence', {
    method: 'POST', token: workerToken, body: { worker_id: 'ROBVG-101', state: 'idle' },
    headers: { ...headers, 'x-aria-mw2-a3-scope-token': 'wrong'.padEnd(40, 'x') }
  }))).status, 423);

  const first = await store.fetch(request('/api/worker/presence', {
    method: 'POST', token: workerToken, body: { worker_id: 'ROBVG-101', state: 'idle' }, headers
  }));
  assert.equal(first.status, 200);
  assert.equal((await json(first)).presence_count, 1);

  const concurrentWorker = await store.fetch(request('/api/worker/presence', {
    method: 'POST', token: workerToken, body: { worker_id: 'ROBVG-202', state: 'idle' },
    headers: { ...headers, 'x-aria-mw2-a3-worker-id': 'ROBVG-202' }
  }));
  assert.equal(concurrentWorker.status, 423, 'a second worker cannot take over a fresh heartbeat');

  // The A3 scope must never authorize mission claims, lease heartbeats or jobs.
  const blockedClaim = await store.fetch(request('/api/worker/claim', {
    method: 'POST', token: workerToken, body: { worker_id: 'ROBVG-101' }, headers
  }));
  assert.equal(blockedClaim.status, 423);
  assert.equal((await json(blockedClaim)).error, 'mission_execution_paused');

  let scope = await state.storage.get('mw2:a3:presence:' + id);
  scope.last_presence_at = new Date(Date.now() - scope.stale_after_ms - 1000).toISOString();
  await state.storage.put('mw2:a3:presence:' + id, scope);
  await store.alarm();
  scope = await state.storage.get('mw2:a3:presence:' + id);
  assert.ok(scope.stale_detected_at, 'the alarm detects a missed heartbeat');
  assert.ok(scope.alarm_tick_count >= 1);

  const recovered = await store.fetch(request('/api/worker/presence', {
    method: 'POST', token: workerToken, body: { worker_id: 'ROBVG-202', state: 'idle' },
    headers: { ...headers, 'x-aria-mw2-a3-worker-id': 'ROBVG-202' }
  }));
  assert.equal(recovered.status, 200);
  const recoveryResult = await json(recovered);
  assert.equal(recoveryResult.recovery_count, 1);
  assert.equal(recoveryResult.worker_id, 'ROBVG-202');

  assert.equal((await store.fetch(request('/api/worker/presence', {
    method: 'POST', token: workerToken, body: { worker_id: 'ROBVG-101', state: 'idle' }, headers
  }))).status, 423, 'the previous worker is fenced after recovery');

  const beforeClose = await json(await store.fetch(request('/api/mission-wonder-2/a3/presence-probes/' + id)));
  assert.equal(beforeClose.scope.presence_count, 2);
  assert.equal(beforeClose.scope.recovery_count, 1);
  assert.deepEqual(beforeClose.scope.worker_ids, ['ROBVG-101', 'ROBVG-202']);
  assert.equal(beforeClose.scope.stale, false);
  assert.ok(beforeClose.scope.stale_detected_at, 'the recovered heartbeat retains evidence of the prior stale window');
  assert.equal(beforeClose.scope.mission_job_storage_unchanged, true);
  assert.equal(beforeClose.scope.mission_count_before, 1);
  assert.equal(beforeClose.scope.mission_count_after, 1);
  assert.equal(beforeClose.scope.job_count_before, 1);
  assert.equal(beforeClose.scope.job_count_after, 1);

  const closed = await store.fetch(request(closePath, {
    method: 'POST',
    body: { confirm: 'CLOSE_MISSION_WONDER_2_A3_PRESENCE_ONLY', probe_id: id, reason: 'contract_test_complete' }
  }));
  assert.equal(closed.status, 200);
  const closedBody = await json(closed);
  assert.equal(closedBody.scope.status, 'closed');
  assert.equal(closedBody.scope.scope_token_revoked, true);
  assert.ok(closedBody.scope.scope_token_revoked_at);

  const revoked = await store.fetch(request('/api/worker/presence', {
    method: 'POST', token: workerToken, body: { worker_id: 'ROBVG-202', state: 'idle' },
    headers: { ...headers, 'x-aria-mw2-a3-worker-id': 'ROBVG-202' }
  }));
  assert.equal(revoked.status, 423, 'a closed scope cannot heartbeat');

  // TTL expiry closes and revokes a scope even if no operator sends close.
  const expiryId = 'mw2-a3-test-probe-0003';
  const expiryToken = 'a3-expiry-token-' + 'y'.repeat(48);
  const expiryStart = await store.fetch(request(startPath, {
    method: 'POST',
    body: { ...startBody, probe_id: expiryId, scope_token: expiryToken, ttl_ms: 60000 }
  }));
  assert.equal(expiryStart.status, 201);
  const expiringScope = await state.storage.get('mw2:a3:presence:' + expiryId);
  expiringScope.expires_at = new Date(Date.now() - 1000).toISOString();
  await state.storage.put('mw2:a3:presence:' + expiryId, expiringScope);
  await store.alarm();
  const expiredReadback = await json(await store.fetch(request('/api/mission-wonder-2/a3/presence-probes/' + expiryId)));
  assert.equal(expiredReadback.scope.status, 'closed');
  assert.equal(expiredReadback.scope.scope_token_revoked, true);
  assert.equal(expiredReadback.scope.close_reason, 'presence_probe_ttl_expired');

  assert.equal((await store.fetch(request('/api/missions', { method: 'POST', body: { goal: 'must remain frozen' } }))).status, 423);
  assert.equal((await store.fetch(request('/api/worker/claim', {
    method: 'POST', token: workerToken, body: { worker_id: 'must-remain-frozen' }
  }))).status, 423);
  assert.equal((await state.storage.list({ prefix: 'mission:' })).size, 1);
  assert.equal((await state.storage.list({ prefix: 'job:' })).size, 1);

  process.stdout.write('MISSION_WONDER_2_A3_PRESENCE_ONLY=PASS\n');
  process.stdout.write('MISSION_WONDER_2_A3_SINGLE_WORKER_AND_RECOVERY=PASS\n');
  process.stdout.write('MISSION_WONDER_2_A3_STALE_HEARTBEAT_AND_TTL_REVOCATION=PASS\n');
  process.stdout.write('MISSION_WONDER_2_A3_NO_MISSION_OR_JOB_MUTATION=PASS\n');
}

run().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
