'use strict';

const assert = require('node:assert/strict');
const { createGovernanceAuthorizer, toGovernanceAuthorization } = require('../activation/governance');

const binding = {
  authorization_id: 'auth_1',
  request_id: 'req_1',
  execution_id: 'exec_1',
  task_id: 'task_1',
  tool_id: 'github:repo_read',
  operation: 'repo_read',
  risk_class: 'READ',
  policy_version: 'aria-governance-v1.0.0',
  target: { owner: 'Robvg9', repo: 'aria-worker' }
};

function record(overrides = {}) {
  return {
    authorization_id: 'auth_1',
    request_id: 'req_1',
    execution_id: 'exec_1',
    task_id: 'task_1',
    tool_id: 'github:repo_read',
    operation: 'repo_read',
    risk_class: 'READ',
    target: { owner: 'Robvg9', repo: 'aria-worker' },
    status: 'approved',
    approved_by: 'Robert',
    approved_at: '2026-09-03T12:00:00Z',
    expires_at: null,
    verification_ref: null,
    policy_version: 'aria-governance-v1.0.0',
    created_at: '2026-09-03T11:00:00Z',
    updated_at: '2026-09-03T12:00:00Z',
    ...overrides
  };
}

assert.equal(toGovernanceAuthorization(record({ status: 'pending' })).decision, 'pending_approval');
assert.equal(toGovernanceAuthorization(record({ status: 'revoked' })).decision, 'rejected');

const approvalStore = {
  async get(id) {
    if (id === 'auth_pending') return record({ authorization_id: 'auth_pending', status: 'pending', approved_by: null, approved_at: null });
    return id === 'auth_1' ? record() : null;
  },
  async canExecute(id, candidate, now) {
    assert.equal(id, 'auth_1');
    assert.deepEqual(candidate, binding);
    assert.equal(now.toISOString(), '2026-09-03T12:00:00.000Z');
    return true;
  }
};

(async () => {
  const authorize = createGovernanceAuthorizer({ approvalStore, now: () => new Date('2026-09-03T12:00:00Z') });
  const approved = await authorize({ connector_id: 'github', operation: 'repo_read', risk_class: 'READ', input: binding });
  assert.deepEqual(approved, { status: 'approved', approved_to_execute: true, authorization_id: 'auth_1' });

  const missing = await authorize({ connector_id: 'github', operation: 'repo_read', risk_class: 'READ', input: { ...binding, authorization_id: undefined } });
  assert.deepEqual(missing, { status: 'blocked', reason: 'authorization_id_missing' });

  const pending = await authorize({ connector_id: 'github', operation: 'repo_read', risk_class: 'READ', input: { ...binding, authorization_id: 'auth_pending' } });
  assert.deepEqual(pending, { status: 'pending_approval', approved_to_execute: false, reason: 'human_gate_required', authorization_id: 'auth_pending' });

  const mismatched = await authorize({ connector_id: 'github', operation: 'repo_read', risk_class: 'READ', input: { ...binding, target: { owner: 'other', repo: 'aria-worker' } } });
  assert.deepEqual(mismatched, { status: 'blocked', reason: 'authorization_scope_mismatch' });

  const unknown = await authorize({ connector_id: 'github', operation: 'repo_read', risk_class: 'READ', input: { ...binding, authorization_id: 'auth_unknown' } });
  assert.deepEqual(unknown, { status: 'blocked', reason: 'missing_authorization' });

  console.log('ACTIVATION GOVERNANCE BRIDGE PASS');
})();
