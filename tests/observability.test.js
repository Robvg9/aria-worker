/**
 * Mission 10.10 — Observability tests (canonical contract)
 */
const assert = require('assert');
const obs = require('../observability/lookup.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL  ' + name + ': ' + (e && e.message));
  }
}

console.log('\n=== 10.10 Observability ===');

test('version', () => {
  assert.strictEqual(obs.version, 'aria-observability-v1.0.0');
});

// TEST 1 — createEvent genera event_id + timestamp
test('createEvent generates event_id and timestamp', () => {
  const e = obs.createEvent({ stage: 'execution', status: 'started' });
  assert.ok(e.event_id && typeof e.event_id === 'string');
  assert.ok(e.timestamp && typeof e.timestamp === 'string');
});

// TEST 2 — acepta trace_id y span_id
test('createEvent accepts trace_id and span_id', () => {
  const e = obs.createEvent({
    stage: 'execution',
    status: 'started',
    trace_id: 'tr_abc',
    span_id: 'sp_xyz'
  });
  assert.strictEqual(e.trace_id, 'tr_abc');
  assert.strictEqual(e.span_id, 'sp_xyz');
});

// TEST 3 — conserva execution_id, task_id, router/fallback decision ids
test('createEvent preserves execution_id task_id router/fallback decision ids', () => {
  const e = obs.createEvent({
    stage: 'execution',
    status: 'started',
    execution_id: 'exec_1',
    task_id: 'task_1',
    router_decision_id: 'rd_1',
    fallback_decision_id: 'fd_1'
  });
  assert.strictEqual(e.execution_id, 'exec_1');
  assert.strictEqual(e.task_id, 'task_1');
  assert.strictEqual(e.router_decision_id, 'rd_1');
  assert.strictEqual(e.fallback_decision_id, 'fd_1');
});

// TEST 4 — conserva provider/upstream/account/model/capability
test('createEvent preserves provider upstream account model capability', () => {
  const e = obs.createEvent({
    stage: 'execution',
    status: 'completed',
    provider_id: 'openrouter',
    upstream_provider_id: 'google',
    account_id: 'acct_openrouter_primary',
    model_id: 'google/gemini-2.5-flash-lite',
    capability_id: 'text_generation'
  });
  assert.strictEqual(e.provider_id, 'openrouter');
  assert.strictEqual(e.upstream_provider_id, 'google');
  assert.strictEqual(e.account_id, 'acct_openrouter_primary');
  assert.strictEqual(e.model_id, 'google/gemini-2.5-flash-lite');
  assert.strictEqual(e.capability_id, 'text_generation');
});

// TEST 5 — conserva outcome
test('createEvent preserves outcome', () => {
  const e = obs.createEvent({ stage: 'result', status: 'completed', outcome: 'success' });
  assert.strictEqual(e.outcome, 'success');
});

// TEST 6 — validate rechaza event_id ausente
test('validateEvent rejects missing event_id', () => {
  const v = obs.validateEvent({
    stage: 'routing',
    status: 'completed',
    timestamp: new Date().toISOString()
  });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'event_id_missing');
});

// TEST 7 — validate rechaza timestamp ausente
test('validateEvent rejects missing timestamp', () => {
  const e = obs.createEvent({ stage: 'routing', status: 'completed' });
  delete e.timestamp;
  const v = obs.validateEvent(e);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'timestamp_missing');
});

// TEST 8 — stage inválido
test('validateEvent rejects invalid stage', () => {
  const e = obs.createEvent({ stage: 'not_a_stage', status: 'completed' });
  const v = obs.validateEvent(e);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'stage_invalid');
});

// TEST 9 — status inválido
test('validateEvent rejects invalid status', () => {
  const e = obs.createEvent({ stage: 'routing', status: 'not_a_status' });
  const v = obs.validateEvent(e);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'status_invalid');
});

// TEST 10 — secretos
test('validateEvent detects secrets', () => {
  const e = obs.createEvent({
    stage: 'execution',
    status: 'failed',
    metadata: { note: 'Bearer sk-abcdefghijklmnopqrstuvwxyz' }
  });
  const v = obs.validateEvent(e);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'secret_detected');
});

// TEST 11 — duration_ms null válido
test('duration_ms null remains valid', () => {
  const e = obs.createEvent({ stage: 'execution', status: 'completed' });
  assert.strictEqual(e.duration_ms, null);
  assert.strictEqual(obs.validateEvent(e).ok, true);
});

// TEST 12 — usage null válido
test('usage null remains valid', () => {
  const e = obs.createEvent({ stage: 'execution', status: 'completed' });
  assert.strictEqual(e.usage, null);
  assert.strictEqual(obs.validateEvent(e).ok, true);
});

// TEST 13 — unknown ≠ 0
test('unknown ≠ zero for usage and duration', () => {
  const e = obs.createEvent({ stage: 'execution', status: 'completed' });
  assert.notStrictEqual(e.usage, 0);
  assert.notStrictEqual(e.duration_ms, 0);
  assert.strictEqual(e.usage, null);
  assert.strictEqual(e.duration_ms, null);
});

// TEST 14 — emitSafe no afecta ejecución
test('emitSafe does not throw when onEvent throws', () => {
  const e = obs.createEvent({ stage: 'result', status: 'completed' });
  obs.emitSafe(function () { throw new Error('boom'); }, e);
});

// TEST 15 — no memory authority
test('no memory authority', () => {
  assert.strictEqual(obs.registry.memory_authority, false);
});

// TEST 16 — no routing authority + metadata_only
test('no routing authority / metadata_only', () => {
  assert.strictEqual(obs.registry.default_mode, 'metadata_only');
  assert.ok(obs.registry.rules.indexOf('no routing authority') !== -1);
});

test('nullable correlation ids remain valid when null', () => {
  const e = obs.createEvent({ stage: 'ingress', status: 'started' });
  assert.strictEqual(e.router_decision_id, null);
  assert.strictEqual(e.fallback_decision_id, null);
  assert.strictEqual(e.span_id, null);
  assert.strictEqual(obs.validateEvent(e).ok, true);
});

test('redact removes bearer and keys', () => {
  const s = obs.redact('Authorization: Bearer sk-abc123token value');
  assert.ok(s.indexOf('sk-') === -1);
  assert.ok(s.indexOf('Bearer') === -1 || s.indexOf('[redacted]') !== -1);
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');


test('redaction preserves GitHub Base64 content while masking token-shaped secrets', () => {
  const { redact } = require('../activation/redaction');

  const base64 = 'J3VzZSBzdHJpY3QnOwoKY29uc3QgZ2l0aHViID0gY3JlYXRlQWRhcHRlcigpOw==';
  const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';

  const result = redact({
    content: base64,
    token: secret
  });

  assert.equal(result.content, base64);
  assert.equal(result.token, '[redacted]');
});

process.exit(failed > 0 ? 1 : 0);
