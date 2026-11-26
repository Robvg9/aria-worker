'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFromHere = createRequire(__filename);
const {
  createRemoteServiceCircuitBreaker,
  classify402,
  isRetryableHttpStatus,
  parseRetryAfterMs
} = require('../agents/shared/remote-service-circuit-breaker.cjs');
const { runHeartbeatLoop } = require('../agents/windows/heartbeat-scheduler.cjs');

async function main() {
  assert.equal(classify402({ error: 'quota_exceeded' }), 'quota_exhausted');
  assert.equal(classify402({ code: 'insufficient_credits' }), 'billing_restriction');
  assert.equal(classify402({ message: 'project service disabled' }), 'service_restriction');
  assert.equal(classify402({ error: 'unexpected response' }), 'unknown_402');

  assert.equal(isRetryableHttpStatus(408), true);
  assert.equal(isRetryableHttpStatus(429), true);
  assert.equal(isRetryableHttpStatus(500), true);
  assert.equal(isRetryableHttpStatus(599), true);
  assert.equal(isRetryableHttpStatus(402), false);
  assert.equal(isRetryableHttpStatus(423), false);
  assert.equal(isRetryableHttpStatus(404), false);

  assert.equal(parseRetryAfterMs('2', 1_000), 2_000);
  assert.equal(parseRetryAfterMs('invalid', 1_000), null);
  assert.equal(parseRetryAfterMs(new Date(5_000).toUTCString(), 1_000), 4_000);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aria-circuit-test-'));
  try {
    const globalPath = path.join(root, 'global.json');
    const events = [];
    let currentTime = 1_000;
    const first = createRemoteServiceCircuitBreaker({
      statePath: globalPath,
      now: () => currentTime,
      idFactory: () => 'incident-global-1',
      onIncident: event => events.push(event)
    });
    assert.equal((await first.beforeRequest('/v1/devices/heartbeat')).allowed, true);
    const opened = await first.recordResponse('/v1/devices/heartbeat', 402, { error: 'quota_exceeded' });
    assert.equal(opened.recorded, true);
    assert.equal(await first.isOpen(), true);
    assert.equal((await first.beforeRequest('/v1/jobs/claim')).status, 402);
    assert.equal((await first.beforeRequest('/v1/voice/commands/claim')).allowed, false);
    assert.equal(events.length, 1);
    assert.equal(events[0].classification, 'quota_exhausted');

    const second = createRemoteServiceCircuitBreaker({
      statePath: globalPath,
      onIncident: event => events.push(event)
    });
    assert.equal((await second.beforeRequest('/v1/devices/enroll')).allowed, false);
    assert.equal(await second.isOpen(), true);
    await second.recordResponse('/v1/jobs/claim', 402, { message: 'billing payment required' });
    assert.equal(events.length, 1, 'the same persisted incident must not notify twice');

    let probeCalls = 0;
    await assert.rejects(
      () => second.resetAfterAuthorizedRecovery({
        authorized: true,
        probe: async () => { probeCalls++; return { serviceRestored: false }; }
      }),
      /circuit_reset_probe_failed/
    );
    assert.equal(probeCalls, 1);
    await assert.rejects(
      () => second.resetAfterAuthorizedRecovery({ authorized: false, probe: async () => ({ serviceRestored: true }) }),
      /explicit_authorization/
    );
    assert.equal((await second.beforeRequest('/v1/devices/heartbeat')).allowed, false);
    const reset = await second.resetAfterAuthorizedRecovery({
      authorized: true,
      probe: async () => {
        probeCalls++;
        return { serviceRestored: true };
      }
    });
    assert.equal(reset.reset, true);
    assert.equal(reset.probe_attempts, 1);
    assert.equal(probeCalls, 2);
    assert.equal((await second.beforeRequest('/v1/devices/heartbeat')).allowed, true);

    const pausePath = path.join(root, 'pause.json');
    const pauseEvents = [];
    const paused = createRemoteServiceCircuitBreaker({
      statePath: pausePath,
      idFactory: () => 'incident-pause-1',
      onIncident: event => pauseEvents.push(event)
    });
    await paused.recordResponse('/v1/jobs/claim', 423, {
      ok: false,
      status: 'paused',
      error: 'mission_execution_paused',
      execution_enabled: false
    });
    assert.equal((await paused.beforeRequest('/v1/jobs/claim')).status, 423);
    assert.equal((await paused.beforeRequest('/v1/devices/heartbeat')).allowed, true);
    assert.equal((await paused.beforeRequest('/v1/voice/commands/claim')).allowed, true);
    assert.equal(pauseEvents.length, 1);
    await paused.recordResponse('/v1/jobs/claim', 423, { error: 'mission_execution_paused' });
    assert.equal(pauseEvents.length, 1);
    await assert.rejects(
      () => paused.resetAfterAuthorizedRecovery({
        authorized: true,
        probe: async () => ({ serviceRestored: true, canonicalFreezeCleared: false })
      }),
      /circuit_reset_freeze_still_active/
    );
    assert.equal((await paused.beforeRequest('/v1/jobs/claim')).allowed, false);
    const pauseReset = await paused.resetAfterAuthorizedRecovery({
      authorized: true,
      probe: async () => ({ serviceRestored: true, canonicalFreezeCleared: true })
    });
    assert.equal(pauseReset.cleared_paused_routes, 1);
    assert.equal((await paused.beforeRequest('/v1/jobs/claim')).allowed, true);

    const retryPath = path.join(root, 'retry.json');
    const retryBreaker = createRemoteServiceCircuitBreaker({
      statePath: retryPath,
      now: () => currentTime
    });
    await retryBreaker.recordResponse('/v1/jobs/claim', 429, { error: 'rate_limited' }, { 'retry-after': '3' });
    const waiting = await retryBreaker.beforeRequest('/v1/jobs/claim');
    assert.equal(waiting.kind, 'retry_after');
    assert.equal(waiting.wait_ms, 3_000);
    currentTime += 3_001;
    assert.equal((await retryBreaker.beforeRequest('/v1/jobs/claim')).allowed, true);

    const globalPath = path.join(root, 'global-sync.json');
    const globalBreaker = createRemoteServiceCircuitBreaker({ statePath: globalPath });
    const globalApplied = await globalBreaker.applyGlobalCircuit({
      open: true,
      circuit: {
        incident_id: 'gateway402_global_123',
        status: 402,
        classification: 'unknown_402',
        route: '/v1/devices/heartbeat',
        opened_at: new Date().toISOString()
      }
    });
    assert.equal(globalApplied.applied, true);
    assert.equal((await globalBreaker.beforeRequest('/v1/jobs/claim')).kind, 'service_circuit_open');
    const globalReset = await globalBreaker.applyGlobalCircuit({
      open: false,
      circuit: null,
      last_reset: {
        incident_id: 'gateway402_global_123',
        service_restored: true,
        closed_at: new Date().toISOString()
      }
    });
    assert.equal(globalReset.applied, true);
    assert.equal((await globalBreaker.beforeRequest('/v1/jobs/claim')).allowed, true);

    const localOnlyPath = path.join(root, 'local-only.json');
    const localOnly = createRemoteServiceCircuitBreaker({ statePath: localOnlyPath });
    await localOnly.recordResponse('/v1/devices/heartbeat', 402, { error: 'quota_exceeded' });
    const unrelatedReset = await localOnly.applyGlobalCircuit({
      open: false,
      circuit: null,
      last_reset: {
        incident_id: 'some-other-global-incident',
        service_restored: true
      }
    });
    assert.equal(unrelatedReset.applied, false);
    assert.equal((await localOnly.beforeRequest('/v1/devices/heartbeat')).kind, 'service_circuit_open');

    let shouldContinue = true;
    let sends = 0;
    const sleeps = [];
    await runHeartbeatLoop({
      sendHeartbeat: async () => { sends++; return 'blocked'; },
      shouldStop: () => !shouldContinue,
      sleep: async delay => { sleeps.push(delay); shouldContinue = false; },
      intervalMs: 30_000,
      retryBaseMs: 2_000,
      retryMaxMs: 15_000,
      onRetry: () => { throw new Error('blocked heartbeat must not retry'); }
    });
    assert.equal(sends, 1);
    assert.deepEqual(sleeps, [30_000]);

    const corruptPath = path.join(root, 'corrupt.json');
    await fs.writeFile(corruptPath, '{bad json');
    const corrupt = createRemoteServiceCircuitBreaker({ statePath: corruptPath });
    assert.equal((await corrupt.beforeRequest('/v1/devices/heartbeat')).allowed, false);
    assert.equal((await corrupt.beforeRequest('/v1/jobs/claim')).kind, 'state_unavailable');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }

  const windowsSource = await fs.readFile(path.join(__dirname, '../agents/windows/aria-agent.js'), 'utf8');
  const termuxSource = await fs.readFile(path.join(__dirname, '../agents/termux/aria-agent.js'), 'utf8');
  const transportSource = await fs.readFile(path.join(__dirname, '../agents/windows/gateway-http-client.cjs'), 'utf8');
  assert.match(windowsSource, /circuitCoordinator\.sync\(remoteCircuit\)/);
  assert.match(windowsSource, /circuitCoordinator\.reportIncident\(event,remoteCircuit\)/);
  assert.match(windowsSource, /remoteCircuit\.beforeRequest/);
  assert.match(windowsSource, /isRetryableHttpStatus/);
  assert.match(termuxSource, /circuitCoordinator\.sync\(remoteCircuit\)/);
  assert.match(termuxSource, /circuitCoordinator\.reportIncident\(event, remoteCircuit\)/);
  assert.match(termuxSource, /remoteCircuit\.beforeRequest/);
  assert.match(termuxSource, /remoteCircuit\.isOpen/);
  assert.match(transportSource, /headers:\s*incoming\.headers/);

  console.log('ARIA_OPTIMA_P0_CIRCUIT_BREAKER=PASS');
  console.log('ARIA_OPTIMA_P0_DISTRIBUTED_CIRCUIT_RESET_GATE=PASS');
  console.log('ARIA_OPTIMA_P0_HTTP_402_PERSISTENT_GLOBAL_BLOCK=PASS');
  console.log('ARIA_OPTIMA_P0_HTTP_423_ROUTE_PAUSE=PASS');
  console.log('ARIA_OPTIMA_P0_LOCAL_HEARTBEAT_BLOCKED_MODE=PASS');
  console.log('ARIA_OPTIMA_P0_RETRY_AFTER_AND_RECOVERY_GATE=PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
