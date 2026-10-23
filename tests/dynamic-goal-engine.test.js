'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const engine = await import('../autonomy/dynamic-goal-engine.mjs');
  const { generateCandidates, selectDynamicGoal, scoreCandidate } = engine;
  const twin = await import('../supabase/functions/_shared/mission-twin-v1.mjs');
  const now = '2026-09-06T02:00:00.000Z';

  const candidates = generateCandidates({
    goals: [
      { goal_id: 'seed-a', goal: 'Low priority maintenance', priority: 20, status: 'queued', created_at: '2026-09-05T01:00:00.000Z' },
      { goal_id: 'seed-b', goal: 'High priority roadmap work', priority: 70, status: 'queued', created_at: '2026-09-06T01:50:00.000Z' }
    ],
    failures: [{ mission_id: 'm-fail-1', goal: 'Broken deployment path', status: 'failed', last_stderr: 'deployment rejected', updated_at: '2026-09-06T01:55:00.000Z' }],
    capabilityGaps: [{ capability_id: 'github.file_write', model_id: 'runtime', status: 'unknown', notes: 'runtime path not verified', updated_at: '2026-09-06T01:54:00.000Z' }],
    learnings: [{ lesson_id: 'l-1', goal_id: 'seed-b', category: 'operational_failure', summary: 'retry policy caused duplicate work', confidence: 0.9, reusable: true, created_at: '2026-09-06T01:56:00.000Z' }]
  }, { now });

  assert.ok(candidates.length >= 4, 'sources should produce multiple candidates');
  assert.equal(candidates[0].source_type, 'failure', 'fresh high-impact failure should rank first');
  assert.equal(candidates[0].goal_id, 'dyn-failure-m-fail-1');
  assert.ok(Number.isFinite(candidates[0].dynamic_score));

  const strategic = generateCandidates({
    goals: [
      { goal_id: 'strategic-a', goal: 'Current strategic roadmap objective', priority: 80, status: 'queued', created_at: now },
      { goal_id: 'historical-a', goal: 'Completed high priority historical objective', priority: 100, status: 'completed', created_at: now }
    ],
    failures: []
  }, { now });
  const strategicCandidate = strategic.find((candidate) => candidate.goal_id === 'strategic-a');
  const historicalCandidate = strategic.find((candidate) => candidate.goal_id === 'historical-a');
  assert.equal(strategicCandidate.source_type, 'priority', 'high-priority live goals project into priority tier');
  assert.equal(strategicCandidate.strategic, true);
  assert.equal(historicalCandidate.historical, true);
  assert.ok(strategicCandidate.dynamic_score > historicalCandidate.dynamic_score, 'historical debt must not outrank a live strategic goal');

  const deterministicAgain = generateCandidates({
    goals: [{ goal_id: 'seed-b', goal: 'High priority roadmap work', priority: 70, status: 'queued', created_at: '2026-09-06T01:50:00.000Z' }]
  }, { now });
  assert.deepEqual(deterministicAgain, generateCandidates({
    goals: [{ goal_id: 'seed-b', goal: 'High priority roadmap work', priority: 70, status: 'queued', created_at: '2026-09-06T01:50:00.000Z' }]
  }, { now }), 'same input must produce same ranking');

  const selected = selectDynamicGoal(candidates, { blockedIds: new Set(['seed-a']), activeIds: new Set(['seed-b']) });
  assert.equal(selected.goal_id, 'dyn-failure-m-fail-1');

  assert.ok(scoreCandidate({ priority: 100, urgency: 100, impact: 100, confidence: 1, source_type: 'failure', source_created_at: now }, { now }) > scoreCandidate({ priority: 10, urgency: 10, impact: 10, confidence: 0.5, source_type: 'seed' }, { now }));

  const deduped = generateCandidates({
    failures: [
      { mission_id: 'm-1', goal: 'same failure', last_stderr: 'same', updated_at: now },
      { mission_id: 'm-2', goal: 'same failure', last_stderr: 'same', updated_at: now }
    ]
  }, { now });
  assert.equal(deduped.length, 2, 'distinct source refs remain distinct');

  const modelSpecific = generateCandidates({
    capabilityGaps: [
      { capability_id: 'github.file_write', model_id: 'model-a', status: 'unknown', updated_at: now },
      { capability_id: 'github.file_write', model_id: 'model-b', status: 'unknown', updated_at: now }
    ]
  }, { now });
  assert.equal(modelSpecific.length, 2, 'same capability on distinct models must remain distinct');
  assert.notEqual(modelSpecific[0].goal_id, modelSpecific[1].goal_id, 'capability-goal IDs include model identity');

  const recursiveFailure = generateCandidates({ failures: [{
    mission_id: 'm-deep',
    goal: 'Diagnose and resolve the verified failure from mission m-parent: Diagnose and resolve the verified failure from mission m-grandparent: old issue',
    last_stderr: 'stale_mission_recovered_automatically',
    updated_at: now
  }] }, { now });
  assert.equal(recursiveFailure.length, 0, 'nested failure-of-failure chains must not generate more recursive goals');

  const gatewaySource = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'functions', 'aria-device-gateway', 'index.ts'),
    'utf8'
  );
  assert.match(gatewaySource, /missionTwinCycleId\(now,10\)/,
    'the existing autonomy cycle must use the ten-minute durable slot id');
  assert.match(gatewaySource, /lease_until/);
  assert.match(gatewaySource, /evidence->>lease_owner/,
    'lease takeover and completion must be conditional on the lease owner');
  assert.match(gatewaySource, /lease_recovered_at/,
    'expired Mission Twin leases must leave recovery evidence');
  assert.match(gatewaySource, /mission_twin:missionTwin/,
    'the existing autonomy cycle must preserve the Mission Twin outcome in its evidence');

  const { missionTwinSlot, missionTwinCycleId, missionTwinLeaseDecision, buildMissionTwinReport, MAX_CANDIDATES } = twin;
  assert.equal(missionTwinSlot('2026-10-23T00:09:59.000Z'), '2026-10-23T00:00:00.000Z');
  assert.equal(missionTwinSlot('2026-10-23T00:10:00.000Z'), '2026-10-23T00:10:00.000Z');
  assert.equal(missionTwinCycleId('2026-10-23T00:19:59.000Z'), missionTwinCycleId('2026-10-23T00:10:01.000Z'),
    'same ten-minute slot must have a stable durable id');
  assert.throws(() => missionTwinSlot('2026-10-23T00:00:00.000Z', 2), /interval_out_of_bounds/);
  assert.throws(() => missionTwinSlot('not-a-date'), /invalid_clock/);

  assert.deepEqual(missionTwinLeaseDecision({ status: undefined, now: '2026-10-23T00:00:00.000Z' }),
    { action: 'claim', reason: 'slot_unclaimed' });
  assert.equal(missionTwinLeaseDecision({
    status: 'started',
    evidence: { lease_owner: 'owner-a', lease_until: '2026-10-23T00:02:00.000Z' },
    now: '2026-10-23T00:01:59.999Z'
  }).action, 'busy', 'a live lease must block concurrent claims');
  const expiredLease = missionTwinLeaseDecision({
    status: 'started',
    evidence: { lease_owner: 'owner-a', lease_until: '2026-10-23T00:02:00.000Z' },
    now: '2026-10-23T00:02:00.000Z'
  });
  assert.equal(expiredLease.action, 'reclaim', 'an expired lease with an owner may be conditionally reclaimed');
  assert.equal(expiredLease.expected_owner, 'owner-a');
  assert.equal(missionTwinLeaseDecision({
    status: 'started', evidence: { lease_until: '2026-10-23T00:00:00.000Z' },
    now: '2026-10-23T00:02:00.000Z'
  }).action, 'skip', 'a stale claim without an owner must fail closed');
  assert.equal(missionTwinLeaseDecision({ status: 'completed' }).action, 'skip');


  const twinBase = {
    snapshot: {
      goals: [{ goal_id: 'goal-safe', goal: 'Review test coverage', status: 'queued', metadata: {} }],
      active: [{ mission_id: 'active-1' }],
      failures: [{ mission_id: 'failed-1' }],
      capabilityGaps: [{ capability_id: 'cap-unknown' }],
      learnings: []
    },
    candidates: [{ goal_id: 'goal-safe', goal: 'Review test coverage', source_type: 'priority', dynamic_score: 80 }],
    now: '2026-10-23T00:00:00.000Z'
  };
  const safeTwin = buildMissionTwinReport(twinBase);
  assert.equal(safeTwin.status, 'SIMULATED');
  assert.equal(safeTwin.recommendation, 'RECOMMEND_ONLY');
  assert.equal(safeTwin.execution_authorized, false);
  assert.equal(safeTwin.live_verified, false);
  assert.equal(safeTwin.shared_blockers.active_missions, 1);
  assert.equal(safeTwin.shared_blockers.recent_failures, 1);
  assert.equal(safeTwin.resource_budget.execution_budget, 0);
  assert.ok(Object.isFrozen(safeTwin));
  assert.ok(Object.isFrozen(safeTwin.predicted_blockers));

  const sensitiveTwin = buildMissionTwinReport({
    ...twinBase,
    candidates: [{ goal_id: 'goal-deploy', goal: 'Deploy to production and update secrets', source_type: 'priority', dynamic_score: 99 }]
  });
  assert.equal(sensitiveTwin.recommendation, 'APPROVAL_REQUIRED');
  assert.equal(sensitiveTwin.sensitive_scope_detected, true);
  assert.equal(sensitiveTwin.execution_authorized, false);

  const missingPrereqTwin = buildMissionTwinReport({
    snapshot: { goals: [{ goal_id: 'goal-dep', goal: 'Fix issue', status: 'queued', metadata: { prerequisites: ['prereq-missing'] } }] },
    candidates: [{ goal_id: 'goal-dep', goal: 'Fix issue', dynamic_score: 50 }],
    now: '2026-10-23T00:00:00.000Z'
  });
  assert.equal(missingPrereqTwin.recommendation, 'DEFER');
  assert.deepEqual(missingPrereqTwin.predicted_blockers.map(x => x.ref), ['prereq-missing']);

  const emptyTwin = buildMissionTwinReport({ snapshot: {}, candidates: [], now: '2026-10-23T00:00:00.000Z' });
  assert.equal(emptyTwin.recommendation, 'NO_ACTION');
  assert.equal(emptyTwin.candidate, null);
  assert.equal(emptyTwin.status, 'SIMULATED');

  const manyCandidates = Array.from({ length: 40 }, (_, i) => ({
    goal_id: 'bounded-' + i, goal: 'Review candidate ' + i, dynamic_score: 100 - i
  }));
  const boundedTwin = buildMissionTwinReport({
    snapshot: {}, candidates: manyCandidates, now: '2026-10-23T00:00:00.000Z'
  });
  assert.equal(MAX_CANDIDATES, 25);
  assert.equal(boundedTwin.resource_budget.max_candidates_considered, 25);
  assert.equal(boundedTwin.alternatives.length, 3);
  assert.equal(boundedTwin.candidate.goal_id, 'bounded-0');


  console.log('dynamic goal engine tests: PASS');
})();
