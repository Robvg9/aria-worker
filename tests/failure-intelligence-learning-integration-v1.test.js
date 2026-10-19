'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createLearningEngine } = require('../learning/engine.js');
const { failureSignature } = require('../failure-intelligence/failure-pattern-engine-v1.js');

function failed(id, extra = {}) {
  return {
    mission_id: id,
    executor_type: 'windows-local',
    operation: 'claim',
    stage: 'execution',
    component: 'windows-agent',
    error_code: 'STALE_HEARTBEAT',
    failure_mode: 'agent_online_but_not_claiming_jobs',
    symptom: 'queued jobs with stale heartbeat',
    result: { status: 'failed' },
    evidence_refs: [`mission:${id}`],
    ...extra
  };
}

test('learning engine detects recurrence from episode history without pre-classifying it', async () => {
  const persisted = [];
  const engine = createLearningEngine({
    persistLesson: async () => {},
    persistPattern: async pattern => persisted.push(pattern)
  });
  const history = [failed('1'), failed('2'), failed('3')];
  const result = await engine.learn({ episode: failed('4'), verifier: { passed: false }, history });
  assert.equal(result.pattern.signature, failureSignature(failed('4')));
  assert.equal(result.pattern.occurrence_count, 4);
  assert.equal(result.pattern.state, 'pattern_confirmed');
  assert.equal(persisted.length, 1);
  assert.equal(result.countermeasure.status, 'needs_prevention_procedure');
});

test('verified repair followed by recurrence escalates toward root-cause prevention', async () => {
  const engine = createLearningEngine();
  const history = [
    failed('1'),
    failed('2', { repair_verified: true }),
    failed('3'),
    failed('4'),
    failed('5')
  ];
  const result = await engine.learn({ episode: failed('6'), verifier: { passed: false }, history });
  assert.equal(result.pattern.recurrence_after_repair, true);
  assert.equal(result.pattern.state, 'root_cause_required');
  assert.equal(result.countermeasure.action, 'root_cause_then_prevention');
});

console.log('FAILURE INTELLIGENCE LEARNING INTEGRATION V1: PASS');
