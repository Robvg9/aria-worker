'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createFailureIntelligenceRuntime } = require('../failure-intelligence/runtime.js');

const base = {
  executor_type: 'windows-local',
  operation: 'claim',
  stage: 'execution',
  component: 'windows-agent',
  error_code: 'STALE_HEARTBEAT',
  failure_mode: 'agent_online_but_not_claiming_jobs',
  symptom: 'queued jobs with stale heartbeat',
  result: { status: 'failed' }
};

function episode(id, extra = {}) { return { ...base, mission_id: id, ...extra }; }

test('runtime loads history, detects pattern and exposes countermeasure state', async () => {
  const persisted = [];
  let rootCauseTriggered = 0;
  const runtime = createFailureIntelligenceRuntime({
    historyProvider: async () => [episode('1'), episode('2'), episode('3')],
    persistPattern: async result => persisted.push(result),
    onRootCauseRequired: async () => { rootCauseTriggered += 1; }
  });
  const result = await runtime.observeFailure(episode('4'));
  assert.equal(result.status, 'pattern_confirmed');
  assert.equal(result.pattern.occurrence_count, 4);
  assert.equal(result.countermeasure.status, 'needs_prevention_procedure');
  assert.equal(persisted.length, 1);
  assert.equal(rootCauseTriggered, 0);
});

test('post-repair recurrence escalates automatically to root-cause work', async () => {
  let rootCauseTriggered = 0;
  const runtime = createFailureIntelligenceRuntime({
    historyProvider: async () => [
      episode('1'),
      episode('2', { repair_verified: true }),
      episode('3'),
      episode('4'),
      episode('5')
    ],
    onRootCauseRequired: async () => { rootCauseTriggered += 1; }
  });
  const result = await runtime.observeFailure(episode('6'));
  assert.equal(result.status, 'root_cause_required');
  assert.equal(result.recurrence.next_action, 'reopen_root_cause');
  assert.equal(rootCauseTriggered, 1);
});

console.log('FAILURE INTELLIGENCE RUNTIME V1: PASS');
