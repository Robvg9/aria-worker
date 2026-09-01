/**
 * Mission 10.3 — Capability Matrix tests
 * Run: node tests/capability-matrix.test.js
 */
const assert = require('assert');
const path = require('path');
const {
  capabilitiesOf,
  modelsByCapability,
  supports,
  listCapabilityIds,
  getCapability,
  version
} = require('../capabilities/lookup.js');

// Also load Model Registry to validate capability_refs wiring
const modelReg = require('../models/registry.json');
const modelLookup = require('../models/lookup.js');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log('PASS:', msg);
}

console.log('=== Capability Matrix 10.3 tests ===');
console.log('version:', version);

// TEST 1 — models by capability
const models = modelsByCapability('text_generation');
ok(Array.isArray(models) && models.includes('google/gemini-2.5-flash-lite'),
  'TEST 1: modelsByCapability(text_generation) includes seed model');

// TEST 2 — capabilities of a model
const caps = capabilitiesOf('google/gemini-2.5-flash-lite');
ok(Array.isArray(caps) && caps.length === 1, 'TEST 2: capabilitiesOf seed model returns 1');
ok(caps[0].capability_id === 'text_generation', 'TEST 2b: capability_id is text_generation');
ok(caps[0].status === 'verified', 'TEST 2c: status is verified');

// TEST 3 — nonexistent capability
ok(modelsByCapability('does-not-exist').length === 0,
  'TEST 3: unknown capability returns empty list');
ok(supports('google/gemini-2.5-flash-lite', 'does-not-exist') === null,
  'TEST 3b: supports unknown capability returns null');

// TEST 4 — nonexistent model
ok(capabilitiesOf('missing-model').length === 0,
  'TEST 4: capabilitiesOf missing model returns empty');
ok(supports('missing-model', 'text_generation') === null,
  'TEST 4b: supports missing model returns null');

// TEST 5 — no duplicate capability_ids within matrix for same model
const pairs = caps.map(c => c.model_id + '::' + c.capability_id);
ok(pairs.length === new Set(pairs).size, 'TEST 5: no duplicate (model, capability) pairs');

// TEST 6 — Model Registry capability_refs point to valid capabilities
const model = modelLookup.getModel('google/gemini-2.5-flash-lite');
ok(model !== null, 'TEST 6: model still resolvable');
ok(Array.isArray(model.capability_refs), 'TEST 6b: capability_refs is array');
ok(model.capability_refs.includes('text_generation'),
  'TEST 6c: capability_refs includes text_generation');
const allCapIds = listCapabilityIds();
ok(model.capability_refs.every(id => allCapIds.includes(id)),
  'TEST 6d: every capability_ref exists in Capability Matrix');

// TEST 7 — no secrets
ok(!('api_key' in caps[0]) && !('secret' in caps[0]) && !('token' in (caps[0].metadata || {})),
  'TEST 7: no secrets in capability records');

// TEST 8 — supports true for verified
ok(supports('google/gemini-2.5-flash-lite', 'text_generation') === true,
  'TEST 8: supports(text_generation) === true');

// TEST 9 — Model Registry still works (10.2 compatibility)
ok(modelLookup.providerOf('google/gemini-2.5-flash-lite') === 'openrouter',
  'TEST 9: Model Registry providerOf still works');

// TEST 10 — matrix contains no router/account/quota logic keys
const forbidden = ['account_id', 'quota', 'router', 'fallback', 'execution'];
ok(!forbidden.some(k => k in caps[0] || k in (caps[0].metadata || {})),
  'TEST 10: no Account/Quota/Router fields in matrix');

console.log('\nAll', passed, 'assertions passed.');
