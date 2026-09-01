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

test('createEvent fills defaults including timestamp', () => {
  const e = obs.createEvent({ stage: 'execution', status: 'started' });
  assert.ok(e.event_id);
  assert.strictEqual(e.stage, 'execution');
  assert.strictEqual(e.status, 'started');
  assert.strictEqual(e.duration_ms, null);
  assert.strictEqual(e.usage, null);
  assert.ok(typeof e.timestamp === 'string' && e.timestamp.length > 0);
  assert.strictEqual(e.span_id, null); // optional until set
});

test('createEvent accepts span_id and trace_id', () => {
  const e = obs.createEvent({
    stage: 'execution',
    status: 'started',
    trace_id: 'tr_abc',
    span_id: 'sp_xyz'
  });
  assert.strictEqual(e.trace_id, 'tr_abc');
  assert.strictEqual(e.span_id, 'sp_xyz');
});

test('validateEvent accepts valid with timestamp', () => {
  const e = obs.createEvent({ stage: 'routing', status: 'completed' });
  const v = obs.validateEvent(e);
  assert.strictEqual(v.ok, true);
});

test('validateEvent rejects missing event_id', () => {
  const v = obs.validateEvent({ stage: 'routing', status: 'completed', timestamp: new Date().toISOString() });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'event_id_missing');
});

test('validateEvent rejects missing timestamp', () => {
  const e = obs.createEvent({ stage: 'routing', status: 'completed' });
  delete e.timestamp;
  const v = obs.validateEvent(e);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'timestamp_missing');
});

test('validateEvent rejects secret patterns', () => {
  const e = obs.createEvent({
    stage: 'execution',
    status: 'failed',
    metadata: { note: 'Bearer sk-abcdefghijklmnopqrstuvwxyz' }
  });
  const v = obs.validateEvent(e);
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.reason, 'secret_detected');
});

test('redact removes bearer and keys', () => {
  const s = obs.redact('Authorization: Bearer sk-abc123token value');
  assert.ok(s.indexOf('sk-') === -1);
  assert.ok(s.indexOf('Bearer') === -1 || s.indexOf('[redacted]') !== -1);
});

test('usage and duration remain null (unknown ≠ zero)', () => {
  const e = obs.createEvent({ stage: 'execution', status: 'completed' });
  assert.strictEqual(e.usage, null);
  assert.strictEqual(e.duration_ms, null);
});

test('emitSafe does not throw when onEvent throws', () => {
  const e = obs.createEvent({ stage: 'result', status: 'completed' });
  obs.emitSafe(function () { throw new Error('boom'); }, e);
});

test('emitSafe skips non-function', () => {
  obs.emitSafe(null, obs.createEvent({ stage: 'result', status: 'completed' }));
});

test('memory_authority false', () => {
  assert.strictEqual(obs.registry.memory_authority, false);
});

test('default_mode metadata_only', () => {
  assert.strictEqual(obs.registry.default_mode, 'metadata_only');
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
