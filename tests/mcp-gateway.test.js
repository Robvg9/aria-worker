'use strict';

const assert = require('assert');
const gateway = require('../mcp-gateway/lookup.js');
const dispatchGateway = require('../mcp-gateway');
const registry = require('../mcp-gateway/registry.json');

const tool = {
  tool_id: 'tool_github',
  status: 'available',
  operations: ['read_file', 'create_file']
};

const approvedRead = {
  authorization_id: 'auth-1',
  execution_id: 'exec-1',
  request_id: 'req-1',
  tool_id: 'tool_github',
  operation: 'read_file',
  risk_class: 'READ',
  decision: 'approved',
  reviewed_by: 'Robert',
  reviewed_at: '2026-09-02T00:00:00Z',
  policy_version: 'governance-v1'
};

const baseRead = {
  request_id: 'req-1',
  task_id: null,
  execution_id: 'exec-1',
  tool_id: 'tool_github',
  operation: 'read_file',
  input: { path: 'README.md' },
  authorization_id: 'auth-1',
  risk_class: 'READ'
};

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

test('registry is controlled-runtime and LIVE disabled', () => {
  assert.strictEqual(registry.mode, 'controlled_runtime');
  assert.strictEqual(registry.live_dispatch, false);
  assert.strictEqual(registry.controlled_dispatch, true);
});

test('valid request passes shape validation', () => {
  assert.strictEqual(gateway.validateRequest(baseRead).status, 'valid');
});

test('missing request id blocks', () => {
  assert.strictEqual(gateway.validateRequest({ ...baseRead, request_id: '' }).reason, 'missing_request_id');
});

test('unknown tool status blocks', () => {
  assert.strictEqual(gateway.validateRegisteredTool({ ...tool, status: 'unknown' }).status, 'blocked');
});

test('unavailable tool blocks', () => {
  assert.strictEqual(gateway.validateRegisteredTool({ ...tool, status: 'unavailable' }).reason, 'tool_unavailable');
});

test('unknown operation blocks', () => {
  assert.strictEqual(gateway.validateOperation(tool, 'delete_repo').reason, 'unknown_operation');
});

test('authorization must be approved', () => {
  assert.strictEqual(gateway.validateAuthorization(baseRead, { ...approvedRead, decision: 'pending_approval' }).reason, 'authorization_not_approved');
});

test('authorization execution binding is enforced', () => {
  assert.strictEqual(gateway.validateAuthorization(baseRead, { ...approvedRead, execution_id: 'other' }).reason, 'execution_scope_mismatch');
});

test('authorization request binding is enforced', () => {
  assert.strictEqual(gateway.validateAuthorization(baseRead, { ...approvedRead, request_id: 'other' }).reason, 'request_scope_mismatch');
});

test('authorization tool binding is enforced', () => {
  assert.strictEqual(gateway.validateAuthorization(baseRead, { ...approvedRead, tool_id: 'other' }).reason, 'tool_scope_mismatch');
});

test('authorization operation binding is enforced', () => {
  assert.strictEqual(gateway.validateAuthorization(baseRead, { ...approvedRead, operation: 'create_file' }).reason, 'operation_scope_mismatch');
});

test('authorization risk binding is enforced', () => {
  assert.strictEqual(gateway.validateAuthorization(baseRead, { ...approvedRead, risk_class: 'HIGH_RISK_WRITE' }).reason, 'risk_scope_mismatch');
});

test('approved authorization requires review evidence', () => {
  assert.strictEqual(gateway.validateAuthorization(baseRead, { ...approvedRead, reviewed_by: '' }).reason, 'missing_approval_evidence');
});

test('READ does not require extra human verification', () => {
  assert.strictEqual(gateway.validateHumanVerification(baseRead, null).status, 'not_required');
});

test('HIGH_RISK_WRITE requires human verification', () => {
  const request = { ...baseRead, risk_class: 'HIGH_RISK_WRITE' };
  assert.strictEqual(gateway.validateHumanVerification(request, null).reason, 'human_verification_required');
});

test('DESTRUCTIVE rejects plaintext password', () => {
  const request = { ...baseRead, risk_class: 'DESTRUCTIVE' };
  const verification = { status: 'verified', verification_ref: 'vr-1', password: 'do-not-pass' };
  assert.strictEqual(gateway.validateHumanVerification(request, verification).reason, 'plaintext_secret_forbidden');
});

test('verified high-risk request becomes dispatchable', () => {
  const request = { ...baseRead, risk_class: 'HIGH_RISK_WRITE' };
  const auth = { ...approvedRead, risk_class: 'HIGH_RISK_WRITE', operation: 'create_file' };
  const highRiskTool = { ...tool, operations: ['read_file', 'create_file'] };
  const check = gateway.planDispatch(
    { ...request, operation: 'create_file', input: { path: 'x' } },
    highRiskTool,
    auth,
    { status: 'verified', verification_ref: 'vr-1' }
  );
  assert.strictEqual(check.status, 'dispatchable');
});

test('missing verification blocks destructive dispatch', () => {
  const request = { ...baseRead, risk_class: 'DESTRUCTIVE', operation: 'create_file' };
  const auth = { ...approvedRead, risk_class: 'DESTRUCTIVE', operation: 'create_file' };
  assert.strictEqual(gateway.planDispatch(request, tool, auth, null).reason, 'human_verification_required');
});

test('result normalization is fail-closed for malformed output', () => {
  const normalized = gateway.normalizeResult(null);
  assert.strictEqual(normalized.status, 'failed');
  assert.strictEqual(normalized.error_code, 'invalid_adapter_result');
});

test('unknown adapter status normalizes to failed', () => {
  assert.strictEqual(gateway.normalizeResult({ status: 'wat', result: {}, metadata: {} }).status, 'failed');
});

test('secret text detector rejects credential-like output', () => {
  assert.strictEqual(gateway.containsForbiddenSecretText('password=supersecret'), true);
});

test('ordinary result without secrets is not flagged', () => {
  assert.strictEqual(gateway.containsForbiddenSecretText('repository updated'), false);
});

test('controlled gateway dispatch reaches injected adapter only after validation', async () => {
  const request = { ...baseRead };
  let calls = 0;
  const adapter = { async execute(input) {
    calls += 1;
    assert.strictEqual(Object.isFrozen(input), true);
    return { status: 'succeeded', result: { ok: true }, metadata: { mode: 'mock' } };
  }};
  const result = await dispatchGateway.dispatchAuthorized({ request, tool, authorization: approvedRead, adapter });
  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(calls, 1);
  assert.strictEqual(result.metadata.dispatch_attempted, true);
});

test('gateway dispatch does not reach adapter on authorization mismatch', async () => {
  let calls = 0;
  const result = await dispatchGateway.dispatchAuthorized({
    request: baseRead,
    tool,
    authorization: { ...approvedRead, execution_id: 'other' },
    adapter: { async execute() { calls += 1; return { status: 'succeeded', result: {} }; } }
  });
  assert.strictEqual(result.status, 'blocked');
  assert.strictEqual(result.reason, 'execution_scope_mismatch');
  assert.strictEqual(calls, 0);
});

test('gateway dispatch rejects sensitive adapter output', async () => {
  const result = await dispatchGateway.dispatchAuthorized({
    request: baseRead,
    tool,
    authorization: approvedRead,
    adapter: { async execute() { return { status: 'succeeded', result: { message: 'Bearer abc-secret' } }; } }
  });
  assert.strictEqual(result.status, 'blocked');
  assert.strictEqual(result.reason, 'sensitive_output_rejected');
});

console.log(`\n${passed} passed, 0 failed`);
