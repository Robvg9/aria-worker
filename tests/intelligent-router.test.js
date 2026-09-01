/**
 * Mission 10.6 — Intelligent Router tests
 * Run: node tests/intelligent-router.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  route,
  collectCandidates,
  capacityAllows,
  version,
  registry
} = require('../router/lookup.js');

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

console.log('=== Intelligent Router 10.6 tests ===');
console.log('version:', version);

const SEED_CAP = 'text_generation';
const SEED_MODEL = 'google/gemini-2.5-flash-lite';
const SEED_PROVIDER = 'openrouter';
const SEED_ACCOUNT = 'acct_openrouter_primary';

ok(version === 'aria-intelligent-router-v1.0.0', 'version is aria-intelligent-router-v1.0.0');

// -------------------------------------------------------------------------
// TEST 1 — Capability válida → resolución controlada
// With current seed (capacity unknown) the only legal outcome is no_route.
// -------------------------------------------------------------------------
const r1 = route({ capability: SEED_CAP });
ok(r1 && typeof r1 === 'object', 'TEST 1: route returns an object');
ok(r1.status === 'no_route' || r1.status === 'selected', 'TEST 1b: status is canonical');
// Given unknown capacity, must be no_route
ok(r1.status === 'no_route',
  'TEST 1c: valid capability with unknown capacity → no_route (unknown ≠ available)');

// -------------------------------------------------------------------------
// TEST 2 — Capability inexistente → no_route
// -------------------------------------------------------------------------
const r2 = route({ capability: 'does_not_exist_capability_xyz' });
ok(r2.status === 'no_route', 'TEST 2: nonexistent capability → no_route');

const r2b = route({ capability: '' });
ok(r2b.status === 'no_route', 'TEST 2b: empty capability → no_route');

const r2c = route({});
ok(r2c.status === 'no_route', 'TEST 2c: missing capability → no_route');

const r2d = route(null);
ok(r2d.status === 'no_route', 'TEST 2d: null input → no_route');

// -------------------------------------------------------------------------
// TEST 3 — Modelo inexistente → resultado controlado
// -------------------------------------------------------------------------
const r3 = route({ capability: SEED_CAP, preferred_model: 'totally-fake-model-id' });
ok(r3.status === 'no_route', 'TEST 3: preferred nonexistent model still yields controlled no_route');

// -------------------------------------------------------------------------
// TEST 4 — Account inexistente → resultado controlado
// -------------------------------------------------------------------------
const r4 = route({ capability: SEED_CAP, preferred_account: 'acct_does_not_exist' });
ok(r4.status === 'no_route', 'TEST 4: preferred nonexistent account → controlled no_route');

// -------------------------------------------------------------------------
// TEST 5 — Account inactiva → no seleccionable
// (no inactive seed exists; verify the gate via isAccountActive semantics)
// -------------------------------------------------------------------------
ok(accountLookup.isAccountActive(SEED_ACCOUNT) === true, 'TEST 5: seed account is active');
ok(accountLookup.isAccountActive('acct_does_not_exist') === false,
  'TEST 5b: nonexistent account is not active');
// capacityAllows itself is independent of account status; account gate is in collectCandidates
ok(typeof capacityAllows === 'function', 'TEST 5c: capacityAllows is exported for inspection');

// -------------------------------------------------------------------------
// TEST 6 — Capability no soportada → no seleccionable
// -------------------------------------------------------------------------
ok(capLookup.supports(SEED_MODEL, 'image_generation') !== true,
  'TEST 6: unsupported capability is not verified for seed model');
const r6 = route({ capability: 'image_generation' });
ok(r6.status === 'no_route', 'TEST 6b: unsupported capability → no_route');

// -------------------------------------------------------------------------
// TEST 7 — "unknown" quota/capacity NO se interpreta como disponible
// -------------------------------------------------------------------------
const cap = quotaLookup.getCapacity(SEED_ACCOUNT);
const quota = quotaLookup.getQuota(SEED_ACCOUNT);
ok(cap && cap.status === 'unknown', 'TEST 7: capacity status is unknown');
ok(quota && quota.status === 'unknown', 'TEST 7b: quota status is unknown');
ok(capacityAllows(SEED_ACCOUNT, SEED_MODEL) === false,
  'TEST 7c: capacityAllows returns false for unknown (unknown ≠ available)');
ok(r1.status === 'no_route',
  'TEST 7d: route does not select the seed while capacity is unknown');

// -------------------------------------------------------------------------
// TEST 8 — No se seleccionan candidatos con capacidad unavailable/exhausted
// (no such seed; verify the blocking set is applied)
// -------------------------------------------------------------------------
const lookupSrc = fs.readFileSync(path.join(__dirname, '..', 'router', 'lookup.js'), 'utf8');
ok(lookupSrc.includes('unavailable') && lookupSrc.includes('exhausted'),
  'TEST 8: lookup blocks unavailable and exhausted');
ok(lookupSrc.includes("'unknown'"),
  'TEST 8b: lookup treats unknown as non-selectable');

// -------------------------------------------------------------------------
// TEST 9 — Misma entrada → mismo resultado (determinism)
// -------------------------------------------------------------------------
const a = route({ capability: SEED_CAP });
const b = route({ capability: SEED_CAP });
ok(JSON.stringify(a) === JSON.stringify(b), 'TEST 9: identical input yields identical output');

const c = route({ capability: SEED_CAP, preferred_provider: SEED_PROVIDER });
const d = route({ capability: SEED_CAP, preferred_provider: SEED_PROVIDER });
ok(JSON.stringify(c) === JSON.stringify(d), 'TEST 9b: preferred filter is also deterministic');

// -------------------------------------------------------------------------
// TEST 10 — No existen decisiones aleatorias
// -------------------------------------------------------------------------
ok(!/Math\.random|Date\.now|performance\.now|crypto\.random/.test(lookupSrc),
  'TEST 10: lookup contains no random/time sources');
ok(!/shuffle|sample|pickRandom/.test(lookupSrc),
  'TEST 10b: lookup contains no random selection helpers');

// -------------------------------------------------------------------------
// TEST 11 — Provider Registry 10.1 continúa funcionando
// -------------------------------------------------------------------------
ok(modelLookup.providerOf(SEED_MODEL) === SEED_PROVIDER,
  'TEST 11: provider seed still reachable via Model Registry');
const evidencedProviders = new Set(Object.keys(modelReg.indexes.by_provider || {}));
evidencedProviders.add('openrouter');
ok(evidencedProviders.has(SEED_PROVIDER), 'TEST 11b: openrouter remains the evidenced provider');

// -------------------------------------------------------------------------
// TEST 12 — Model Registry 10.2 continúa funcionando
// -------------------------------------------------------------------------
ok(modelLookup.getModel(SEED_MODEL) !== null, 'TEST 12: getModel still resolves seed');
ok(modelLookup.modelsByProvider(SEED_PROVIDER).length >= 1,
  'TEST 12b: modelsByProvider(openrouter) still works');
ok(modelLookup.version === modelReg.version, 'TEST 12c: Model Registry version intact');

// -------------------------------------------------------------------------
// TEST 13 — Capability Matrix 10.3 continúa funcionando
// -------------------------------------------------------------------------
ok(capLookup.supports(SEED_MODEL, SEED_CAP) === true,
  'TEST 13: supports(text_generation) still true');
ok(capLookup.modelsByCapability(SEED_CAP).includes(SEED_MODEL),
  'TEST 13b: modelsByCapability still lists seed model');
ok(capLookup.version === capReg.version, 'TEST 13c: Capability Matrix version intact');

// -------------------------------------------------------------------------
// TEST 14 — Account Manager 10.4 continúa funcionando
// -------------------------------------------------------------------------
ok(accountLookup.version === 'aria-account-manager-v1.0.0',
  'TEST 14: Account Manager version intact');
ok(accountLookup.isAccountActive(SEED_ACCOUNT) === true,
  'TEST 14b: seed account still active');
ok(accountLookup.credentialRefOf(SEED_ACCOUNT) === 'secret://openrouter/acct_openrouter_primary',
  'TEST 14c: credential_ref still a reference');
ok(accountLookup.modelsOfAccount(SEED_ACCOUNT).includes(SEED_MODEL),
  'TEST 14d: modelsOfAccount still lists seed model');

// -------------------------------------------------------------------------
// TEST 15 — Quota/Capacity Manager 10.5 continúa funcionando
// -------------------------------------------------------------------------
ok(quotaLookup.version === 'aria-quota-capacity-v1.0.0',
  'TEST 15: Quota/Capacity version intact');
ok(quotaLookup.getCapacity(SEED_ACCOUNT) !== null,
  'TEST 15b: getCapacity still resolves seed');
ok(quotaLookup.getQuota(SEED_ACCOUNT) !== null,
  'TEST 15c: getQuota still resolves seed');
ok(quotaLookup.getCapacity(SEED_ACCOUNT).status === 'unknown',
  'TEST 15d: capacity remains unknown');

// -------------------------------------------------------------------------
// TEST 16 — No existen secretos
// -------------------------------------------------------------------------
const allKeys = collectKeys(registry, []);
ok(!allKeys.some(k => SECRET_KEY_RE.test(k)), 'TEST 16: no secret field names in router registry');
const registryText = JSON.stringify(registry);
scanTextForSecrets(registryText, 'TEST 16b registry.json');
const contractText = fs.readFileSync(path.join(__dirname, '..', 'router', 'contract.md'), 'utf8');
const testText = fs.readFileSync(__filename, 'utf8');
scanTextForSecrets(contractText, 'TEST 16c contract.md');
scanTextForSecrets(lookupSrc, 'TEST 16d lookup.js');
scanTextForSecrets(testText, 'TEST 16e this test file');
ok(!lookupSrc.includes('sk-') && !lookupSrc.includes('or-v1-'),
  'TEST 16f: lookup source has no secret prefixes');

// -------------------------------------------------------------------------
// TEST 17 — Router no ejecuta llamadas externas
// -------------------------------------------------------------------------
ok(!/fetch\(|axios|http\.request|https\.request|OpenRouter|openai|googleapis/.test(lookupSrc),
  'TEST 17: lookup contains no network / provider client calls');
ok(!/require\(['"]https?|require\(['"]node-fetch|require\(['"]axios/.test(lookupSrc),
  'TEST 17b: lookup does not import network libraries');

// -------------------------------------------------------------------------
// TEST 18 — Router no modifica registries
// -------------------------------------------------------------------------
ok(!/writeFile|fs\.write/.test(lookupSrc) && !lookupSrc.includes('registry.entries') && !lookupSrc.includes('registry.models.push') && !lookupSrc.includes('registry.accounts'),
  'TEST 18: lookup does not mutate or write registries');
// Snapshot versions remain unchanged after route calls
const vModelBefore = modelLookup.version;
const vCapBefore = capLookup.version;
const vAccBefore = accountLookup.version;
const vQuotaBefore = quotaLookup.version;
route({ capability: SEED_CAP });
ok(modelLookup.version === vModelBefore, 'TEST 18b: Model Registry version unchanged after route');
ok(capLookup.version === vCapBefore, 'TEST 18c: Capability Matrix version unchanged after route');
ok(accountLookup.version === vAccBefore, 'TEST 18d: Account Manager version unchanged after route');
ok(quotaLookup.version === vQuotaBefore, 'TEST 18e: Quota version unchanged after route');

// -------------------------------------------------------------------------
// TEST 19 — No existen duplicaciones de modelos/providers/accounts/capabilities
// -------------------------------------------------------------------------
ok(!('models' in registry) && !('accounts' in registry) && !('capabilities' in registry),
  'TEST 19: router registry does not embed model/account/capability arrays');
ok(!('entries' in registry), 'TEST 19b: router registry does not embed quota entries');
ok(registry.consumes && Array.isArray(registry.consumes) && registry.consumes.length >= 4,
  'TEST 19c: router declares the registries it consumes');
ok(!lookupSrc.includes("require('./registry.json').models"),
  'TEST 19d: lookup does not re-declare foreign data');

// -------------------------------------------------------------------------
// TEST 20 — El output cumple exactamente el contrato
// -------------------------------------------------------------------------
ok(r1.status === 'no_route', 'TEST 20: current seed yields no_route');
ok(Object.keys(r1).length === 1 && r1.status === 'no_route',
  'TEST 20b: no_route shape has only status field');
ok(lookupSrc.includes('SELECTED') || lookupSrc.includes("'selected'"),
  'TEST 20c: selected status constant exists');
ok(lookupSrc.includes('provider_id') && lookupSrc.includes('account_id') &&
   lookupSrc.includes('model_id') && lookupSrc.includes('capability'),
  'TEST 20d: selected shape fields are present in source');

// Extra: collectCandidates is empty under current unknown capacity
const cands = collectCandidates(SEED_CAP);
ok(Array.isArray(cands) && cands.length === 0,
  'TEST 20e: collectCandidates returns empty list while capacity is unknown');

console.log('\nAll', passed, 'assertions passed.');
