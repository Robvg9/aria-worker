'use strict';

const assert = require('assert');
const { normalizeExecutionRequest, requestFingerprint, VERSION } = require('../execution/request.js');

const base = {
  execution_version: VERSION,
  request_id: 'req_test_001',
  task_id: 'task_test_001',
  capability: 'text_generation',
  selected_route: {
    status: 'selected',
    provider_id: 'openrouter',
    account_id: 'acct_openrouter_primary',
    model_id: 'google/gemini-2.5-flash-lite',
    capability: 'text_generation'
  },
  authorization: { status: 'approved', risk_class: 'READ', evidence_ref: 'verify://test/approved' },
  input: { modality: 'text', payload: { messages: [{ role: 'user', content: 'test' }] } }
};

const normalized = normalizeExecutionRequest(base);
assert.strictEqual(normalized.execution_version, '1');
assert.strictEqual(normalized.authorization.status, 'approved');
assert.ok(normalized.execution_id.startsWith('exec_'));
assert.strictEqual(requestFingerprint(base), requestFingerprint({ ...base, execution_id: 'ignored-for-fingerprint' }));

assert.throws(() => normalizeExecutionRequest({ ...base, execution_version: '2' }), /unsupported execution_version/);
assert.throws(() => normalizeExecutionRequest({ ...base, request_id: '' }), /request_id must be a non-empty string/);
assert.throws(() => normalizeExecutionRequest({ ...base, input: [] }), /input must be an object/);
assert.throws(() => normalizeExecutionRequest({ ...base, authorization: { status: 'approved', risk_class: 'INVALID' } }), /invalid authorization.risk_class/);
assert.throws(() => normalizeExecutionRequest({ ...base, selected_route: { ...base.selected_route, capability: 'image_generation' } }), /selected_route.capability must match capability/);
assert.throws(() => normalizeExecutionRequest({ ...base, selected_route: { ...base.selected_route, status: 'invalid' } }), /invalid selected_route.status/);

console.log('execution-request.test.js: PASS');
