'use strict';

const assert = require('node:assert/strict');
const {
  createRemoteServiceCircuitCoordinator,
  DEFAULT_COORDINATOR_URL
} = require('../agents/shared/remote-service-circuit-coordinator.cjs');

async function main() {
  let calls = [];
  let now = 1_800_000_000_000;
  const token = 'test-worker-token'.padEnd(48, 'w');
  const sourceDevice = 'device-private-id-windows-01';
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === 'POST') {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({
        open: true,
        opened_now: true,
        circuit: {
          incident_id: 'gateway402_test123',
          status: 402,
          classification: body.classification,
          route: body.route,
          opened_at: new Date(now).toISOString(),
          observation_count: 1,
          installation_count: 1
        },
        notification: { status: 'delivered', attempts: 1 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      open: false,
      circuit: null,
      last_reset: {
        incident_id: 'gateway402_previous',
        service_restored: true,
        closed_at: new Date(now).toISOString(),
        evidence_ref: 'https://github.com/Robvg9/aria-worker/actions/runs/123456789'
      }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const coordinator = createRemoteServiceCircuitCoordinator({
    baseUrl: DEFAULT_COORDINATOR_URL,
    token,
    deviceId: sourceDevice,
    agent: 'windows',
    fetchImpl,
    now: () => now,
    pollIntervalMs: 30_000
  });
  assert.equal(coordinator.configured, true);

  const published = await coordinator.reportIncident({
    incident_id: 'local_incident_123',
    classification: 'quota_exhausted',
    route: '/v1/devices/heartbeat'
  });
  assert.equal(published.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url, DEFAULT_COORDINATOR_URL + '/api/worker/service-circuit');
  assert.equal(calls[0].init.headers.authorization, 'Bearer ' + token);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.incident_id, 'local_incident_123');
  assert.equal(sent.classification, 'quota_exhausted');
  assert.equal(sent.route, '/v1/devices/heartbeat');
  assert.equal(sent.agent, 'windows');
  assert.equal(sent.source_id_sha256, coordinator.sourceIdSha256);
  assert.match(sent.source_id_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(sent).includes(sourceDevice), false);
  assert.equal(JSON.stringify(sent).includes(token), false);
  assert.equal(Object.hasOwn(sent, 'raw_body'), false);

  const applied = [];
  const breaker = {
    async applyGlobalCircuit(snapshot) {
      applied.push(snapshot);
      return { applied: true };
    }
  };
  const synced = await coordinator.sync(breaker, { force: true });
  assert.equal(synced.synced, true);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].open, false);
  assert.equal(calls[1].init.method, 'GET');

  const cached = await coordinator.sync(breaker);
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 2, 'sync interval must prevent repeated coordinator polling');

  now += 30_001;
  const secondSync = await coordinator.sync(breaker);
  assert.equal(secondSync.synced, true);
  assert.equal(calls.length, 3);

  const invalid = await coordinator.reportIncident({
    incident_id: 'invalid_incident_123',
    classification: 'unknown',
    route: '/v1/devices/heartbeat'
  });
  assert.equal(invalid.ok, false);
  assert.equal(calls.length, 3, 'invalid local incident cannot be sent upstream');

  const unconfigured = createRemoteServiceCircuitCoordinator({
    baseUrl: 'https://aria-autonomy-coordinator.robvg9.workers.dev',
    token: '',
    fetchImpl: async () => { throw new Error('must_not_call'); }
  });
  assert.equal(unconfigured.configured, false);
  assert.equal((await unconfigured.sync(breaker)).reason, 'coordinator_not_configured');
  assert.equal((await unconfigured.reportIncident({})).reason, 'coordinator_not_configured');

  const insecure = createRemoteServiceCircuitCoordinator({
    baseUrl: 'http://coordinator.invalid',
    token,
    fetchImpl
  });
  assert.equal(insecure.configured, false, 'HTTP coordinator URL must fail closed');

  console.log('ARIA_OPTIMA_DISTRIBUTED_CIRCUIT_CLIENT=PASS');
  console.log('ARIA_OPTIMA_DISTRIBUTED_CIRCUIT_AUTH_AND_REDACTION=PASS');
  console.log('ARIA_OPTIMA_DISTRIBUTED_CIRCUIT_POLL_THROTTLE=PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
