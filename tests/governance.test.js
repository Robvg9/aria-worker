'use strict';

const assert = require('node:assert/strict');
const {
  requiresHumanGate,
  scopeMatches,
  validateAuthorizationRecord,
  evaluateAuthorization,
} = require('../governance/lookup');

const baseRequest = {
  execution_id: 'exec_123',
  request_id: 'req_123',
  task_id: 'task_123',
  risk_class: 'HIGH_RISK_WRITE',
  tool_id: 'tool_x',
  operation: 'write',
};

function approval(overrides = {}) {
  return {
    authorization_id: 'auth_123',
    execution_id: 'exec_123',
    request_id: 'req_123',
    task_id: 'task_123',
    risk_class: 'HIGH_RISK_WRITE',
    decision: 'approved',
    reviewed_by: 'Robert',
    reviewed_at: '2026-09-02T02:00:00Z',
    evidence_ref: 'human-review-123',
    policy_version: 'aria-governance-v1.0.0',
    tool_id: 'tool_x',
    operation: 'write',
    ...overrides,
  };
}

assert.equal(requiresHumanGate('HIGH_RISK_WRITE', null), true);
assert.equal(requiresHumanGate('DESTRUCTIVE', { enabled: true }), true);
assert.equal(requiresHumanGate('READ', { enabled: true, readRequiresHuman: false }), false);

assert.equal(scopeMatches(baseRequest, approval()), true);
assert.equal(scopeMatches(baseRequest, approval({ execution_id: 'exec_other' })), false);
assert.equal(scopeMatches(baseRequest, approval({ operation: 'delete' })), false);
assert.equal(scopeMatches(baseRequest, approval({ tool_id: 'tool_other' })), false);
assert.equal(scopeMatches(baseRequest, approval({ operation: undefined })), false);
assert.equal(scopeMatches(baseRequest, approval({ tool_id: undefined })), false);

assert.deepEqual(validateAuthorizationRecord(null), { valid: false, reason: 'missing_authorization' });
assert.equal(validateAuthorizationRecord(approval()).valid, true);
assert.deepEqual(validateAuthorizationRecord(approval({ evidence_ref: null })), { valid: false, reason: 'approved_missing_evidence' });

assert.deepEqual(
  evaluateAuthorization(baseRequest, approval()),
  { status: 'approved', approved_to_execute: true, authorization_id: 'auth_123' },
);

assert.deepEqual(
  evaluateAuthorization(baseRequest, null),
  { status: 'blocked', reason: 'missing_authorization' },
);

assert.deepEqual(
  evaluateAuthorization(baseRequest, approval({ execution_id: 'exec_other' })),
  { status: 'blocked', reason: 'authorization_scope_mismatch' },
);

for (const decision of ['rejected', 'expired', 'invalid']) {
  assert.equal(evaluateAuthorization(baseRequest, approval({ decision })).status, 'blocked');
}

assert.deepEqual(
  evaluateAuthorization(baseRequest, approval({ decision: 'pending_approval' })),
  { status: 'pending_approval', approved_to_execute: false, reason: 'human_gate_required', authorization_id: 'auth_123' },
);

assert.deepEqual(
  evaluateAuthorization({ ...baseRequest, risk_class: 'UNKNOWN' }, approval()),
  { status: 'blocked', reason: 'invalid_risk_class' },
);

const readRequest = { ...baseRequest, risk_class: 'READ' };
const readApproval = approval({ risk_class: 'READ' });
assert.equal(evaluateAuthorization(readRequest, readApproval, { enabled: true, readRequiresHuman: false }).approved_to_execute, true);

console.log('10.12 governance tests: 18 passed, 0 failed');
