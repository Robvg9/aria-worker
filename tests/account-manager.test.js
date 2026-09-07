/**
 * Mission 10.4 — Account Manager tests
 * Run: node tests/account-manager.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getAccount,
  accountsForProvider,
  isAccountActive,
  isActiveStatus,
  listAccountIds,
  modelsOfAccount,
  credentialRefOf,
  version,
  registry
} = require('../accounts/lookup.js');

const modelLookup = require('../models/lookup.js');
const modelReg = require('../models/registry.json');
const capLookup = require('../capabilities/lookup.js');
const capReg = require('../capabilities/registry.json');

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log('PASS:', msg);
}

const SECRET_KEY_RE = /^(api[_-]?key|secret|token|password|private[_-]?key|access[_-]?token|refresh[_-]?token)$/i;
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9_-]{8,}|or-v1-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-]+|AIza[A-Za-z0-9_-]{20,})\b/;
const FORBIDDEN_LOGIC = ['quota', 'rate_limit', 'router', 'fallback', 'execution', 'usage'];

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

console.log('=== Account Manager 10.4 tests ===');
console.log('version:', version);

const SEED_ID = 'acct_openrouter_primary';
const SEED_PROVIDER = 'openrouter';
const SEED_MODEL = 'google/gemini-2.5-flash-lite';
const SEED_CAP = 'text_generation';
const DIRECT_ID = 'acct_google_gemini_free';
const DIRECT_PROVIDER = 'google';
const DIRECT_MODEL = 'google/gemini-3.5-flash-lite-direct';

const acct = getAccount(SEED_ID);
ok(acct !== null, 'TEST 1: getAccount returns the verified seed account');
ok(acct.account_id === SEED_ID, 'TEST 1b: account_id is acct_openrouter_primary');
ok(acct.provider_id === SEED_PROVIDER, 'TEST 1c: provider_id is openrouter');
ok(typeof acct.credential_ref === 'string' && acct.credential_ref.startsWith(`secret://${SEED_PROVIDER}/`), 'TEST 1d: credential_ref is a canonical secret reference, not a secret');
ok(acct.status === 'active', 'TEST 1e: seed status is active');
ok(credentialRefOf(SEED_ID) === acct.credential_ref, 'TEST 1f: credentialRefOf matches record');

const direct = getAccount(DIRECT_ID);
ok(direct !== null, 'TEST 1g: direct Gemini account is registered');
ok(direct.provider_id === DIRECT_PROVIDER, 'TEST 1h: direct Gemini account provider is google');
ok(direct.status === 'active', 'TEST 1i: direct Gemini account is active');
ok(direct.credential_ref === 'env://GOOGLE_API_KEY', 'TEST 1j: direct Gemini credential uses environment reference');
ok(direct.model_refs.includes(DIRECT_MODEL), 'TEST 1k: direct Gemini account references the live direct model');
ok(direct.metadata && direct.metadata.billing_tier === 'free', 'TEST 1l: direct Gemini account remains Free Tier');

ok(getAccount('does-not-exist') === null, 'TEST 2: nonexistent account returns null');
ok(getAccount('') === null, 'TEST 2b: empty account_id returns null');
ok(getAccount(null) === null, 'TEST 2c: null account_id returns null');
ok(isAccountActive('does-not-exist') === false, 'TEST 2d: missing account is not active');
ok(modelsOfAccount('does-not-exist').length === 0, 'TEST 2e: modelsOfAccount missing → []');
ok(credentialRefOf('missing') === null, 'TEST 2f: credentialRefOf missing → null');

const byProv = accountsForProvider(SEED_PROVIDER);
ok(Array.isArray(byProv) && byProv.length >= 1, 'TEST 3: accountsForProvider(openrouter) returns list');
ok(byProv.some(a => a.account_id === SEED_ID), 'TEST 3b: seed account listed for openrouter');
const byGoogle = accountsForProvider(DIRECT_PROVIDER);
ok(Array.isArray(byGoogle) && byGoogle.some(a => a.account_id === DIRECT_ID), 'TEST 3c: direct Gemini account listed for google');

ok(accountsForProvider('nonexistent-provider').length === 0, 'TEST 4: unknown provider returns empty list');
ok(accountsForProvider('').length === 0, 'TEST 4b: empty provider returns empty list');
ok(accountsForProvider(null).length === 0, 'TEST 4c: null provider returns empty list');

ok(isAccountActive(SEED_ID) === true, 'TEST 5: seed account is active');
ok(isActiveStatus(acct) === true, 'TEST 5b: isActiveStatus(seed) is true');
ok(isAccountActive(DIRECT_ID) === true, 'TEST 5c: direct Gemini account is active');

ok(isActiveStatus({ status: 'inactive' }) === false, 'TEST 6: inactive status identified');
ok(isActiveStatus({ status: 'revoked' }) === false, 'TEST 6b: revoked is not active');
ok(isActiveStatus({ status: 'unknown' }) === false, 'TEST 6c: unknown is not active');
ok(isActiveStatus(null) === false, 'TEST 6d: missing record is not active');
ok(isAccountActive('acct_openrouter_inactive_not_seeded') === false, 'TEST 6e: unseeded inactive id is not active');

const allKeys = collectKeys(registry, []);
ok(!allKeys.some(k => SECRET_KEY_RE.test(k)), 'TEST 7: no secret field names in registry');
scanTextForSecrets(JSON.stringify(registry), 'TEST 7b registry.json');
ok(!('api_key' in acct) && !('secret' in acct) && !('token' in (acct.metadata || {})), 'TEST 7c: no secrets on account record');
ok(typeof acct.credential_ref === 'string' && acct.credential_ref.startsWith('secret://'), 'TEST 7d: credential_ref uses reference scheme');
ok(!acct.credential_ref.includes('sk-'), 'TEST 7e: credential_ref does not embed a key');
ok(!('api_key' in direct) && !('secret' in direct) && !('token' in (direct.metadata || {})), 'TEST 7f: direct account contains no secret value');
ok(!/AIza[A-Za-z0-9_-]{20,}/.test(JSON.stringify(direct)), 'TEST 7g: direct account does not embed Google key material');

const contractText = fs.readFileSync(path.join(__dirname, '..', 'accounts', 'contract.md'), 'utf8');
const testText = fs.readFileSync(__filename, 'utf8');
scanTextForSecrets(contractText, 'TEST 7h contract.md');
scanTextForSecrets(testText, 'TEST 7i this test file');

const evidencedProviders = new Set(Object.keys(modelReg.indexes.by_provider || {}));
evidencedProviders.add('openrouter');
ok(registry.accounts.every(a => evidencedProviders.has(a.provider_id)), 'TEST 8: every account.provider_id points to a valid provider');
ok(acct.provider_id === 'openrouter', 'TEST 8b: seed bound to Provider Registry openrouter');
ok(direct.provider_id === 'google', 'TEST 8c: direct account bound to Provider Registry google');

ok(Array.isArray(acct.model_refs), 'TEST 9: model_refs is an array of canonical ids');
ok(acct.model_refs.every(id => modelLookup.getModel(id) !== null), 'TEST 9b: every seed model_ref exists in Model Registry');
ok(!('capability_refs' in acct), 'TEST 9c: capabilities are not copied onto the seed account');
ok(Array.isArray(direct.model_refs), 'TEST 9d: direct model_refs is an array of canonical ids');
ok(direct.model_refs.every(id => modelLookup.getModel(id) !== null), 'TEST 9e: every direct model_ref exists in Model Registry');
ok(!('capability_refs' in direct), 'TEST 9f: capabilities are not copied onto the direct account');
const seedModels = modelsOfAccount(SEED_ID);
ok(seedModels.includes(SEED_MODEL), 'TEST 9g: modelsOfAccount includes seed model');
const seedModel = modelLookup.getModel(SEED_MODEL);
ok(Array.isArray(seedModel.capability_refs) && seedModel.capability_refs.includes(SEED_CAP), 'TEST 9h: seed capabilities resolved via Model Registry');
ok(seedModel.capability_refs.every(id => capLookup.listCapabilityIds().includes(id)), 'TEST 9i: seed capability refs exist in Capability Matrix');
const directModels = modelsOfAccount(DIRECT_ID);
ok(directModels.includes(DIRECT_MODEL), 'TEST 9j: direct modelsOfAccount includes live direct model');
const directModel = modelLookup.getModel(DIRECT_MODEL);
ok(directModel && directModel.provider_id === DIRECT_PROVIDER, 'TEST 9k: direct model resolves to Google provider');
ok(directModel && directModel.status === 'available', 'TEST 9l: direct model is available after LIVE certification');

ok(modelLookup.providerOf(SEED_MODEL) === SEED_PROVIDER, 'TEST 10: mediated model still points to openrouter');
ok(modelLookup.providerOf(DIRECT_MODEL) === DIRECT_PROVIDER, 'TEST 10b: direct model points to google');
ok(registry.accounts.some(a => a.provider_id === SEED_PROVIDER), 'TEST 10c: openrouter seed remains present');
ok(registry.accounts.some(a => a.provider_id === DIRECT_PROVIDER), 'TEST 10d: google direct account is present');

ok(modelLookup.getModel(SEED_MODEL) !== null, 'TEST 11: getModel still resolves seed');
ok(modelLookup.modelsByProvider(SEED_PROVIDER).length >= 1, 'TEST 11b: modelsByProvider(openrouter) still works');
ok(modelLookup.version === modelReg.version, 'TEST 11c: Model Registry version intact');

ok(capLookup.supports(SEED_MODEL, SEED_CAP) === true, 'TEST 12: supports(text_generation) still true');
ok(capLookup.modelsByCapability(SEED_CAP).includes(SEED_MODEL), 'TEST 12b: modelsByCapability still lists seed model');
ok(capLookup.version === capReg.version, 'TEST 12c: Capability Matrix version intact');

const lookupSrc = fs.readFileSync(path.join(__dirname, '..', 'accounts', 'lookup.js'), 'utf8');
ok(!FORBIDDEN_LOGIC.some(k => k in acct || k in (acct.metadata || {})), 'TEST 13: no quota/router fields on seed account records');
ok(!FORBIDDEN_LOGIC.some(k => k in direct || k in (direct.metadata || {})), 'TEST 13b: no quota/router fields on direct account records');
ok(!/\b(computeQuota|enforceQuota|rateLimit|rate_limit|capacityRemaining|usageCount)\b/.test(lookupSrc), 'TEST 13c: lookup contains no quota/capacity logic');

ok(!/selectModel|chooseAccount|fallback|routeTo/.test(lookupSrc), 'TEST 14: lookup contains no router/fallback logic');
ok(!('router' in registry) && !('fallback' in registry), 'TEST 14b: registry has no router/fallback objects');

const ids = listAccountIds();
ok(ids.length === new Set(ids).size, 'TEST 15: no duplicate account_ids');
ok(ids.length === registry.accounts.length, 'TEST 15b: listAccountIds matches registry length');

console.log('\nAll', passed, 'assertions passed.');
