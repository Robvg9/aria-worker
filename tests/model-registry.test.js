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
ok(m !== null, 'TEST 1: getModel returns the verified mediated model');
ok(m.provider_id === 'openrouter', 'TEST 1b: provider_id is openrouter');
ok(m.upstream_provider_id === 'google', 'TEST 1c: upstream_provider_id is google');
ok(m.status === 'available', 'TEST 1d: mediated status available');
ok(!('api_key' in m) && !('secret' in m) && !('token' in (m.metadata || {})), 'TEST 1e: no secrets');

// TEST 2 — models of a provider
const list = modelsByProvider('openrouter');
ok(Array.isArray(list) && list.length === 1, 'TEST 2: modelsByProvider(openrouter) returns 1 model');
ok(list[0].model_id === 'google/gemini-2.5-flash-lite', 'TEST 2b: correct model_id');

// TEST 3 — direct Google route is registered but not routable until credential health is verified
const direct = getModel('google/gemini-2.5-flash-lite-direct');
ok(direct !== null, 'TEST 3: direct Gemini model is registered');
ok(direct.provider_id === 'google', 'TEST 3b: direct Gemini provider is google');
ok(direct.status === 'unknown', 'TEST 3c: direct Gemini remains unknown until physical credential health');
ok(providerOf('google/gemini-2.5-flash-lite-direct') === 'google', 'TEST 3d: providerOf direct Gemini works');
ok(modelsByProvider('google').length === 1, 'TEST 3e: Google provider has one direct model route');

// TEST 4 — nonexistent model
ok(getModel('does-not-exist') === null, 'TEST 4: nonexistent model returns null');
ok(modelsByProvider('nonexistent-provider').length === 0, 'TEST 4b: unknown provider returns empty list');

// TEST 5 — no logical duplicates
const ids = listModelIds();
ok(ids.length === new Set(ids).size, 'TEST 5: no duplicate model_ids');

// TEST 6 — capability_refs prepared
ok(Array.isArray(m.capability_refs), 'TEST 6: capability_refs array present');
ok(Array.isArray(direct.capability_refs), 'TEST 6b: direct model capability_refs array present');

console.log('\nAll', passed, 'assertions passed.');
