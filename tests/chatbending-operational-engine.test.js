'use strict';

const assert = require('node:assert/strict');
const {
  buildMissionContext,
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
