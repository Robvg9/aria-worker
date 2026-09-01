/**
 * Mission 10.12 — Governance tests
 */
const assert = require('assert');
const gov = require('../governance/lookup.js');

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

console.log('\n=== 10.12 Governance ===');

test('version', () => {
  assert.strictEqual(gov.version, 'aria-governance-v1.0.0');
});

test('isApproved true only for approved', () => {
  assert.strictEqual(gov.isApproved({ status: 'approved' }), true);
  assert.strictEqual(gov.isApproved({ status: 'pending_gate' }), false);
  assert.strictEqual(gov.isApproved(null), false);
});

test('missing authorization → blocked', () => {
  const r = gov.evaluateAuthorization({ action_type: 'execute' });
  assert.strictEqual(r.status, 'blocked');
  assert.strictEqual(r.reason, 'authorization_missing');
});

test('approved authorization → approved', () => {
  const r = gov.evaluateAuthorization({
    action_type: 'execute',
    authorization: { status: 'approved', authority: 'human', evidence_ref: 'ev1' }
  });
  assert.strictEqual(r.status, 'approved');
});

test('memory_write requires human gate', () => {
  assert.strictEqual(gov.requiresHumanGate('memory_write', {}), true);
  const r = gov.evaluateAuthorization({
    action_type: 'memory_write',
    authorization: { status: 'pending_gate', authority: 'policy' }
  });
  assert.strictEqual(r.status, 'pending_gate');
  assert.strictEqual(r.reason, 'require_human_gate');
});

test('denied authorization → blocked', () => {
  const r = gov.evaluateAuthorization({
    action_type: 'execute',
    authorization: { status: 'denied', authority: 'human' }
  });
  assert.strictEqual(r.status, 'blocked');
});

test('expired → blocked', () => {
  const r = gov.evaluateAuthorization({
    action_type: 'execute',
    authorization: { status: 'expired', authority: 'human' }
  });
  assert.strictEqual(r.status, 'blocked');
});

test('memory_authority false', () => {
  assert.strictEqual(gov.registry.memory_authority, false);
});

console.log('\nResults: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
