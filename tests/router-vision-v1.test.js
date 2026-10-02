'use strict';

/**
 * Router Vision V1
 *
 * Purpose:
 * - certify the currently LIVE primary provider path,
 * - prove the multi-provider fallback shape without inventing availability,
 * - enforce that unverified providers/models can never enter a route,
 * - keep rate-limit fallback explicitly policy-gated.
 *
 * This is a deterministic contract test; provider credentials are never embedded.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const router = require('../router/intelligent-v2.js');
const modelRegistry = require('../models/registry.json');

const CAP = 'text_generation';

function candidate({
  provider_id,
  account_id,
  model_id,
  live_verified = true,
  model_status = 'available',
  integration_status = 'connected',
  account_status = 'available',
  quota_status = 'available',
  rate_limit_status = 'unknown',
  agents = []
}) {
  return {
    model: {
      model_id,
      provider_id,
      status: model_status,
      enabled: true,
      integration_status,
      pricing: { tier: 'free', cost: '$0' },
      context_window: 100000,
      metadata: { access_path: provider_id === 'google' ? 'google_gemini_direct' : 'openrouter' }
    },
    capability_verified: true,
    live_verified,
    account: {
      account_id,
      status: account_status,
      enabled: true
    },
    quota: {
      status: quota_status,
      rate_limit_status
    },
    agents,
    observation: {
      attempts: 5,
      successes: 5,
      avg_latency_ms: provider_id === 'google' ? 400 : 700
    }
  };
}

const google = candidate({
  provider_id: 'google',
  account_id: 'acct_google_primary',
  model_id: 'google/gemini-3.5-flash-lite-direct',
  agents: [{
    agent_id: 'google-coder',
    role: 'coder',
    capabilities: ['text_generation', 'coding'],
    scope: ['read', 'reason', 'code'],
    max_risk: 'high',
    status: 'available'
  }]
});

const openrouter = candidate({
  provider_id: 'openrouter',
  account_id: 'acct_openrouter_secondary',
  model_id: 'cohere/north-mini-code:free',
  agents: [{
    agent_id: 'or-coder',
    role: 'coder',
    capabilities: ['text_generation', 'coding'],
    scope: ['read', 'reason', 'code'],
    max_risk: 'high',
    status: 'available'
  }]
});

const mistral = candidate({
  provider_id: 'mistral',
  account_id: 'acct_mistral_primary',
  model_id: 'mistral/mistral-small-latest',
  live_verified: false,
  model_status: 'unavailable',
  integration_status: 'partial',
  account_status: 'available',
  quota_status: 'unavailable'
});

function run() {
  console.log('=== Router Vision V1 ===');

  // 1. Current production-shaped primary: Google Direct.
  const primary = router.select(
    [google],
    { task: 'debug and implement a safe patch', capability: CAP, risk: 'high' }
  );
  assert.equal(primary.status, 'selected');
  assert.equal(primary.selected.provider_id, 'google');
  assert.equal(primary.selected.model_id, google.model.model_id);
  assert.equal(primary.fallback.length, 0);
  console.log('PASS: Google Direct is a valid primary route');

  // 2. Vision readiness: a second provider is automatically represented as fallback
  // when it becomes genuinely eligible. No provider-specific fallback code is required.
  const dual = router.select(
    [google, openrouter],
    { task: 'debug and implement a safe patch', capability: CAP, risk: 'high' }
  );
  assert.equal(dual.status, 'selected');
  assert.equal(dual.selected.provider_id, 'google');
  assert.equal(dual.fallback.length, 1);
  assert.equal(dual.fallback[0].provider_id, 'openrouter');
  assert.equal(dual.fallback[0].model_id, openrouter.model.model_id);
  console.log('PASS: second provider is structurally ready as fallback');

  // 3. No false route: Mistral is hard-rejected while live generation is unverified.
  const mistralOnly = router.select(
    [mistral],
    { task: 'write a short response', capability: CAP, risk: 'low' }
  );
  assert.equal(mistralOnly.status, 'no_route');
  assert.match(
    JSON.stringify(mistralOnly.rejected),
    /live_not_verified|model_unavailable/
  );
  console.log('PASS: Mistral cannot become a route without LIVE completion evidence');

  // 4. Explicit rate-limit governance: fallback is opt-in, never implicit.
  assert.deepEqual(
    router.governFallback(
      { provider_id: 'google', account_id: 'acct_google_primary' },
      [{ provider_id: 'openrouter', account_id: 'acct_openrouter_secondary', model_id: openrouter.model.model_id }],
      'rate_limit'
    ),
    []
  );
  const allowed = router.governFallback(
    { provider_id: 'google', account_id: 'acct_google_primary' },
    [{ provider_id: 'openrouter', account_id: 'acct_openrouter_secondary', model_id: openrouter.model.model_id }],
    'rate_limit',
    { allow_rate_limit_fallback: true }
  );
  assert.equal(allowed.length, 1);
  console.log('PASS: rate-limit fallback remains policy-gated');

  // 5. Static registry sanity for the known Mistral gate.
  const mistralRecord = modelRegistry.models.find(m => m.model_id === 'mistral/mistral-small-latest');
  assert.ok(mistralRecord);
  assert.equal(mistralRecord.status, 'unavailable');
  console.log('PASS: Mistral registry remains non-selectable');

  // 6. The V2 implementation itself must retain live-verification gating.
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'router', 'intelligent-v2.js'),
    'utf8'
  );
  assert.match(source, /if\(!c\.live_verified\)hard\.push\('live_not_verified'\)/);
  assert.match(source, /function governFallback/);
  assert.match(source, /failureKind==='rate_limit'&&policy\.allow_rate_limit_fallback!==true/);
  console.log('PASS: V2 source retains live gate + governed fallback');

  console.log('ROUTER VISION V1 CONTRACT: PASS');
}

run();
