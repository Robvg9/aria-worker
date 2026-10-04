'use strict';

const assert = require('node:assert/strict');
const {
  VERSION,
  ACTION_MODE,
  analyzeProactiveSnapshot,
  buildProactiveDigest
} = require('../proactive/engine-v1');

const NOW = '2026-10-04T02:00:00.000Z';

(() => {
  assert.equal(VERSION, 'aria-proactive-intelligence-v1.0.0');
  assert.equal(ACTION_MODE, 'recommendation_only');

  const quiet = analyzeProactiveSnapshot({}, { now: NOW });
  assert.equal(quiet.status, 'quiet');
  assert.equal(quiet.recommendation_count, 0);

  const blockedQueue = buildProactiveDigest({
    queue: { queued_jobs: 3, eligible_online_executors: 0 }
  }, { now: NOW });
  assert.equal(blockedQueue.recommendation_count, 1);
  assert.equal(blockedQueue.recommendations[0].kind, 'queue_blocked');
  assert.equal(blockedQueue.recommendations[0].priority, 'high');
  assert.equal(blockedQueue.recommendations[0].action_mode, 'recommendation_only');

  const device = buildProactiveDigest({
    devices: [{ id: 'windows-1', status: 'offline', active_work: 1 }]
  }, { now: NOW });
  assert.equal(device.recommendation_count, 1);
  assert.equal(device.recommendations[0].kind, 'device_attention');

  const badResource = buildProactiveDigest({
    resources: [
      { model_id: 'model-a', status: 'failed' },
      { model_id: 'model-a', status: 'unavailable' }
    ]
  }, { now: NOW });
  assert.equal(badResource.recommendation_count, 1);
  assert.equal(badResource.high_count, 1);
  assert.equal(badResource.recommendations[0].kind, 'resource_degraded');

  const staleEvidence = buildProactiveDigest({
    evidence: [{
      evidence_id: 'ev-1',
      observed_at: '2026-10-01T00:00:00.000Z',
      verification_status: 'verified',
      max_age_ms: 3600000,
      scope: 'model'
    }]
  }, { now: NOW });
  assert.equal(staleEvidence.recommendations[0].kind, 'evidence_stale');

  const runtimeDrift = buildProactiveDigest({
    runtime: { expected_version: 'aria-runtime-v2', observed_versions: ['aria-runtime-v1'] }
  }, { now: NOW });
  assert.equal(runtimeDrift.recommendations[0].kind, 'runtime_drift');

  const diagnostic = buildProactiveDigest({
    diagnostics: [{ diagnostic_id: 'diag-1', severity: 'critical', status: 'blocked' }]
  }, { now: NOW });
  assert.equal(diagnostic.recommendation_count, 1);
  assert.equal(diagnostic.recommendations[0].priority, 'urgent');

  const unknown = buildProactiveDigest({
    resources: [{ model_id: 'model-unknown', status: 'unknown', live_verified: false }],
    queue: { queued_jobs: 1, eligible_online_executors: null, online_executors: null }
  }, { now: NOW });
  assert.equal(unknown.status, 'quiet');
  assert.equal(unknown.recommendation_count, 0);

  const deterministicInput = {
    queue: { queued_jobs: 2, eligible_online_executors: 0 },
    runtime: { expected_version: 'v2', observed_versions: ['v1'] }
  };
  const first = buildProactiveDigest(deterministicInput, { now: NOW });
  const second = buildProactiveDigest(deterministicInput, { now: NOW });
  assert.deepEqual(first, second);
  assert.equal(first.recommendations[0].fingerprint, second.recommendations[0].fingerprint);

  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.recommendations), true);
  assert.equal(Object.isFrozen(first.recommendations[0]), true);

  const source = require('node:fs').readFileSync(require.resolve('../proactive/engine-v1'), 'utf8');
  assert.equal(/enqueue|execute/i.test(source), false, 'v1 must stay non-actuating');

  console.log('PROACTIVE INTELLIGENCE V1: PASS — deterministic read-only signals, prioritization, deduplication, uncertainty preservation and no-actuation boundary');
})();
