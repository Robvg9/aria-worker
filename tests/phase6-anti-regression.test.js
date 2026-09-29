'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const root = path.join(__dirname, '..');
  const diagnostics = await import(pathToFileURL(path.join(root, 'supabase', 'functions', '_shared', 'operational-diagnostics.mjs')).href);
  const runner = fs.readFileSync(path.join(root, 'supabase', 'functions', 'aria-mission-runner-v22', 'index.ts'), 'utf8');
  const phase4 = fs.readFileSync(path.join(root, 'tests', 'phase4-jobs-recovery-contract.test.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'pwa', 'src', 'App.tsx'), 'utf8');
  const pcRwht = fs.readFileSync(path.join(root, 'tests', 'pc-rwht-browser.test.js'), 'utf8');

  assert.equal(diagnostics.registry.version, 'aria-operational-diagnostics-v1.0.0');

  const scenarios = [
    ['6.1', 'stale device', 'failed', 'execution_failed', 'stale_device', 'device', /dispositivo|heartbeat/i],
    ['6.2', 'deploy drift', 'failed', 'pwa_build_mismatch', 'live_build_mismatch', 'pwa', /build LIVE|API boundary|cache/i],
    ['6.3', 'contract mismatch', 'blocked', 'policy_block', 'policy_contract_mismatch', 'policy', /autorizaci[oó]n|Human Gate|required/i],
    ['6.4', 'duplicate job', 'blocked', 'execution_failed', 'duplicate_job', 'lease', /owner|lease|encolar/i],
    ['6.5', 'expired lease', 'blocked', 'execution_failed', 'lease_expired', 'lease', /owner|lease|reclaim/i],
    ['6.6', 'timeout', 'failed', 'execution_timeout', 'execution_timeout', 'timeout', /executor|timeout|watchdog/i],
    ['6.7', 'verifier failure', 'failed', 'execution_failed', 'verification_evidence_missing', 'verifier', /evidencia|verificaci[oó]n/i],
    ['6.8', 'UI stale state', 'failed', 'pwa_ui_stale', 'ui_stale_state', 'pwa', /build LIVE|API boundary|cache/i],
    ['6.9', 'provider unavailable', 'failed', 'provider_unavailable', 'provider_unavailable', 'provider', /ruta alternativa|availability|salud/i],
    ['6.10', 'executor unavailable', 'blocked', 'execution_failed', 'executor_unavailable', 'device', /dispositivo|heartbeat|job/i],
    ['6.11', 'saturation / backpressure', 'blocked', 'execution_backpressure', 'capacity_exhausted', 'backpressure', /concurrencia|policy|capacidad/i],
  ];

  for (const scenario of scenarios) {
    const [id, name, status, eventType, errorCode, expectedCategory, actionPattern] = scenario;
    const missionId = 'phase6_' + id.replace('.', '_');
    const events = [1, 2, 3].map((attempt) => ({
      event_id: missionId + '_e' + attempt,
      mission_id: missionId,
      created_at: '2026-09-28T23:5' + attempt + ':00Z',
      event_type: attempt === 3 ? eventType : 'step_retrying',
      error_code: attempt === 3 ? errorCode : undefined,
      payload: {
        attempt,
        executor_type: ['6.1', '6.10'].includes(id) ? 'device' : undefined,
        operation: 'mission.execute',
        error_code: attempt === 3 ? errorCode : undefined,
        message: attempt === 3 ? 'synthetic ' + name + ' fault' : 'retrying',
        trace_id: missionId + '_trace',
        request_id: missionId + '_request',
        execution_id: missionId + '_execution',
        strategy_fingerprint: 'phase6-same-strategy',
      },
    }));

    const diag = diagnostics.deriveOperationalDiagnostic({
      mission: {
        mission_id: missionId,
        status,
        goal: 'certificar ' + name,
        metadata: {
          trace_id: missionId + '_trace',
          request_id: missionId + '_request',
          execution_id: missionId + '_execution',
          runtime_version: 'aria-mission-runner-v22-universal',
          pwa_build: 'phase6-build',
          source_sha: 'phase6-source',
        },
        checkpoint: {},
      },
      events,
      jobs: [{
        job_id: missionId + '_job',
        status: status === 'blocked' ? 'blocked' : 'timeout',
        device_id: ['6.1', '6.10'].includes(id) ? 'phase6-device' : null,
        operation: 'mission.execute',
        requested_at: '2026-09-28T23:59:00Z',
        metadata: { attempt: 3, error_code: errorCode },
      }],
      steps: [{
        step_index: 1,
        operation: 'mission.execute',
        executor_type: ['6.1', '6.10'].includes(id) ? 'device' : 'model',
        attempt_count: 3,
        status,
      }],
      health: { status: 'degraded', dependency: {} },
    });

    assert.equal(diag.classification.category, expectedCategory, id + ' category');
    assert.equal(diag.correlation.trace_id, missionId + '_trace');
    assert.equal(diag.correlation.request_id, missionId + '_request');
    assert.equal(diag.correlation.execution_id, missionId + '_execution');
    assert.equal(diag.versions.runtime_version, 'aria-mission-runner-v22-universal');
    assert.equal(diag.versions.source_sha, 'phase6-source');
    assert.equal(diag.versions.pwa_build, 'phase6-build');
    assert.ok(diag.attempts.length >= 3, id + ' attempts');
    assert.ok(diag.evidence_chain.length >= 4, id + ' evidence');
    assert.ok(diag.diagnosis.root_cause, id + ' root cause');
    assert.ok(diag.diagnosis.summary, id + ' summary');
    assert.ok(diag.diagnosis.explanation, id + ' explanation');
    assert.ok(diag.diagnosis.expected, id + ' expected');
    assert.ok(diag.diagnosis.observed, id + ' observed');
    assert.ok(diag.diagnosis.next_action, id + ' next action');
    assert.match(diag.diagnosis.next_action, actionPattern, id + ' action');
    assert.doesNotMatch(JSON.stringify(diag), /SUPERSECRET/);
    console.log('PHASE6 ' + id + ' ' + name + ': PASS');
  }

  const success = diagnostics.deriveOperationalDiagnostic({
    mission: {
      mission_id: 'phase6_success',
      status: 'succeeded',
      goal: 'regression baseline',
      metadata: { trace_id: 'success-trace', runtime_version: 'runtime-v1' },
      checkpoint: {},
    },
    events: [],
    jobs: [],
    steps: [],
  });
  assert.equal(success.classification.root_cause, 'none');
  assert.equal(success.diagnosis.summary, 'SIN FALLOS DETECTADOS');

  const secretProbe = diagnostics.deriveOperationalDiagnostic({
    mission: {
      mission_id: 'phase6_secret',
      status: 'failed',
      goal: 'security regression',
      metadata: {},
      checkpoint: {},
    },
    events: [{
      event_type: 'execution_failed',
      payload: { error_code: 'api_key=SUPERSECRET', message: 'Bearer SUPERSECRET' },
    }],
  });
  assert.doesNotMatch(JSON.stringify(secretProbe), /SUPERSECRET/);

  for (const fragment of [
    'sameStrategyCount',
    'hardBlockThreshold = 5',
    'forceAlternativeThreshold = 3',
    'same_strategy_repeated_three_times',
    'same_strategy_repeated_five_times',
    'strategy_change_required',
    'next_action: "replan: discard failed strategy and build an alternative"',
  ]) {
    assert.ok(runner.includes(fragment), 'recovery invariant missing: ' + fragment);
  }

  for (const fragment of [
    'execution_job_backpressure_guard',
    'execution_jobs_idempotency_key_uidx',
    'execution_jobs_watchdog',
    'terminal_execution_job_requires_completed_at',
    'terminal_execution_job_must_release_lease',
  ]) {
    assert.ok(phase4.includes(fragment), 'Phase 4 invariant missing: ' + fragment);
  }

  for (const fragment of [
    'latestEventFresh',
    'No hay actividad nueva confirmada; ARIA no inventará una acción',
    'sessionSnapshot',
  ]) {
    assert.ok(app.includes(fragment), 'UI stale-state defense missing: ' + fragment);
  }

  assert.ok(pcRwht.includes('aria-test-catalog-version'));
  assert.ok(pcRwht.includes('aria-test-catalog-total'));
  assert.ok(pcRwht.includes('authentication_human_gate'));

  console.log('PHASE6 ANTI-REGRESSION CERTIFICATION: 11/11 PASS');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
// Phase 6 final certification replay marker.
