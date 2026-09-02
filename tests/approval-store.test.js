'use strict';

const assert = require('node:assert/strict');
const { createApprovalStore, validateRecord, validateVerificationRef, bindingMatches, isExecutable } = require('../approvals/store');

function baseRecord(overrides = {}) {
  return {
    authorization_id: 'auth_1', request_id: 'req_1', execution_id: 'exec_1', tool_id: 'github', operation: 'read_file',
    risk_class: 'READ', target: { repository: 'Robvg9/aria-worker', path: 'README.md' }, status: 'pending',
    approved_by: null, approved_at: null, expires_at: '2099-01-01T00:00:00.000Z', verification_ref: null,
    policy_version: 'aria-governance-v1.0.0', created_at: '2026-09-02T00:00:00.000Z', ...overrides
  };
}

async function run() {
  assert.equal(validateRecord(baseRecord()).valid, true);
  assert.equal(validateRecord(baseRecord({ risk_class: 'UNKNOWN' })).reason, 'risk_class_invalid');
  assert.equal(validateRecord(baseRecord({ status: 'AVAILABLE' })).reason, 'status_invalid');
  assert.equal(validateRecord(baseRecord({ target: null })).reason, 'target_invalid');
  assert.equal(validateRecord(baseRecord({ verification_ref: 'Bearer secret_token_12345678' })).reason, 'verification_secret_rejected');
  assert.deepEqual(validateVerificationRef('verify://human/abc123'), { valid: true, value: 'verify://human/abc123', reason: null });
  assert.equal(validateVerificationRef('secret://github/prod').reason, 'verification_ref_invalid');

  const sameBinding = {
    request_id: 'req_1', execution_id: 'exec_1', tool_id: 'github', operation: 'read_file', risk_class: 'READ',
    policy_version: 'aria-governance-v1.0.0', target: { path: 'README.md', repository: 'Robvg9/aria-worker' }
  };
  assert.equal(bindingMatches(baseRecord(), sameBinding), true);
  assert.equal(bindingMatches(baseRecord(), { ...sameBinding, execution_id: 'exec_2' }), false);
  assert.equal(bindingMatches(baseRecord(), { ...sameBinding, target: { ...sameBinding.target, path: 'package.json' } }), false);
  assert.equal(bindingMatches(baseRecord(), { ...sameBinding, target: undefined }), false);

  const db = new Map();
  const adapter = {
    async create(record) { db.set(record.authorization_id, { ...record }); return db.get(record.authorization_id); },
    async get(id) { return db.get(id) ?? null; },
    async transition(id, expected, next, decision) {
      const current = db.get(id); assert.equal(current.status, expected);
      const updated = { ...current, status: next };
      if (next === 'approved') {
        updated.approved_by = decision.approved_by; updated.approved_at = decision.approved_at;
        if (decision.verification_ref !== undefined) updated.verification_ref = decision.verification_ref;
      }
      db.set(id, updated); return updated;
    }
  };

  const store = createApprovalStore(adapter);
  await store.create(baseRecord());
  assert.equal(await store.canExecute('auth_1', sameBinding), false);

  await assert.rejects(() => store.decide('auth_1', { status: 'approved', approved_at: '2026-09-02T01:00:00.000Z' }), /approved_by_required/);
  await store.decide('auth_1', { status: 'approved', approved_by: 'Robert', approved_at: '2026-09-02T01:00:00.000Z' });
  assert.equal(await store.canExecute('auth_1', sameBinding), true);
  assert.equal(await store.canExecute('auth_1', { ...sameBinding, target: { repository: 'Robvg9/aria-worker', path: 'package.json' } }), false);

  // Tampering/invalid durable data must fail closed before execution.
  db.get('auth_1').approved_by = null;
  assert.equal(await store.canExecute('auth_1', sameBinding), false);
  db.get('auth_1').approved_by = 'Robert';
  db.get('auth_1').verification_ref = 'verify://human/abc123';
  assert.equal(isExecutable(db.get('auth_1'), sameBinding), false, 'READ should not need verification, but malformed status/record still must fail safely');
  db.get('auth_1').verification_ref = null;

  const highRisk = baseRecord({ authorization_id: 'auth_2', risk_class: 'HIGH_RISK_WRITE', operation: 'merge_pr', target: { repository: 'Robvg9/aria-worker', pull_request: 1 } });
  await store.create(highRisk);
  const highBinding = { request_id: 'req_1', execution_id: 'exec_1', tool_id: 'github', operation: 'merge_pr', risk_class: 'HIGH_RISK_WRITE', policy_version: 'aria-governance-v1.0.0', target: { repository: 'Robvg9/aria-worker', pull_request: 1 } };
  await assert.rejects(() => store.decide('auth_2', { status: 'approved', approved_by: 'Robert', approved_at: '2026-09-02T01:05:00.000Z' }), /verification_required|verification_ref_invalid/);
  await store.decide('auth_2', { status: 'approved', approved_by: 'Robert', approved_at: '2026-09-02T01:06:00.000Z', verification_ref: 'verify://human/approval-1' });
  assert.equal(await store.canExecute('auth_2', highBinding), true);
  await store.decide('auth_2', { status: 'revoked' });
  assert.equal(await store.canExecute('auth_2', highBinding), false);

  const expired = baseRecord({ authorization_id: 'auth_3', expires_at: '2020-01-01T00:00:00.000Z', status: 'approved', approved_by: 'Robert', approved_at: '2020-01-01T00:00:00.000Z' });
  assert.equal(isExecutable(expired, sameBinding), false);

  console.log('PASS: persistent human approval store control-layer tests');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
