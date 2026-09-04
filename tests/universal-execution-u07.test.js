'use strict';

const assert = require('node:assert/strict');
const { createExecutionControl } = require('../autonomy/universal-execution/control');

const events = [];
const control = createExecutionControl({
  enforceGovernance: true,
  onEvent: event => events.push(event)
});

const approvedRequest = {
  execution_id: 'exec_u07',
  request_id: 'req_u07',
  task_id: 'task_u07',
  risk_class: 'HIGH_RISK_WRITE',
  tool_id: 'tool_u07',
  operation: 'write'
};

const approval = {
  authorization_id: 'auth_u07',
  execution_id: 'exec_u07',
  request_id: 'req_u07',
  task_id: 'task_u07',
  risk_class: 'HIGH_RISK_WRITE',
  decision: 'approved',
  reviewed_by: 'Robert',
  reviewed_at: '2026-09-04T00:00:00Z',
  evidence_ref: 'human-review-u07',
  policy_version: 'aria-governance-v1.0.0',
  tool_id: 'tool_u07',
  operation: 'write'
};

assert.deepEqual(control.preflight(approvedRequest, null), {
  status: 'blocked',
  reason: 'human_gate_required'
});

const allowed = control.preflight(approvedRequest, approval);
assert.equal(allowed.status, 'approved');
assert.equal(allowed.approved_to_execute, true);

const observed = control.observe({
  stage: 'execution',
  status: 'started',
  execution_id: 'exec_u07',
  request_id: 'req_u07',
  task_id: 'task_u07',
  metadata: { executor_type: 'device' }
});
assert.equal(events.length, 1);
assert.equal(events[0].execution_id, 'exec_u07');
assert.equal(observed.execution_id, 'exec_u07');
assert.equal(typeof observed.event_id, 'string');

const secretEvent = control.observe({
  stage: 'result',
  status: 'failed',
  execution_id: 'exec_u07',
  metadata: { message: 'Bearer should-never-escape' }
});
assert.equal(events.length, 2);
assert.notEqual(events[1].metadata.message, 'Bearer should-never-escape');

const noThrow = createExecutionControl({
  enforceGovernance: true,
  onEvent: () => { throw new Error('telemetry sink failure'); }
});
assert.doesNotThrow(() => noThrow.observe({ stage: 'result', status: 'succeeded' }));

console.log('UO-7 governance + observability control tests passed');
