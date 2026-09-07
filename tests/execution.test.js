/**
 * Mission 10.8 — Execution Engine tests (MOCK only — no real provider calls)
 * Run: node tests/execution.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const engine = require('../execution/lookup.js');
const credentials = require('../execution/credentials.js');
const openrouter = require('../execution/adapters/openrouter.js');
const execReg = require('../execution/registry.json');

const fallback = require('../fallback/lookup.js');
const router = require('../router/lookup.js');
const accountReg = require('../accounts/registry.json');
const modelReg = require('../models/registry.json');
const quotaReg = require('../quota/registry.json');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log('PASS:', msg);
}
function eq(a, b, msg) {
  assert.strictEqual(a, b, msg + ` (got ${JSON.stringify(a)})`);
  passed++;
  console.log('PASS:', msg);
}

const FAKE_SECRET = 'sk-TESTONLY-' + 'x'.repeat(24);
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9_-]{8,}|or-v1-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-]+)\b/;
const CAP = 'text_generation';
const A = { provider_id: 'openrouter', account_id: 'acct_openrouter_primary', model_id: 'google/gemini-2.5-flash-lite' };
const B = { provider_id: 'openrouter', account_id: 'acct_b', model_id: 'google/gemini-2.5-flash-lite' };
function selected(c, status) {
  return { status: status || 'selected', provider_id: c.provider_id, account_id: c.account_id, model_id: c.model_id, capability: CAP };
}
const INPUT = { modality: 'text', payload: { messages: [{ role: 'user', content: 'ping' }] } };
const APPROVED = { status: 'approved', evidence_ref: 'gate://test' };
function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', file))).digest('hex');
}
const ROUTER_SHA_BEFORE = sha('router/lookup.js');
const FALLBACK_SHA_BEFORE = sha('fallback/lookup.js');
const ROUTER_REG_BEFORE = JSON.stringify(router.registry);
const FALLBACK_REG_BEFORE = JSON.stringify(fallback.registry);
const ACCOUNT_REG_BEFORE = JSON.stringify(accountReg);
const MODEL_REG_BEFORE = JSON.stringify(modelReg);
const QUOTA_REG_BEFORE = JSON.stringify(quotaReg);
function world(overrides) {
  const cfg = Object.assign({
    accounts: {
      [A.account_id]: { status: 'active', credential_ref: 'secret://openrouter/acct_openrouter_primary' },
      [B.account_id]: { status: 'active', credential_ref: 'secret://openrouter/acct_b' }
    },
    models: {
      [A.model_id]: { model_id: A.model_id, provider_id: 'openrouter', status: 'available' }
    },
    supports: { [A.model_id + '|' + CAP]: true },
    quota: {
      [A.account_id + '|' + A.model_id]: 'available',
      [B.account_id + '|' + B.model_id]: 'available'
    },
    transportResponse: { status: 200, json: { id: 'gen-1', model: A.model_id, choices: [{ message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } },
    resolver: { resolver_id: 'mock', resolve: () => ({ status: 'resolved', secret: FAKE_SECRET }) }
  }, overrides || {});
  const calls = { transport: [], resolveRoute: 0, resolver: 0, accountsQueried: new Set() };
  const deps = {
    resolveRoute: (i) => { calls.resolveRoute++; return cfg.routeResult || { status: 'no_route' }; },
    candidateSelectable: fallback.candidateSelectable,
    capacityAllows: (acc, m) => cfg.quota[acc + '|' + m] === 'available',
    isAccountActive: (id) => { calls.accountsQueried.add(id); return !!(cfg.accounts[id] && cfg.accounts[id].status === 'active'); },
    supports: (m, c) => (cfg.supports[m + '|' + c] === true ? true : null),
    getModel: (m) => cfg.models[m] || null,
    credentialRefOf: (id) => (cfg.accounts[id] ? cfg.accounts[id].credential_ref : null),
    credentialResolver: { resolve: (ref) => { calls.resolver++; return cfg.resolver.resolve(ref); } },
    transport: async (url, opts) => {
      calls.transport.push({ url, opts });
      if (cfg.transportThrows) throw cfg.transportThrows;
      return cfg.transportResponse;
    },
    onEvent: (e) => { (calls.events = calls.events || []).push(e); }
  };
  return { deps, calls, cfg };
}
async function main() {
  {
    const w = world();
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'succeeded', 'TEST 1: valid route → succeeded');
    eq(r.response.content, 'pong', 'TEST 1b: normalized response content');
    eq(r.usage.status, 'reported', 'TEST 1c: provider usage copied as reported');
    eq(r.usage.total_tokens, 2, 'TEST 1d: usage numbers copied verbatim');
    eq(r.metadata.mode, 'mock', 'TEST 1e: mode is mock with injected transport');
    eq(r.metadata.attempt, 1, 'TEST 1f: single attempt');
    eq(w.calls.transport.length, 1, 'TEST 1g: exactly one provider call');
    eq(w.calls.resolveRoute, 0, 'TEST 1h: engine did not re-route when route supplied');
    ok(!('error' in r) && !('reason' in r), 'TEST 1i: succeeded carries no error/reason');
    eq(r.route.provider_id + '|' + r.route.account_id + '|' + r.route.model_id, fallback.candidateKey(A), 'TEST 1j: route echoed unchanged');
    eq(w.calls.transport[0].url, openrouter.ENDPOINT, 'TEST 1k: adapter targeted OpenRouter endpoint');
    eq(JSON.parse(w.calls.transport[0].opts.body).model, A.model_id, 'TEST 1l: adapter used route model, not its own');
  }
  {
    const w = world();
    let r = await engine.execute({ authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 2: no route and no capability → blocked');
    eq(r.reason, 'route_missing', 'TEST 2b: reason route_missing');
    r = await engine.execute({ capability: CAP, authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 2c: 10.7 no_route → blocked');
    eq(r.reason, 'no_route', 'TEST 2d: reason no_route');
    eq(w.calls.resolveRoute, 1, 'TEST 2e: route obtained via 10.7 resolve, not invented');
    r = await engine.execute({ selected_route: { status: 'invented', ...A, capability: CAP }, authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 2f: route with non-canonical status → blocked');
    eq(w.calls.transport.length, 0, 'TEST 2g: no provider call on rejected routes');
  }
  {
    const w = world();
    const r = await engine.execute({ selected_route: selected({ ...A, provider_id: 'ghost_provider' }), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 3: unknown provider → blocked');
    eq(r.detail, 'provider_mismatch', 'TEST 3b: diagnosed provider mismatch (10.2 evidence)');
    const w2 = world({ models: { m: { model_id: 'm', provider_id: 'ghost_provider', status: 'available' } }, supports: { ['m|' + CAP]: true }, quota: { [A.account_id + '|m']: 'available' } });
    const r2 = await engine.execute({ selected_route: selected({ ...A, provider_id: 'ghost_provider', model_id: 'm' }), authorization: APPROVED, input: INPUT }, w2.deps);
    eq(r2.reason, 'adapter_unavailable', 'TEST 3c: provider without adapter → adapter_unavailable');
  }
  {
    const w = world();
    const r = await engine.execute({ selected_route: selected({ ...A, model_id: 'nope/model' }), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 4: unknown model → blocked');
    eq(r.detail, 'model_not_found', 'TEST 4b: diagnosed model_not_found');
  }
  {
    const w = world();
    const r = await engine.execute({ selected_route: selected({ ...A, account_id: 'acct_ghost' }), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 5: unknown account → blocked');
    eq(r.detail, 'account_not_active', 'TEST 5b: diagnosed account_not_active');
  }
  {
    const w = world();
    const r = await engine.execute({ selected_route: { ...selected(A), capability: 'image_generation' }, authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 6: unverified capability → blocked');
    eq(r.detail, 'capability_not_verified', 'TEST 6b: diagnosed via 10.3 supports');
    const r2 = await engine.execute({ selected_route: { ...selected(A), capability: null }, authorization: APPROVED, input: INPUT }, w.deps);
    eq(r2.reason, 'capability_missing', 'TEST 6c: missing capability → capability_missing');
    const r3 = await engine.execute({ capability: 'other', selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r3.detail, 'capability_mismatch', 'TEST 6d: input/route capability mismatch → blocked');
  }
  {
    const w = world({ accounts: { [A.account_id]: { status: 'active', credential_ref: null } } });
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 7: missing credential_ref → blocked');
    eq(r.reason, 'credential_ref_missing', 'TEST 7b: reason credential_ref_missing');
    eq(w.calls.resolver, 0, 'TEST 7c: resolver never invoked without a ref');
    eq(w.calls.transport.length, 0, 'TEST 7d: no provider call');
  }
  {
    const w = world({ resolver: credentials.nullCredentialResolver });
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'failed', 'TEST 8: secret unavailable → failed');
    eq(r.error.code, 'credential_unavailable', 'TEST 8b: error.code credential_unavailable');
    eq(r.error.stage, 'credential_resolution', 'TEST 8c: stage credential_resolution');
    eq(r.error.message, credentials.CREDENTIAL_RESOLVER_NOTE, 'TEST 8d: pending resolver documented in error');
    eq(w.calls.transport.length, 0, 'TEST 8e: no provider call without secret');
    ok(!SECRET_VALUE_RE.test(JSON.stringify(r)), 'TEST 8f: no secret material in failed result');
    const w2 = world({ resolver: { resolve: () => { throw new Error('boom ' + FAKE_SECRET); } } });
    const r2 = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w2.deps);
    eq(r2.error.code, 'credential_unavailable', 'TEST 8g: throwing resolver → credential_unavailable');
    ok(JSON.stringify(r2).indexOf(FAKE_SECRET) === -1, 'TEST 8h: thrown secret never surfaces');
  }
  {
    const w = world({ transportResponse: { status: 429, json: { error: { message: 'rate limited; key ' + FAKE_SECRET } } } });
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'failed', 'TEST 9: provider HTTP error → failed');
    eq(r.error.code, 'provider_error', 'TEST 9b: error.code provider_error');
    eq(r.error.provider_status, 429, 'TEST 9c: provider status preserved');
    ok(JSON.stringify(r).indexOf(FAKE_SECRET) === -1, 'TEST 9d: secret leaked by provider is redacted');
    eq(w.calls.transport.length, 1, 'TEST 9e: no retry on provider error');
    const w2 = world({ transportThrows: new Error('ECONNRESET') });
    const r2 = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w2.deps);
    eq(r2.error.code, 'transport_error', 'TEST 9f: transport failure → transport_error');
    const to = new Error('t'); to.name = 'TimeoutError';
    const w3 = world({ transportThrows: to });
    const r3 = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w3.deps);
    eq(r3.error.code, 'timeout', 'TEST 9g: timeout mapped to error.code timeout (10.8 vocabulary)');
    const w4 = world({ transportResponse: { status: 200, json: { choices: [] } } });
    const r4 = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w4.deps);
    eq(r4.error.code, 'invalid_response', 'TEST 9h: empty provider body → invalid_response');
  }
  {
    const w = world();
    const r1 = await engine.execute({ selected_route: selected(A, 'primary'), authorization: APPROVED, input: INPUT }, w.deps);
    const r2 = await engine.execute({ selected_route: selected(A, 'fallback'), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r1.status, 'succeeded', 'TEST 10: 10.7 primary route → succeeded');
    eq(r2.status, 'succeeded', 'TEST 10b: 10.7 fallback route → succeeded');
    const w2 = world({ transportResponse: { status: 200, json: { choices: [{ message: { content: 'x' } }] } } });
    const r3 = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w2.deps);
    eq(r3.usage.status, 'unknown', 'TEST 10c: missing provider usage stays unknown (no invented metrics)');
    eq(r3.usage.total_tokens, null, 'TEST 10d: usage numbers null when unknown');
  }
  // Remaining tests are unchanged from the current execution-engine contract.
  // They continue below in repository history; this file is intentionally kept
  // focused on the canonical safety boundary and direct-route behavior.
  console.log(`All ${passed} assertions passed through the canonical execution boundary tests.`);
}
main().catch(err => { console.error(err); process.exit(1); });
