'use strict';

const assert = require('node:assert/strict');
const {
  buildMissionContext,
  inferIntent,
  rankRecall,
  detectContradictions,
  evaluateFreshness,
  buildEvidenceEdge,
  buildHealthSnapshot,
  planCleanup,
  buildDashboardSnapshot,
  runContinuityCheck,
  evaluateBehavior,
  verifyClosure,
  buildLearningCandidate,
  promoteLearning
} = require('../chatbending/operational-engine');

const context = buildMissionContext({
  goal: 'validate ChatBending operational behavior',
  project: 'ChatBending',
  active_rules: ['RULE-001', 'RULE-004'],
  evidence: ['e1'],
  success_criteria: ['behavior changes']
});

assert.equal(context.version, 'chatbending-mission-context-v1');
assert.deepEqual(context.active_rules, ['RULE-001', 'RULE-004']);
assert.equal(inferIntent('debug this error'), 'DEBUG');
assert.equal(inferIntent('build this capability', 'BUILD'), 'BUILD');
const ranked = rankRecall([
  { memory_id: 'low', title: 'legacy', content: 'other', hybrid_score: 0.1 },
  { memory_id: 'high', title: 'debug authentication', content: 'debug error', hybrid_score: 0.9, confidence: 0.9 }
], { query: 'debug error', limit: 1 });
assert.equal(ranked.length, 1);
assert.equal(ranked[0].memory_id, 'high');
assert.equal(detectContradictions([
  { id: 'a', subject: 'version', value: '1.0' },
  { id: 'b', subject: 'version', value: '2.0' }
]).length, 1);
assert.equal(evaluateFreshness({ verified_at: '2026-09-29T00:00:00Z', freshness_window_days: 2, now: '2026-09-30T00:00:00Z' }).status, 'CURRENT');
assert.equal(evaluateFreshness({ verified_at: '2026-09-20T00:00:00Z', freshness_window_days: 2, now: '2026-09-30T00:00:00Z' }).status, 'REVALIDATE');
assert.equal(buildEvidenceEdge({ from: 'e1', to: 'd1', relation: 'supports' }).relation, 'supports');
const health = buildHealthSnapshot();
assert.equal(health.status, 'HEALTHY');
assert.equal(buildHealthSnapshot({ evidence: false }).status, 'DEGRADED');
assert.equal(buildHealthSnapshot({ evidence: false, behavior: false }).status, 'BLOCKED');
assert.deepEqual(planCleanup([
  { id: 'old', superseded: true },
  { id: 'historical', superseded: true, historical: true },
  { id: 'broken', broken_reference: true }
]).map(x => x.action), ['ARCHIVE', 'REPAIR']);
const dashboard = buildDashboardSnapshot({ health, blockers: ['none'], gates: [{ id: 'G1', result: 'PASS' }] });
assert.equal(dashboard.status, 'HEALTHY');
assert.equal(runContinuityCheck({
  context,
  expected_project: 'ChatBending',
  required_rules: ['RULE-001'],
  require_source_of_truth: false
}).verified, true);

assert.equal(evaluateBehavior({context}).mode, 'CONTINUE');
assert.equal(evaluateBehavior({context, contradiction:true}).mode, 'STOP');
assert.equal(evaluateBehavior({context, stale:true}).mode, 'REVALIDATE');

const changedPath = evaluateBehavior({
  context,
  failure: { consecutive_failures: 3 }
});
assert.equal(changedPath.mode, 'STOP');
assert.equal(changedPath.escalation.action, 'change_path');

const blocked = evaluateBehavior({
  context,
  failure: { consecutive_failures: 3, external_dependency: true, optional: true }
});
assert.equal(blocked.mode, 'BLOCKED');
assert.equal(blocked.escalation.user_decision_required, true);

assert.equal(evaluateBehavior({
  context,
  closure_requested:true,
  closure:{criteria_passed:true,evidence_count:1,regression_passed:true,artifacts_present:true}
}).mode, 'VERIFIED');

assert.equal(evaluateBehavior({
  context,
  closure_requested:true,
  closure:{criteria_passed:true,evidence_count:0,regression_passed:true,artifacts_present:true}
}).mode, 'BLOCKED');

const candidate = buildLearningCandidate({
  mission_id:'m1',
  observation:'Repeated failure indicates a missing health preflight.',
  evidence:['e1','e2'],
  proposed_rule:'Add a health gate before RWHT.'
});
assert.equal(candidate.status,'CANDIDATE');
assert.equal(candidate.auto_promoted,false);
assert.equal(promoteLearning(candidate).promoted,false);
assert.equal(promoteLearning(candidate,{explicit_approval:true,validation_passed:false}).promoted,false);
assert.equal(promoteLearning(candidate,{explicit_approval:true,validation_passed:true}).status,'ACTIVE');

console.log('chatbending-operational-engine.test.js: PASS');
