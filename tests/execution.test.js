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

// A fake secret that must never appear anywhere except inside the mock resolver/transport.
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

/**
 * Controlled world: positive quota evidence for A and B, never touching real registries.
 * Records every dependency call so tests can assert no hopping / no retry.
 */
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
  // ── TEST 1: valid route + approved → succeeded
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
    eq(r.route.provider_id + '|' + r.route.account_id + '|' + r.route.model_id,
      fallback.candidateKey(A), 'TEST 1j: route echoed unchanged');
    eq(w.calls.transport[0].url, openrouter.ENDPOINT, 'TEST 1k: adapter targeted OpenRouter endpoint');
    eq(JSON.parse(w.calls.transport[0].opts.body).model, A.model_id, 'TEST 1l: adapter used route model, not its own');
  }

  // ── TEST 2: route inexistente
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

  // ── TEST 3: provider inexistente
  {
    const w = world();
    const r = await engine.execute({ selected_route: selected({ ...A, provider_id: 'ghost_provider' }), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 3: unknown provider → blocked');
    eq(r.detail, 'provider_mismatch', 'TEST 3b: diagnosed provider mismatch (10.2 evidence)');
    const w2 = world({ models: { m: { model_id: 'm', provider_id: 'ghost_provider', status: 'available' } }, supports: { ['m|' + CAP]: true }, quota: { [A.account_id + '|m']: 'available' } });
    const r2 = await engine.execute({ selected_route: selected({ ...A, provider_id: 'ghost_provider', model_id: 'm' }), authorization: APPROVED, input: INPUT }, w2.deps);
    eq(r2.reason, 'adapter_unavailable', 'TEST 3c: provider without adapter → adapter_unavailable');
  }

  // ── TEST 4: model inexistente
  {
    const w = world();
    const r = await engine.execute({ selected_route: selected({ ...A, model_id: 'nope/model' }), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 4: unknown model → blocked');
    eq(r.detail, 'model_not_found', 'TEST 4b: diagnosed model_not_found');
  }

  // ── TEST 5: account inexistente
  {
    const w = world();
    const r = await engine.execute({ selected_route: selected({ ...A, account_id: 'acct_ghost' }), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 5: unknown account → blocked');
    eq(r.detail, 'account_not_active', 'TEST 5b: diagnosed account_not_active');
  }

  // ── TEST 6: capability inválida
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

  // ── TEST 7: credential_ref ausente → rechazo seguro
  {
    const w = world({ accounts: { [A.account_id]: { status: 'active', credential_ref: null } } });
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 7: missing credential_ref → blocked');
    eq(r.reason, 'credential_ref_missing', 'TEST 7b: reason credential_ref_missing');
    eq(w.calls.resolver, 0, 'TEST 7c: resolver never invoked without a ref');
    eq(w.calls.transport.length, 0, 'TEST 7d: no provider call');
  }

  // ── TEST 8: secreto no disponible → error seguro
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

  // ── TEST 9: provider error → failed
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

  // ── TEST 10: respuesta válida → succeeded (fallback/primary route statuses accepted)
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

  // ── TEST 11: execution_id determinista/único
  {
    const w = world();
    const req = { task_id: 't1', selected_route: selected(A), authorization: APPROVED, input: INPUT };
    const r1 = await engine.execute(req, w.deps);
    const r2 = await engine.execute(JSON.parse(JSON.stringify(req)), w.deps);
    eq(r1.execution_id, r2.execution_id, 'TEST 11: same request → same execution_id');
    ok(/^exec_[0-9a-f]{32}$/.test(r1.execution_id), 'TEST 11b: execution_id shape exec_<hex32>');
    const r3 = await engine.execute({ ...req, task_id: 't2' }, w.deps);
    ok(r3.execution_id !== r1.execution_id, 'TEST 11c: different task_id → different id');
    const r4 = await engine.execute({ ...req, input: { modality: 'text', payload: { prompt: 'other' } } }, w.deps);
    ok(r4.execution_id !== r1.execution_id, 'TEST 11d: different input → different id');
    eq(engine.canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), engine.canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }),
      'TEST 11e: canonical json is key-order independent');
    const src = fs.readFileSync(path.join(__dirname, '..', 'execution', 'lookup.js'), 'utf8');
    ok(!/Math\.random|Date\.now|performance\.now|crypto\.random|new Date\(/.test(src), 'TEST 11f: engine has no time/random sources');
  }

  // ── TEST 12: authorization gate (10.12)
  {
    const w = world();
    const r1 = await engine.execute({ selected_route: selected(A), input: INPUT }, w.deps);
    eq(r1.reason, 'authorization_missing', 'TEST 12: no authorization → blocked (selected ≠ approved)');
    const r2 = await engine.execute({ selected_route: selected(A), authorization: { status: 'pending_gate' }, input: INPUT }, w.deps);
    eq(r2.reason, 'authorization_not_approved', 'TEST 12b: pending_gate → blocked');
    const r3 = await engine.execute({ selected_route: selected(A), authorization: { status: 'denied' }, input: INPUT }, w.deps);
    eq(r3.status, 'blocked', 'TEST 12c: denied → blocked');
    eq(w.calls.transport.length, 0, 'TEST 12d: no provider call without approval');
    eq(w.calls.resolver, 0, 'TEST 12e: no credential resolution without approval');
  }

  // ── TEST 13: no modification of Router / Fallback
  {
    eq(sha('router/lookup.js'), ROUTER_SHA_BEFORE, 'TEST 13: router/lookup.js unchanged on disk');
    eq(sha('fallback/lookup.js'), FALLBACK_SHA_BEFORE, 'TEST 13b: fallback/lookup.js unchanged on disk');
    eq(JSON.stringify(router.registry), ROUTER_REG_BEFORE, 'TEST 13c: router registry not mutated');
    eq(JSON.stringify(fallback.registry), FALLBACK_REG_BEFORE, 'TEST 13d: fallback registry not mutated');
    eq(JSON.stringify(accountReg), ACCOUNT_REG_BEFORE, 'TEST 13e: accounts registry not mutated');
    eq(JSON.stringify(modelReg), MODEL_REG_BEFORE, 'TEST 13f: models registry not mutated');
    eq(JSON.stringify(quotaReg), QUOTA_REG_BEFORE, 'TEST 13g: quota registry not mutated');
    const src = fs.readFileSync(path.join(__dirname, '..', 'execution', 'lookup.js'), 'utf8');
    ok(/require\('\.\.\/fallback\/lookup\.js'\)/.test(src) && /candidateSelectable/.test(src),
      'TEST 13h: engine consumes 10.7 candidateSelectable (no reimplementation)');
    ok(!/collectCandidates|compareCandidates|applyPreferences|preferred_/.test(src),
      'TEST 13i: engine has no candidate enumeration/preference logic (no routing)');
  }

  // ── TEST 14: no exposición de secretos
  {
    const w = world();
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    const dump = JSON.stringify(r) + JSON.stringify(w.calls.events);
    ok(dump.indexOf(FAKE_SECRET) === -1, 'TEST 14: result/events never contain the secret');
    ok(!SECRET_VALUE_RE.test(dump), 'TEST 14b: no secret-shaped values in result/events');
    ok(!('secret' in r) && !('credential' in r) && !('credential_ref' in r), 'TEST 14c: no credential keys in result');
    ok(w.calls.transport[0].opts.headers.Authorization.indexOf(FAKE_SECRET) > 0,
      'TEST 14d: secret only reaches transport headers (mock)');
    eq(engine.sanitizeMessage('bad Bearer abc.def key=' + FAKE_SECRET).indexOf(FAKE_SECRET), -1, 'TEST 14e: sanitizeMessage redacts');
    for (const f of ['execution/lookup.js', 'execution/credentials.js', 'execution/adapters/openrouter.js', 'execution/contract.md', 'execution/registry.json']) {
      const txt = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      ok(!SECRET_VALUE_RE.test(txt), `TEST 14f: ${f} contains no secret material`);
      ok(!/process\.env/.test(txt), `TEST 14g: ${f} does not read env vars`);
    }
    ok(JSON.stringify(accountReg).indexOf('sk-') === -1, 'TEST 14h: accounts registry holds credential_ref only');
  }

  // ── TEST 15: no account hopping
  {
    // B has capacity, A exhausted. Engine must block, never switch to B.
    const w = world({ quota: { [A.account_id + '|' + A.model_id]: 'exhausted', [B.account_id + '|' + B.model_id]: 'available' } });
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 15: exhausted route → blocked, not rerouted');
    eq(r.route.account_id, A.account_id, 'TEST 15b: route account unchanged');
    ok(!w.calls.accountsQueried.has(B.account_id), 'TEST 15c: alternative account never consulted');
    eq(w.calls.transport.length, 0, 'TEST 15d: no provider call');
    eq(w.calls.resolveRoute, 0, 'TEST 15e: engine did not call 10.7 to find an alternative');
    // Provider 429 must not trigger a switch either.
    const w2 = world({ transportResponse: { status: 429, json: {} } });
    const r2 = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w2.deps);
    eq(r2.status, 'failed', 'TEST 15f: rate limit → failed');
    eq(w2.calls.transport.length, 1, 'TEST 15g: no rotation/retry after rate limit');
    ok(!w2.calls.accountsQueried.has(B.account_id), 'TEST 15h: no account hopping after rate limit');
  }

  // ── TEST 16: no bypass de quota/capacity (unknown ≠ available)
  {
    const w = world({ quota: { [A.account_id + '|' + A.model_id]: 'unknown' } });
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.status, 'blocked', 'TEST 16: unknown quota → blocked');
    eq(r.reason, 'insufficient_evidence', 'TEST 16b: reason insufficient_evidence (10.8 vocabulary)');
    eq(w.calls.transport.length, 0, 'TEST 16c: no provider call');
    // Real seed world: 10.5 says unknown → 10.6/10.7/10.8 all refuse.
    const real = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT },
      { transport: async () => { throw new Error('must not be called'); } });
    eq(real.status, 'blocked', 'TEST 16d: real registries (quota unknown) → blocked');
    eq(real.reason, 'insufficient_evidence', 'TEST 16e: real seed blocked for insufficient evidence');
    const viaRouter = await engine.execute({ capability: CAP, authorization: APPROVED, input: INPUT },
      { transport: async () => { throw new Error('must not be called'); } });
    eq(viaRouter.reason, 'no_route', 'TEST 16f: real 10.7 resolve → no_route → blocked');
    eq(router.route({ capability: CAP }).status, 'no_route', 'TEST 16g: 10.6 still returns no_route on seed');
  }

  // ── TEST 17: default deps / LIVE guard
  {
    const w = world();
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT },
      { ...w.deps, credentialResolver: undefined });
    eq(r.error.code, 'credential_unavailable', 'TEST 17: default resolver is the null resolver (pending, not invented)');
    eq(engine.CREDENTIAL_RESOLVER_NOTE, 'CREDENTIAL RESOLVER NOT IMPLEMENTED', 'TEST 17b: pending note exported');
    ok(credentials.isCredentialRef('secret://openrouter/acct_openrouter_primary'), 'TEST 17c: 10.4 ref scheme accepted');
    ok(!credentials.isCredentialRef('sk-abcdefghijkl'), 'TEST 17d: raw secret rejected as ref');
  }

  // ── TEST 18: adapter abstraction (10.13)
  {
    const d = openrouter.descriptor;
    ok(d.adapter_id && d.provider_id === 'openrouter' && d.interface_type && Array.isArray(d.operations),
      'TEST 18: adapter declares id/provider/interface/operations');
    eq(execReg.adapters[0].adapter_id, d.adapter_id, 'TEST 18b: registry lists the adapter');
    ok(Object.isFrozen(engine.ADAPTERS), 'TEST 18c: adapter table frozen');
    const src = fs.readFileSync(path.join(__dirname, '..', 'execution', 'lookup.js'), 'utf8');
    ok(!/openrouter\.ai|chat\/completions/.test(src), 'TEST 18d: core has no provider-specific protocol');
    const w = world({ models: { m2: { model_id: 'm2', provider_id: 'openrouter', status: 'available' } }, supports: { ['m2|image_generation']: true }, quota: { [A.account_id + '|m2']: 'available' } });
    const r = await engine.execute({ selected_route: { ...selected({ ...A, model_id: 'm2' }), capability: 'image_generation' }, authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.reason, 'adapter_unavailable', 'TEST 18e: capability outside adapter operations → adapter_unavailable');
  }

  // ── TEST 19: no memory writers / no telemetry persistence
  {
    const files = ['execution/lookup.js', 'execution/credentials.js', 'execution/adapters/openrouter.js'];
    for (const f of files) {
      const txt = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      ok(!/supabase|notion\.|notion-|api\.notion|writeFile|appendFile|localStorage|require\('fs'\)|from\('.*supabase/i.test(txt),
        `TEST 19: ${f} has no memory/persistence writer`);
      ok(!/console\.(log|info|warn|error)/.test(txt), `TEST 19b: ${f} does not log`);
    }
    const w = world();
    const r = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w.deps);
    eq(r.metadata.canonical_write, false, 'TEST 19c: canonical_write false');
    eq(r.metadata.memory_authority, 'none', 'TEST 19d: memory_authority none');
    const names = w.calls.events.map(e => e.event);
    eq(names.join(','), 'execution.started,execution.completed', 'TEST 19e: hook emits started/completed only');
    ok(w.calls.events.every(e => !('timestamp' in e) && !('secret' in e)), 'TEST 19f: events carry no timestamps/secrets');
    const w2 = world(); w2.deps.onEvent = () => { throw new Error('observer down'); };
    const r2 = await engine.execute({ selected_route: selected(A), authorization: APPROVED, input: INPUT }, w2.deps);
    eq(r2.status, 'succeeded', 'TEST 19g: observability failure never affects execution');
  }

  // ── TEST 20: version & contract
  {
    const version = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8');
    ok(/^aria-execution-engine-v1\.1\.0/m.test(version), 'TEST 20: VERSION is aria-execution-engine-v1.1.0');
    eq(engine.version, 'aria-execution-engine-v1.1.0', 'TEST 20b: engine version matches');
    const contract = fs.readFileSync(path.join(__dirname, '..', 'execution', 'contract.md'), 'utf8');
    for (const s of ['succeeded', 'failed', 'blocked', 'cancelled', 'insufficient_evidence', 'CREDENTIAL RESOLVER NOT IMPLEMENTED', 'CAPTURE → GATE → COMMIT → SYNC']) {
      ok(contract.indexOf(s) !== -1, `TEST 20c: contract documents \"${s}\"`);
    }
    for (const s of ['succeeded', 'failed', 'blocked']) ok(execReg.emitted_status.indexOf(s) !== -1, `TEST 20d: registry emits ${s}`);
    ok(execReg.canonical_status.indexOf('cancelled') !== -1 && execReg.emitted_status.indexOf('cancelled') === -1,
      'TEST 20e: cancelled reserved (10.13) but not emitted');
  }

  console.log(`\nMission 10.8 Execution Engine: ${passed} assertions passed (MOCK mode, 0 live calls)`);
}

main().catch(e => { console.error('FAIL:', e && e.message); process.exit(1); });
