/**
 * Mission 10.7 — Fallback Engine tests
 * Run: node tests/fallback.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolve,
  candidateKey,
  candidateSelectable,
  activationAllows,
  POLICY_NOTE,
  version,
  registry
} = require('../fallback/lookup.js');

const router = require('../router/lookup.js');
const modelLookup = require('../models/lookup.js');
const modelReg = require('../models/registry.json');
const capLookup = require('../capabilities/lookup.js');
const capReg = require('../capabilities/registry.json');
const accountLookup = require('../accounts/lookup.js');
const accountReg = require('../accounts/registry.json');
const quotaLookup = require('../quota/lookup.js');
const quotaReg = require('../quota/registry.json');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log('PASS:', msg);
}

const SECRET_KEY_RE = /^(api[_-]?key|secret|token|password|private[_-]?key|access[_-]?token|refresh[_-]?token)$/i;
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9_-]{8,}|or-v1-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-]+)\b/;

function collectKeys(obj, acc) {
  if (!obj || typeof obj !== 'object') return acc;
  for (const [k, v] of Object.entries(obj)) {
    acc.push(k);
    if (v && typeof v === 'object') collectKeys(v, acc);
  }
  return acc;
}

function scanTextForSecrets(text, label) {
  ok(!SECRET_VALUE_RE.test(text), `${label}: no secret material in text`);
}

const CAP = 'text_generation';
const SEED_MODEL = 'google/gemini-2.5-flash-lite';
const SEED_PROVIDER = 'openrouter';
const SEED_ACCOUNT = 'acct_openrouter_primary';

const A = {
  provider_id: 'openrouter',
  account_id: 'acct_openrouter_primary',
  model_id: 'google/gemini-2.5-flash-lite'
};
const B = {
  provider_id: 'provider_b',
  account_id: 'acct_b',
  model_id: 'model_b'
};
const C = {
  provider_id: 'provider_c',
  account_id: 'acct_c',
  model_id: 'model_c'
};

function selected(c) {
  return {
    status: 'selected',
    provider_id: c.provider_id,
    account_id: c.account_id,
    model_id: c.model_id,
    capability: CAP
  };
}

/**
 * In-memory world for 10.7 selection tests.
 * Does not mutate the real 10.2–10.6 registries.
 */
function worldDeps(overrides) {
  const accounts = {
    [A.account_id]: {
      status: 'active',
      credential_ref: 'secret://openrouter/acct_openrouter_primary',
      provider_id: A.provider_id
    },
    [B.account_id]: {
      status: 'active',
      credential_ref: 'secret://provider_b/acct_b',
      provider_id: B.provider_id
    },
    [C.account_id]: {
      status: 'active',
      credential_ref: 'secret://provider_c/acct_c',
      provider_id: C.provider_id
    }
  };
  const models = {
    [A.model_id]: { model_id: A.model_id, provider_id: A.provider_id, status: 'available' },
    [B.model_id]: { model_id: B.model_id, provider_id: B.provider_id, status: 'available' },
    [C.model_id]: { model_id: C.model_id, provider_id: C.provider_id, status: 'available' }
  };
  const supportsMap = {
    [A.model_id + '|' + CAP]: true,
    [B.model_id + '|' + CAP]: true,
    [C.model_id + '|' + CAP]: true
  };
  const quota = {
    [A.account_id + '|' + A.model_id]: { capacity: 'available', quota: 'available', rate_limit: 'available' },
    [B.account_id + '|' + B.model_id]: { capacity: 'available', quota: 'available', rate_limit: 'available' },
    [C.account_id + '|' + C.model_id]: { capacity: 'available', quota: 'available', rate_limit: 'available' }
  };
  const candidates = [A, B, C];

  const cfg = Object.assign(
    { accounts, models, supportsMap, quota, candidates },
    overrides || {}
  );

  function capacityAllows(accountId, modelId) {
    const q = cfg.quota[accountId + '|' + modelId];
    if (!q) return false;
    if (q.capacity === 'unknown' || q.quota === 'unknown' || q.rate_limit === 'unknown') return false;
    if (q.capacity === 'unavailable' || q.capacity === 'exhausted') return false;
    if (q.quota === 'unavailable' || q.quota === 'exhausted') return false;
    if (q.rate_limit === 'unavailable' || q.rate_limit === 'exhausted') return false;
    return q.capacity === 'available' && q.quota === 'available';
  }

  return {
    route: () => selected(A),
    collectCandidates: () => cfg.candidates.slice(),
    capacityAllows,
    isAccountActive: (id) => !!(cfg.accounts[id] && cfg.accounts[id].status === 'active'),
    supports: (modelId, cap) => cfg.supportsMap[modelId + '|' + cap] === true,
    getModel: (id) => cfg.models[id] || null,
    credentialRefOf: (id) => (cfg.accounts[id] && cfg.accounts[id].credential_ref) || null
  };
}

console.log('=== Fallback Engine 10.7 tests ===');
console.log('version:', version);

ok(version === 'aria-fallback-v1.0.0', 'version is aria-fallback-v1.0.0');
ok(POLICY_NOTE === 'POLICY INPUT NOT IMPLEMENTED', 'policy note is the documented placeholder');
ok(registry.policy_note === 'POLICY INPUT NOT IMPLEMENTED', 'registry documents POLICY INPUT NOT IMPLEMENTED');

// -------------------------------------------------------------------------
// TEST 1 — Primary válido → no fallback
// -------------------------------------------------------------------------
const t1 = resolve({ router_result: selected(A) }, worldDeps());
ok(t1.status === 'primary', 'TEST 1: valid primary → primary');
ok(t1.provider_id === A.provider_id && t1.account_id === A.account_id && t1.model_id === A.model_id,
  'TEST 1b: primary fields match the 10.6 route');
ok(t1.capability === CAP, 'TEST 1c: capability preserved');
ok(Object.keys(t1).sort().join(',') === 'account_id,capability,model_id,provider_id,status',
  'TEST 1d: primary wire shape matches contract');

// Caso A — Primary disponible
ok(t1.status !== 'fallback', 'Caso A: available primary does not emit fallback');

// -------------------------------------------------------------------------
// TEST 2 — Primary unavailable → fallback válido
// -------------------------------------------------------------------------
const t2 = resolve(
  { router_result: selected(A), failure: { kind: 'account_unavailable' } },
  worldDeps()
);
ok(t2.status === 'fallback', 'TEST 2: unavailable primary → fallback');
ok(t2.account_id !== A.account_id, 'TEST 2b: fallback is not the failed account');
ok(t2.account_id === B.account_id, 'TEST 2c: next candidate is lexical first remaining (acct_b)');
ok(t2.capability === CAP, 'TEST 2d: required capability conserved');

const t2p = resolve(
  { router_result: selected(A), failure: { kind: 'provider_unavailable' } },
  worldDeps()
);
ok(t2p.status === 'fallback' && t2p.provider_id !== A.provider_id,
  'TEST 2e: provider_unavailable excludes the same provider');

// Caso B — Primary bloqueado
ok(t2.status === 'fallback', 'Caso B: blocked primary → fallback');

// -------------------------------------------------------------------------
// TEST 3 — Primary exhausted → fallback válido
// -------------------------------------------------------------------------
const t3 = resolve(
  { router_result: selected(A), failure: { kind: 'quota_exhausted' } },
  worldDeps()
);
ok(t3.status === 'fallback', 'TEST 3: quota exhausted → fallback');
ok(t3.account_id !== A.account_id,
  'TEST 3b: exhausted account is not reused (no quota evasion)');

const t3c = resolve(
  { router_result: selected(A), failure: { kind: 'capacity_unavailable' } },
  worldDeps()
);
ok(t3c.status === 'fallback' && t3c.model_id === B.model_id,
  'TEST 3c: capacity_unavailable → next candidate');

// -------------------------------------------------------------------------
// TEST 4 — Primary rate-limited → fallback válido cuando esté permitido
// -------------------------------------------------------------------------
const t4deny = resolve(
  { router_result: selected(A), failure: { kind: 'rate_limit' } },
  worldDeps()
);
ok(t4deny.status === 'no_fallback',
  'TEST 4: rate_limit without explicit permit → no_fallback (do not evade)');

const t4allow = resolve(
  {
    router_result: selected(A),
    failure: { kind: 'rate_limit' },
    policy: { allow_rate_limit_fallback: true }
  },
  worldDeps()
);
ok(t4allow.status === 'fallback' && t4allow.account_id !== A.account_id,
  'TEST 4b: rate_limit with explicit permit → other account');

ok(activationAllows('rate_limit', null) === false,
  'TEST 4c: activationAllows(rate_limit) is false by default');
ok(activationAllows('rate_limit', { allow_rate_limit_fallback: true }) === true,
  'TEST 4d: activationAllows(rate_limit) true only when permitted');

// -------------------------------------------------------------------------
// TEST 5 — Fallback inexistente → no_fallback
// -------------------------------------------------------------------------
const t5 = resolve(
  { router_result: selected(A), failure: { kind: 'execution_failure' } },
  worldDeps({ candidates: [A] })
);
ok(t5.status === 'no_fallback', 'TEST 5: no alternative → no_fallback');

const t5b = resolve({ router_result: { status: 'no_route' } }, worldDeps());
ok(t5b.status === 'no_fallback', 'TEST 5b: 10.6 no_route → no_fallback (no invented route)');

const t5c = resolve(null);
ok(t5c.status === 'no_fallback', 'TEST 5c: null input → no_fallback');

const t5d = resolve({});
ok(t5d.status === 'no_fallback',
  'TEST 5d: empty input uses live route(); seed is no_route → no_fallback');

ok(Object.keys(t5).length === 1 && t5.status === 'no_fallback',
  'TEST 5e: no_fallback wire shape has only status');

// Caso C — Todo bloqueado
const t5e = resolve(
  { router_result: selected(A), failure: { kind: 'execution_failure' } },
  worldDeps({
    quota: {
      [A.account_id + '|' + A.model_id]: { capacity: 'exhausted', quota: 'exhausted', rate_limit: 'available' },
      [B.account_id + '|' + B.model_id]: { capacity: 'unavailable', quota: 'unavailable', rate_limit: 'available' },
      [C.account_id + '|' + C.model_id]: { capacity: 'unknown', quota: 'unknown', rate_limit: 'unknown' }
    }
  })
);
ok(t5e.status === 'no_fallback', 'Caso C: every alternative blocked → no_fallback');

// -------------------------------------------------------------------------
// TEST 6 — Fallback con capability incorrecta → excluir
// -------------------------------------------------------------------------
const t6 = resolve(
  { router_result: selected(A), failure: { kind: 'execution_failure' } },
  worldDeps({
    supportsMap: {
      [A.model_id + '|' + CAP]: true,
      [B.model_id + '|' + CAP]: false,
      [C.model_id + '|' + CAP]: true
    }
  })
);
ok(t6.status === 'fallback' && t6.model_id === C.model_id,
  'TEST 6: model without verified capability is excluded');

const t6b = resolve(
  { router_result: selected(A), failure: { kind: 'execution_failure' } },
  worldDeps({
    supportsMap: {
      [A.model_id + '|' + CAP]: true
    }
  })
);
ok(t6b.status === 'no_fallback',
  'TEST 6b: no remaining model supports the required capability → no_fallback');

// -------------------------------------------------------------------------
// TEST 7 — Fallback con account inactiva → excluir
// -------------------------------------------------------------------------
const t7 = resolve(
  { router_result: selected(A), failure: { kind: 'account_unavailable' } },
  worldDeps({
    accounts: {
      [A.account_id]: { status: 'inactive', credential_ref: 'secret://openrouter/acct_openrouter_primary' },
      [B.account_id]: { status: 'inactive', credential_ref: 'secret://provider_b/acct_b' },
      [C.account_id]: { status: 'active', credential_ref: 'secret://provider_c/acct_c' }
    }
  })
);
ok(t7.status === 'fallback' && t7.account_id === C.account_id,
  'TEST 7: inactive accounts are not selectable');

ok(accountLookup.isAccountActive(SEED_ACCOUNT) === true,
  'TEST 7b: live seed account remains active (10.4 gate still in force)');

// -------------------------------------------------------------------------
// TEST 8 — Fallback con capacity "unknown" → excluir
// -------------------------------------------------------------------------
const t8 = resolve(
  { router_result: selected(A), failure: { kind: 'capacity_unavailable' } },
  worldDeps({
    quota: {
      [A.account_id + '|' + A.model_id]: { capacity: 'unavailable', quota: 'available', rate_limit: 'available' },
      [B.account_id + '|' + B.model_id]: { capacity: 'unknown', quota: 'available', rate_limit: 'available' },
      [C.account_id + '|' + C.model_id]: { capacity: 'available', quota: 'available', rate_limit: 'available' }
    }
  })
);
ok(t8.status === 'fallback' && t8.account_id === C.account_id,
  'TEST 8: unknown capacity is not coerced to available');

ok(router.capacityAllows(SEED_ACCOUNT, SEED_MODEL) === false,
  'TEST 8b: live seed capacityAllows remains false (unknown ≠ available)');

// -------------------------------------------------------------------------
// TEST 9 — Fallback con quota/capacity unavailable → excluir
// -------------------------------------------------------------------------
const t9 = resolve(
  { router_result: selected(A), failure: { kind: 'quota_exhausted' } },
  worldDeps({
    quota: {
      [A.account_id + '|' + A.model_id]: { capacity: 'available', quota: 'exhausted', rate_limit: 'available' },
      [B.account_id + '|' + B.model_id]: { capacity: 'unavailable', quota: 'available', rate_limit: 'available' },
      [C.account_id + '|' + C.model_id]: { capacity: 'available', quota: 'available', rate_limit: 'available' }
    }
  })
);
ok(t9.status === 'fallback' && t9.account_id === C.account_id,
  'TEST 9: unavailable/exhausted alternatives are excluded');

// -------------------------------------------------------------------------
// TEST 10 — Fallback no autorizado → excluir
// -------------------------------------------------------------------------
const t10 = resolve(
  {
    router_result: selected(A),
    failure: { kind: 'execution_failure' },
    policy: { unauthorized: [B] }
  },
  worldDeps()
);
ok(t10.status === 'fallback' && t10.account_id === C.account_id,
  'TEST 10: unauthorized candidate is excluded');

const t10b = resolve(
  {
    router_result: selected(A),
    failure: { kind: 'execution_failure' },
    policy: { allow_fallback: false }
  },
  worldDeps()
);
ok(t10b.status === 'no_fallback',
  'TEST 10b: policy.allow_fallback false → no_fallback');

const t10c = resolve(
  { router_result: selected(A), failure: { kind: 'execution_failure' } },
  worldDeps({
    accounts: {
      [A.account_id]: { status: 'active', credential_ref: 'secret://openrouter/acct_openrouter_primary' },
      [B.account_id]: { status: 'active', credential_ref: '' },
      [C.account_id]: { status: 'active', credential_ref: 'secret://provider_c/acct_c' }
    }
  })
);
ok(t10c.status === 'fallback' && t10c.account_id === C.account_id,
  'TEST 10c: missing credential_ref is not authorized');

const t10d = resolve(
  { router_result: selected(A), failure: { kind: 'policy_rejection' } },
  worldDeps()
);
ok(t10d.status === 'fallback' && t10d.account_id === B.account_id,
  'TEST 10d: policy_rejection of primary still allows other candidates');

// Caso D — Fallback inválido
const t10e = resolve(
  {
    router_result: selected(A),
    failure: { kind: 'execution_failure' },
    policy: { unauthorized: [B, C] }
  },
  worldDeps()
);
ok(t10e.status === 'no_fallback', 'Caso D: only invalid alternatives → no_fallback');

// -------------------------------------------------------------------------
// TEST 11 — Mismo input + mismo estado → mismo resultado
// -------------------------------------------------------------------------
const deps11 = worldDeps();
const in11 = { router_result: selected(A), failure: { kind: 'execution_failure' } };
const a11 = resolve(in11, deps11);
const b11 = resolve(in11, deps11);
ok(JSON.stringify(a11) === JSON.stringify(b11), 'TEST 11: identical input yields identical output');

const a11p = resolve({ router_result: selected(A) }, deps11);
const b11p = resolve({ router_result: selected(A) }, deps11);
ok(JSON.stringify(a11p) === JSON.stringify(b11p), 'TEST 11b: primary path is also deterministic');

const liveA = resolve({ capability: CAP });
const liveB = resolve({ capability: CAP });
ok(JSON.stringify(liveA) === JSON.stringify(liveB),
  'TEST 11c: live seed resolve is deterministic');

// -------------------------------------------------------------------------
// TEST 12 — No random
// -------------------------------------------------------------------------
const lookupSrc = fs.readFileSync(path.join(__dirname, '..', 'fallback', 'lookup.js'), 'utf8');
ok(!/Math\.random|Date\.now|performance\.now|crypto\.random/.test(lookupSrc),
  'TEST 12: lookup contains no random/time sources');
ok(!/shuffle|sample|pickRandom/.test(lookupSrc),
  'TEST 12b: lookup contains no random selection helpers');

// -------------------------------------------------------------------------
// TEST 13 — No loops / ciclos
// -------------------------------------------------------------------------
const t13 = resolve(
  { router_result: selected(A), failure: { kind: 'execution_failure' } },
  worldDeps()
);
ok(t13.status === 'fallback' && candidateKey(t13) !== candidateKey(A),
  'TEST 13: first step never returns the failed primary');

const t13b = resolve(
  {
    router_result: selected(B),
    failure: { kind: 'execution_failure' },
    visited: [A]
  },
  worldDeps()
);
ok(t13b.status === 'fallback' && t13b.account_id === C.account_id,
  'TEST 13b: visited A is not re-selected (A → B → A blocked)');

const t13c = resolve(
  {
    router_result: selected(C),
    failure: { kind: 'execution_failure' },
    visited: [A, B]
  },
  worldDeps()
);
ok(t13c.status === 'no_fallback',
  'TEST 13c: chain exhausts deterministically → no_fallback');

const t13d = resolve(
  {
    router_result: selected(A),
    failure: { kind: 'execution_failure' },
    visited: [B, C]
  },
  worldDeps()
);
ok(t13d.status === 'no_fallback',
  'TEST 13d: remaining alternatives already visited → no_fallback');

const t13e1 = resolve(
  { router_result: selected(A), failure: { kind: 'execution_failure' }, visited: [A] },
  worldDeps()
);
const t13e2 = resolve(
  { router_result: selected(A), failure: { kind: 'execution_failure' }, visited: [A] },
  worldDeps()
);
ok(JSON.stringify(t13e1) === JSON.stringify(t13e2),
  'TEST 13e: loop-protected path is deterministic');

// Caso E — Ciclo potencial A → B → A
ok(t13b.account_id !== A.account_id && t13c.status === 'no_fallback',
  'Caso E: potential A→B→A terminates safely');

ok(lookupSrc.includes('visited') && lookupSrc.includes('candidateKey'),
  'TEST 13f: anti-loop uses visited candidate keys');

// -------------------------------------------------------------------------
// TEST 14 — No provider calls
// -------------------------------------------------------------------------
ok(!/fetch\(|axios|http\.request|https\.request|OpenRouter|openai|googleapis/.test(lookupSrc),
  'TEST 14: lookup contains no network / provider client calls');
ok(!/require\(['"]https?|require\(['"]node-fetch|require\(['"]axios/.test(lookupSrc),
  'TEST 14b: lookup does not import network libraries');

// -------------------------------------------------------------------------
// TEST 15 — No execution
// -------------------------------------------------------------------------
ok(!/executeModel|runInference|chat\.completions|generateContent|consumeTokens/.test(lookupSrc),
  'TEST 15: lookup does not execute models');
ok(!lookupSrc.includes('retry') || lookupSrc.includes('no retry'),
  'TEST 15b: no retry engine (declarative next-candidate only)');

// -------------------------------------------------------------------------
// TEST 16 — No registry mutation
// -------------------------------------------------------------------------
ok(!/writeFile|fs\.write/.test(lookupSrc),
  'TEST 16: lookup does not write files');
const vModelBefore = modelLookup.version;
const vCapBefore = capLookup.version;
const vAccBefore = accountLookup.version;
const vQuotaBefore = quotaLookup.version;
const vRouterBefore = router.version;
resolve({ capability: CAP });
resolve({ router_result: selected(A), failure: { kind: 'execution_failure' } }, worldDeps());
ok(modelLookup.version === vModelBefore, 'TEST 16b: Model Registry version unchanged');
ok(capLookup.version === vCapBefore, 'TEST 16c: Capability Matrix version unchanged');
ok(accountLookup.version === vAccBefore, 'TEST 16d: Account Manager version unchanged');
ok(quotaLookup.version === vQuotaBefore, 'TEST 16e: Quota version unchanged');
ok(router.version === vRouterBefore, 'TEST 16f: Router version unchanged');

const accountsBefore = JSON.stringify(accountReg.accounts);
const quotaBefore = JSON.stringify(quotaReg.entries);
const modelsBefore = JSON.stringify(modelReg.models);
resolve({ capability: CAP });
ok(JSON.stringify(accountReg.accounts) === accountsBefore, 'TEST 16g: accounts array not mutated');
ok(JSON.stringify(quotaReg.entries) === quotaBefore, 'TEST 16h: quota entries not mutated');
ok(JSON.stringify(modelReg.models) === modelsBefore, 'TEST 16i: models array not mutated');

// -------------------------------------------------------------------------
// TEST 17 — No secrets
// -------------------------------------------------------------------------
const allKeys = collectKeys(registry, []);
ok(!allKeys.some(k => SECRET_KEY_RE.test(k)), 'TEST 17: no secret field names in fallback registry');
scanTextForSecrets(JSON.stringify(registry), 'TEST 17b registry.json');
const contractText = fs.readFileSync(path.join(__dirname, '..', 'fallback', 'contract.md'), 'utf8');
const testText = fs.readFileSync(__filename, 'utf8');
scanTextForSecrets(contractText, 'TEST 17c contract.md');
scanTextForSecrets(lookupSrc, 'TEST 17d lookup.js');
scanTextForSecrets(testText, 'TEST 17e this test file');
ok(!/sk-[A-Za-z0-9_-]{8,}/.test(lookupSrc) && !/or-v1-[A-Za-z0-9_-]{8,}/.test(lookupSrc),
  'TEST 17f: lookup source has no secret values');
ok(lookupSrc.includes('secret://'),
  'TEST 17g: only credential_ref scheme secret:// is accepted');

ok(accountLookup.credentialRefOf(SEED_ACCOUNT) === 'secret://openrouter/acct_openrouter_primary',
  'TEST 17h: live credential_ref remains a reference');

// -------------------------------------------------------------------------
// TEST 18 — Capability Matrix 10.3 continúa funcionando
// -------------------------------------------------------------------------
ok(capLookup.supports(SEED_MODEL, CAP) === true,
  'TEST 18: supports(text_generation) still true');
ok(capLookup.modelsByCapability(CAP).includes(SEED_MODEL),
  'TEST 18b: modelsByCapability still lists seed model');
ok(capLookup.version === capReg.version, 'TEST 18c: Capability Matrix version intact');
ok(capLookup.version === 'aria-capability-matrix-v1.0.0',
  'TEST 18d: Capability Matrix version string unchanged');

// -------------------------------------------------------------------------
// TEST 19 — Account Manager 10.4 continúa funcionando
// -------------------------------------------------------------------------
ok(accountLookup.version === 'aria-account-manager-v1.0.0',
  'TEST 19: Account Manager version intact');
ok(accountLookup.isAccountActive(SEED_ACCOUNT) === true,
  'TEST 19b: seed account still active');
ok(accountLookup.credentialRefOf(SEED_ACCOUNT) === 'secret://openrouter/acct_openrouter_primary',
  'TEST 19c: credential_ref still a reference');
ok(accountLookup.modelsOfAccount(SEED_ACCOUNT).includes(SEED_MODEL),
  'TEST 19d: modelsOfAccount still lists seed model');

// -------------------------------------------------------------------------
// TEST 20 — Quota/Capacity Manager 10.5 continúa funcionando
// -------------------------------------------------------------------------
ok(quotaLookup.version === 'aria-quota-capacity-v1.0.0',
  'TEST 20: Quota/Capacity version intact');
ok(quotaLookup.getCapacity(SEED_ACCOUNT) !== null,
  'TEST 20b: getCapacity still resolves seed');
ok(quotaLookup.getQuota(SEED_ACCOUNT) !== null,
  'TEST 20c: getQuota still resolves seed');
ok(quotaLookup.getCapacity(SEED_ACCOUNT).status === 'unknown',
  'TEST 20d: capacity remains unknown');
ok(quotaLookup.getQuota(SEED_ACCOUNT).status === 'unknown',
  'TEST 20e: quota remains unknown');

// -------------------------------------------------------------------------
// TEST 21 — Intelligent Router 10.6 continúa funcionando
// -------------------------------------------------------------------------
ok(router.version === 'aria-intelligent-router-v1.0.0',
  'TEST 21: Intelligent Router version intact');
const r21 = router.route({ capability: CAP });
ok(r21.status === 'no_route',
  'TEST 21b: live seed still yields no_route (unknown ≠ available)');
ok(typeof router.collectCandidates === 'function',
  'TEST 21c: collectCandidates still exported');
ok(typeof router.capacityAllows === 'function',
  'TEST 21d: capacityAllows still exported');
ok(router.collectCandidates(CAP).length === 0,
  'TEST 21e: collectCandidates remains empty under unknown capacity');

// 10.1 / 10.2 still reachable via Model Registry
ok(modelLookup.providerOf(SEED_MODEL) === SEED_PROVIDER,
  'TEST 21f: Provider 10.1 seed still reachable via Model Registry');
ok(modelLookup.getModel(SEED_MODEL) !== null, 'TEST 21g: Model 10.2 still resolves seed');
ok(modelLookup.version === modelReg.version, 'TEST 21h: Model Registry version intact');

// -------------------------------------------------------------------------
// TEST 22 — No duplicación de modelos/providers/accounts
// -------------------------------------------------------------------------
ok(!('models' in registry) && !('accounts' in registry) && !('capabilities' in registry),
  'TEST 22: fallback registry does not embed model/account/capability arrays');
ok(!('entries' in registry), 'TEST 22b: fallback registry does not embed quota entries');
ok(registry.consumes && Array.isArray(registry.consumes) && registry.consumes.length >= 5,
  'TEST 22c: fallback declares the layers it consumes');
ok(registry.consumes.indexOf('router/lookup.js') !== -1,
  'TEST 22d: fallback consumes 10.6 rather than copying it');
ok(!lookupSrc.includes("require('./registry.json').models"),
  'TEST 22e: lookup does not re-declare foreign data');

// Extra contract checks
ok(registry.canonical_status.join(',') === 'primary,fallback,no_fallback',
  'TEST 22f: canonical statuses are primary / fallback / no_fallback');
ok(Array.isArray(registry.activations) && registry.activations.indexOf('rate_limit') !== -1,
  'TEST 22g: activations are declared and include rate_limit');

ok(candidateSelectable(A, CAP, worldDeps(), null) === true,
  'TEST 22h: fixture primary is selectable under world deps');
ok(candidateSelectable(A, CAP, {
  isAccountActive: accountLookup.isAccountActive,
  credentialRefOf: accountLookup.credentialRefOf,
  getModel: modelLookup.getModel,
  supports: capLookup.supports,
  capacityAllows: router.capacityAllows
}, null) === false,
  'TEST 22i: live seed primary is not selectable (unknown capacity)');

ok(activationAllows('not_a_real_kind', null) === false,
  'TEST 22j: unknown activation kind is not assumed equivalent');

ok(resolve({
  router_result: selected(A),
  failure: { kind: 'execution_failure' },
  preferred_provider: B.provider_id
}, worldDeps()).account_id === B.account_id,
  'TEST 22k: valid preference is respected');

ok(resolve({
  router_result: selected(A),
  failure: { kind: 'execution_failure' },
  preferred_account: 'acct_does_not_exist'
}, worldDeps()).account_id === B.account_id,
  'TEST 22l: invalid preference does not force a bad candidate');

ok(resolve({
  router_result: selected(A),
  failure: { kind: 'provider_unavailable' },
  preferred_provider: A.provider_id
}, worldDeps()).provider_id !== A.provider_id,
  'TEST 22m: preference cannot revive an activation-excluded provider');

console.log('\nAll', passed, 'assertions passed.');
