'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {
  STATES,
  failureSignature,
  detectPattern,
  buildCountermeasure,
  evaluateRecurrence
} = require('../failure-intelligence/failure-pattern-engine-v1.js');

function episode(id, overrides = {}) {
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
    created_at: `2026-09-15T00:0${id.slice(-1)}:00Z`,
    ...overrides
  };
}

test('same operational failure normalizes to one stable signature', () => {
  assert.equal(failureSignature(episode('1')), failureSignature(episode('2')));
});

test('three occurrences become a pattern candidate', () => {
  const patterns = detectPattern([episode('1'), episode('2'), episode('3')]);
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].state, STATES.CANDIDATE);
  assert.equal(patterns[0].occurrence_count, 3);
});

test('four occurrences confirm a pattern and make prevention actionable', () => {
  const pattern = detectPattern([episode('1'), episode('2'), episode('3'), episode('4')])[0];
  assert.equal(pattern.state, STATES.CONFIRMED);
  const countermeasure = buildCountermeasure(pattern, {
    preventionProcedure: ['verify watchdog', 'verify OS supervisor', 'fault-inject restart'],
    evidenceRefs: ['mission:pattern-test', 'verification:pattern-test']
  });
  assert.equal(countermeasure.status, 'ready');
  assert.equal(countermeasure.action, 'prevention');
});

test('repeated recurrence after a verified repair forces root-cause reopen', () => {
  const history = [
    episode('1'),
    episode('2', { repair_verified: true }),
    episode('3'),
    episode('4'),
    episode('5')
  ];
  const pattern = detectPattern(history)[0];
  assert.equal(pattern.recurrence_after_repair, true);
  assert.equal(pattern.state, STATES.ROOT_CAUSE_REQUIRED);
  const next = evaluateRecurrence(pattern, episode('6'));
  assert.equal(next.same_pattern, true);
  assert.equal(next.state, STATES.ROOT_CAUSE_REQUIRED);
  assert.equal(next.next_action, 'reopen_root_cause');
});

test('success episodes do not manufacture failure patterns', () => {
  const patterns = detectPattern([episode('1', { result: { status: 'succeeded' } })]);
  assert.equal(patterns.length, 0);
});

console.log('FAILURE PATTERN INTELLIGENCE V1: PASS');
