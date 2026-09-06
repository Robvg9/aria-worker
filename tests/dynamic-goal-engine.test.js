'use strict';

const assert = require('node:assert/strict');

(async () => {
  const engine = await import('../autonomy/dynamic-goal-engine.mjs');
  const { generateCandidates, selectDynamicGoal, scoreCandidate } = engine;
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

  console.log('dynamic goal engine tests: PASS');
})();
