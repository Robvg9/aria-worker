/**
 * Mission 10.2 — Model Registry tests
 * Run: node tests/model-registry.test.js
 */
const assert = require('assert');
const {
  getModel,
  modelsByProvider,
  providerOf,
  listModelIds,
  version
} = require('../models/lookup.js');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log('PASS:', msg);
}

console.log('=== Model Registry 10.2 tests ===');
console.log('version:', version);

// TEST 1 — lookup by model_id
const m = getModel('google/gemini-2.5-flash-lite');
ok(m !== null, 'TEST 1: getModel returns the verified model');
ok(m.provider_id === 'openrouter', 'TEST 1b: provider_id is openrouter');
ok(m.upstream_provider_id === 'google', 'TEST 1c: upstream_provider_id is google');
ok(m.status === 'available', 'TEST 1d: status available');
ok(!('api_key' in m) && !('secret' in m) && !('token' in (m.metadata || {})), 'TEST 1e: no secrets');

// TEST 2 — models of a provider
const list = modelsByProvider('openrouter');
ok(Array.isArray(list) && list.length === 1, 'TEST 2: modelsByProvider(openrouter) returns 1 model');
ok(list[0].model_id === 'google/gemini-2.5-flash-lite', 'TEST 2b: correct model_id');

// TEST 3 — nonexistent model
ok(getModel('does-not-exist') === null, 'TEST 3: nonexistent model returns null');
ok(modelsByProvider('nonexistent-provider').length === 0, 'TEST 3b: unknown provider returns empty list');

// TEST 4 — no logical duplicates
const ids = listModelIds();
ok(ids.length === new Set(ids).size, 'TEST 4: no duplicate model_ids');

// TEST 5 — provider relation
ok(providerOf('google/gemini-2.5-flash-lite') === 'openrouter', 'TEST 5: providerOf works');
ok(providerOf('missing') === null, 'TEST 5b: providerOf missing is null');

// TEST 6 — capability_refs prepared for 10.3
ok(Array.isArray(m.capability_refs), 'TEST 6: capability_refs array present (empty until 10.3)');

console.log('\nAll', passed, 'assertions passed.');
