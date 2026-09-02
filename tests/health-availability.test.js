const assert = require('assert');
const health = require('../health/lookup');

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test('registry exposes the controlled version', () => {
  assert.strictEqual(health.version, 'aria-health-availability-v1.0.0');
});

test('known seed resolves without inference', () => {
  const result = health.getHealth({
    provider_id: 'openrouter',
    model_id: 'google/gemini-2.5-flash-lite',
    account_id: 'acct_openrouter_primary'
  });
  assert.ok(result);
  assert.strictEqual(result.health.status, 'unknown');
  assert.strictEqual(result.availability.status, 'unknown');
  assert.strictEqual(result.health.observed_at, null);
  assert.strictEqual(result.availability.evidence_ref, null);
});

test('unknown health is not observed', () => {
  assert.strictEqual(health.isObserved({ provider_id: 'openrouter' }), false);
});

test('unknown availability is not available', () => {
  assert.strictEqual(health.isAvailable({ provider_id: 'openrouter' }), false);
});

test('missing record returns null', () => {
  assert.strictEqual(health.getHealth({ provider_id: 'missing-provider' }), null);
});

test('list lookup returns matching records only', () => {
  const rows = health.listHealth({ model_id: 'google/gemini-2.5-flash-lite' });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].account_id, 'acct_openrouter_primary');
});

test('invalid filter returns empty list', () => {
  assert.deepStrictEqual(health.listHealth(null), []);
});

test('lookup functions do not mutate registry data', () => {
  const before = JSON.stringify(health.registry);
  health.getHealth({ provider_id: 'openrouter' });
  health.listHealth({ provider_id: 'openrouter' });
  assert.strictEqual(JSON.stringify(health.registry), before);
});

test('availability cannot be inferred from model/account metadata', () => {
  const result = health.getHealth({ account_id: 'acct_openrouter_primary' });
  assert.ok(result);
  assert.strictEqual(result.availability.status, 'unknown');
  assert.strictEqual(health.isAvailable({ account_id: 'acct_openrouter_primary' }), false);
});

console.log('Health / Availability: 8 tests passed, 0 failed');
