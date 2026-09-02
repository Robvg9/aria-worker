'use strict';

const assert = require('node:assert/strict');
const { createApprovalStore, validateRecord, bindingMatches, isExecutable } = require('../approvals/store');

function baseRecord(overrides = {}) {
  return {
    authorization_id: 'auth_1',
    request_id: 'req_1',
    execution_id: 'exec_1',
    tool_id: 'github',
    operation: 'read_file',
    risk_class: 'READ',
    target: { repository: 'Robvg9/aria-worker' },
    status: 'pending',
    approved_by: null,
    approved_at: null,
    expires_at: '2099-01-01T00:00:00.000Z',
    verification_ref: null,
    policy_version: 'aria-governance-v1.0.0',
    created_at: '2026-09-02T00:00:00.000Z',
    ...overrides
  };
}

async function run() {
  assert.equal(validateRecord(baseRecord()).valid, true);
  assert.equal(validateRecord(baseRecord({ risk_class: 'UNKNOWN' })).reason, 'risk_class_invalid');
  assert.equal(validateRecord(baseRecord({ status: 'AVAILABLE' })).reason, 'status_invalid');
  assert.equal(validateRecord(baseRecord({ target: null })).reason, 'target_invalid');
  assert.equal(bindingMatches(baseRecord(), {
    request_id: 'req_1', execution_id: 'exec_1', tool_id: 'github', operation: 'read_file',
    risk_class: 'READ', policy_version: 'aria-governance-v1.0.0'
  }), true);
  assert.equal(bindingMatches(baseRecord(), {
    request_id: 'req_1', execution_id: 'exec_2', tool_id: 'github', operation: 'read_file',
    risk_class: 'READ', policy_version: 'aria-governance-v1.0.0'
  }), false);

  const db = new Map();
  const adapter = {
    async create(record) { db.set(record.authorization_id, { ...record }); return db.get(record.authorization_id); },
    async get(id) { return db.get(id) ?? null; },
    async transition(id, expected, next, decision) {
      const current = db.get(id);
      assert.equal(current.status, expected);
      const updated = { ...current, status: next };
      if (next === 'approved') {
        updated.approved_by = decision.approved_by;
        updated.approved_at = decision.approved_at;
        if (decision.verification_ref !== undefined) updated.verification_ref = decision.verification_ref;
      }
      db.set(id, updated);
      return updated;
    }
  };

  const store = createApprovalStore(adapter);
  await store.create(baseRecord());

  assert.equal(await store.canExecute('auth_1', {
    request_id: 'req_1', execution_id: 'exec_1', tool_id: 'github', operation: 'read_file',
    risk_class: 'READ', policy_version: 'aria-governance-v1.0.0'
  }), false);

  await assert.rejects(
    () => store.decide('auth_1', { status: 'approved', approved_at: '2026-09-02T01:00:00.000Z' }),
    /approved_by_required/
  );

  await store.decide('auth_1', {
    status: 'approved',
    approved_by: 'Robert',
    approved_at: '2026-09-02T01:00:00.000Z'
  });

  const binding = {
    request_id: 'req_1', execution_id: 'exec_1', tool_id: 'github', operation: 'read_file',
    risk_class: 'READ', policy_version: 'aria-governance-v1.0.0'
  };
  assert.equal(await store.canExecute('auth_1', binding), true);
  assert.equal(await store.canExecute('auth_1', { ...binding, operation: 'delete_repository' }), false);

  const highRisk = baseRecord({ authorization_id: 'auth_2', risk_class: 'HIGH_RISK_WRITE', operation: 'merge_pr' });
  await store.create(highRisk);
  await store.decide('auth_2', {
    status: 'approved', approved_by: 'Robert', approved_at: '2026-09-02T01:05:00.000Z'
  });
  assert.equal(await store.canExecute('auth_2', {
    request_id: 'req_1', execution_id: 'exec_1', tool_id: 'github', operation: 'merge_pr',
    risk_class: 'HIGH_RISK_WRITE', policy_version: 'aria-governance-v1.0.0'
  }), false, 'high-risk approval without verification must fail closed');

  await store.decide('auth_2', { status: 'revoked' });
  assert.equal(await store.canExecute('auth_2', {
    request_id: 'req_1', execution_id: 'exec_1', tool_id: 'github', operation: 'merge_pr',
    risk_class: 'HIGH_RISK_WRITE', policy_version: 'aria-governance-v1.0.0'
  }), false);

  const expired = baseRecord({ authorization_id: 'auth_3', expires_at: '2020-01-01T00:00:00.000Z', status: 'approved', approved_by: 'Robert', approved_at: '2020-01-01T00:00:00.000Z' });
  assert.equal(isExecutable(expired, binding), false);

  console.log('PASS: persistent human approval store control-layer tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
