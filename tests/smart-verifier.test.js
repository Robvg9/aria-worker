import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { verifyMission } = require('../verification/smart-verifier.js');

const base = {
  goal: 'return exact verifier token',
  plan: { steps: [{ id: 'model_1', executor_type: 'model', operation: 'text_generation', target: { provider_id: 'google', account_id: 'acct', model_id: 'model' }, authorization: { status: 'approved' }, verify: { response_content_equals: 'ARIA_VERIFY_OK' } }] },
  step: { id: 'model_1', executor_type: 'model', operation: 'text_generation', target: { provider_id: 'google', account_id: 'acct', model_id: 'model' }, authorization: { status: 'approved' }, verify: { response_content_equals: 'ARIA_VERIFY_OK' } },
  result: { status: 'succeeded', provider_id: 'google', response: { content: 'ARIA_VERIFY_OK' } },
};

test('smart verifier passes complete contract', () => {
  const r = verifyMission(base);
  assert.equal(r.version, 'smart-verifier-v1');
  assert.equal(r.passed, true);
  assert.deepEqual(r.failed_checks, []);
});

test('smart verifier rejects semantic mismatch', () => {
  const r = verifyMission({ ...base, result: { ...base.result, response: { content: 'WRONG' } } });
  assert.equal(r.passed, false);
  assert.ok(r.failed_checks.includes('semantic:response_content_equals'));
  assert.ok(r.failed_checks.includes('goal:goal_semantic_contract'));
});

test('smart verifier rejects incomplete model route', () => {
  const r = verifyMission({ ...base, step: { ...base.step, target: { provider_id: 'google' } } });
  assert.equal(r.passed, false);
  assert.ok(r.failed_checks.includes('provider:account_id_present'));
});

test('smart verifier rejects exposed secret-shaped material', () => {
  const r = verifyMission({ ...base, result: { ...base.result, metadata: { secret: 'DO_NOT_STORE' } } });
  assert.equal(r.passed, false);
  assert.ok(r.failed_checks.includes('security:secret_material_not_exposed'));
});

test('smart verifier accepts non-model executor without provider check', () => {
  const step = { id: 'connector_1', executor_type: 'connector', operation: 'health', target: { connector_id: 'supabase' }, authorization: { status: 'approved' }, verify: {} };
  const r = verifyMission({ goal: 'health', plan: { steps: [step] }, step, result: { status: 'succeeded', data: { ok: true } } });
  assert.equal(r.passed, true);
});
