'use strict';

const assert = require('node:assert/strict');
const { normalizeCandidate, utility, optimize, verifiedUnitCost } = require('../intelligence/cost-optimizer.js');

const missing = { model_id: 'unknown-price', quality: 0.95, reliability: 0.95, latency_ms: 250 };
const unverifiedZero = {
  model_id: 'unverified-zero', quality: 0.95, reliability: 0.95, latency_ms: 250,
  usd_per_1k: 0,
};
const verifiedFree = {
  model_id: 'verified-free', quality: 0.90, reliability: 0.90, latency_ms: 300,
  usd_per_1k: 0,
  cost_evidence: { source_id: 'provider-catalog:verified-entry-1', observed: true, verified: true },
};
const verifiedPaid = {
  model_id: 'verified-paid', quality: 0.90, reliability: 0.90, latency_ms: 300,
  usd_per_1k: 0.002,
  cost_evidence: { source_id: 'provider-catalog:verified-entry-2', observed: true, verified: true },
};

assert.equal(verifiedUnitCost(missing), null);
assert.equal(verifiedUnitCost(unverifiedZero), null);
assert.equal(verifiedUnitCost(verifiedFree), 0);
assert.equal(verifiedUnitCost(verifiedPaid), 0.002);

assert.equal(normalizeCandidate(missing).usd_per_1k, null);
assert.equal(normalizeCandidate(missing).cost_status, 'unknown');
assert.equal(normalizeCandidate(unverifiedZero).cost_status, 'unknown');
assert.equal(normalizeCandidate(verifiedFree).cost_status, 'verified_free');
assert.equal(normalizeCandidate(verifiedPaid).cost_status, 'verified');

assert.ok(
  utility(verifiedFree) > utility(missing),
  'a missing price must not receive the same cost-efficiency bonus as a verified free model',
);
assert.ok(
  utility(verifiedFree) > utility(verifiedPaid),
  'a verified zero price may receive the free-tier signal',
);

const selected = optimize([missing, verifiedPaid, verifiedFree]);
assert.equal(selected.model_id, 'verified-free');
assert.equal(selected.cost_status, 'verified_free');

const conservative = optimize([missing, unverifiedZero], { require_known_cost: true });
assert.equal(conservative, null, 'strict economic selection must reject unknown/unverified prices');

const input = { ...verifiedPaid };
optimize([input]);
assert.equal(input.utility, undefined, 'optimizer must not mutate caller-owned candidate objects');

assert.equal(normalizeCandidate({ latency_ms: null }).latency_ms, null);
assert.equal(normalizeCandidate({ latency_ms: 0 }).latency_ms, null);
assert.equal(normalizeCandidate({ usd_per_1k: Number.NaN }).cost_status, 'unknown');

console.log('ARIA COST OPTIMIZER VERIFIED-PRICING CONTRACT: PASS');
