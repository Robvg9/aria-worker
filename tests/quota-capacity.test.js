/**
 * Mission 10.5 — Quota / Capacity Manager tests
 * Run: node tests/quota-capacity.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getQuota,
  getCapacity,
  getQuotaForModel,
  getCapacityForModel,
  listAccountIds,
  listModelIds,
  version,
  registry
} = require('../quota/lookup.js');

const accountLookup = require('../accounts/lookup.js');
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
const SECRET_VALUE_RE = /\b(sk-[A-Za-z0-9_-]{8,}|or-v1-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-]+)\b/;
const INVENTED_LIMIT_KEYS = [
  'requests_per_minute', 'tokens_per_minute',
  'requests_per_day', 'tokens_per_day',
  'rpm', 'tpm', 'rpd', 'tpd', 'concurrency'
];
const BILLING_KEYS = ['price', 'pricing', 'cost', 'billing', 'usd', 'currency'];
const ROUTER_KEYS = ['router', 'fallback', 'selected', 'priority'];

function collectKeys(obj, acc) {
  if (!obj || typeof obj !== 'object') return acc;
  for (const [k, v] of Object.entries(obj)) {
    acc.push(k);
    if (v && typeof v === 'object') collectKeys(v, acc);
  }
  return acc;
}

function collectNumbers(obj, acc, trail) {
  if (obj === null || obj === undefined) return acc;
  if (typeof obj === 'number') {
    acc.push({ trail, value: obj });
    return acc;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => collectNumbers(v, acc, trail + '[' + i + ']'));
    return acc;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (k === 'indexes') continue;
      collectNumbers(v, acc, trail ? trail + '.' + k : k);
    }
  }
  return acc;
}

function scanTextForSecrets(text, label) {
  ok(!SECRET_VALUE_RE.test(text), `${label}: no secret material in text`);
}

console.log('=== Quota / Capacity Manager 10.5 tests ===');
console.log('version:', version);

const SEED_ID = 'acct_openrouter_primary';
const SEED_PROVIDER = 'openrouter';
const SEED_MODEL = 'google/gemini-2.5-flash-lite';
const SEED_CAP = 'text_generation';
const CANONICAL_STATUS = ['unknown', 'known', 'available', 'unavailable', 'exhausted'];

ok(version === 'aria-quota-capacity-v1.0.0', 'version is aria-quota-capacity-v1.0.0');

// TEST 1 — existing capacity
const cap = getCapacity(SEED_ID);
ok(cap !== null, 'TEST 1: getCapacity returns the verified seed');
ok(cap.account_id === SEED_ID, 'TEST 1b: capacity.account_id is acct_openrouter_primary');
ok(cap.provider_id === SEED_PROVIDER, 'TEST 1c: capacity.provider_id is openrouter');
ok(cap.model_id === SEED_MODEL, 'TEST 1d: capacity.model_id is seed model');
ok(cap.status === 'unknown', 'TEST 1e: capacity status is unknown (ChatBending seed)');
ok(cap.max_known === null, 'TEST 1f: max_known is null — not invented');
ok(CANONICAL_STATUS.includes(cap.status), 'TEST 1g: capacity status is canonical');

// TEST 2 — existing quota
const quota = getQuota(SEED_ID);
ok(quota !== null, 'TEST 2: getQuota returns the verified seed');
ok(quota.account_id === SEED_ID, 'TEST 2b: quota.account_id is seed');
ok(quota.provider_id === SEED_PROVIDER, 'TEST 2c: quota.provider_id is openrouter');
ok(quota.model_id === SEED_MODEL, 'TEST 2d: quota.model_id is seed model');
ok(quota.status === 'unknown', 'TEST 2e: quota status is unknown');
ok(quota.limits === null, 'TEST 2f: quota.limits is null — no invented RPM/TPM');
ok(quota.rate_limit && quota.rate_limit.status === 'unknown', 'TEST 2g: rate_limit status is unknown');
ok(quota.rate_limit.limits === null, 'TEST 2h: rate_limit.limits is null');
ok(quota.usage && quota.usage.status === 'unknown', 'TEST 2i: usage status is unknown');
ok(quota.usage.requests_consumed === null, 'TEST 2j: usage.requests_consumed is null');
ok(quota.usage.tokens_consumed === null, 'TEST 2k: usage.tokens_consumed is null');
ok(quota.usage.remaining === null, 'TEST 2l: usage.remaining is null (not simulated)');
ok(quota.usage.reset_at === null, 'TEST 2m: usage.reset_at is null');

// TEST 3 — lookup by model
const capByModel = getCapacityForModel(SEED_MODEL);
const quotaByModel = getQuotaForModel(SEED_MODEL);
ok(Array.isArray(capByModel) && capByModel.length === 1, 'TEST 3: getCapacityForModel returns one seed row');
ok(capByModel[0].account_id === SEED_ID, 'TEST 3b: capacity-for-model bound to seed account');
ok(capByModel[0].status === 'unknown', 'TEST 3c: model capacity status is unknown');
ok(Array.isArray(quotaByModel) && quotaByModel.length === 1, 'TEST 3d: getQuotaForModel returns one seed row');
ok(quotaByModel[0].account_id === SEED_ID, 'TEST 3e: quota-for-model bound to seed account');
ok(quotaByModel[0].status === 'unknown', 'TEST 3f: model quota status is unknown');

// TEST 4 — missing account → controlled
ok(getCapacity('does-not-exist') === null, 'TEST 4: nonexistent account capacity → null');
ok(getQuota('does-not-exist') === null, 'TEST 4b: nonexistent account quota → null');
ok(getCapacity('') === null, 'TEST 4c: empty account_id capacity → null');
ok(getQuota('') === null, 'TEST 4d: empty account_id quota → null');
ok(getCapacity(null) === null, 'TEST 4e: null account_id capacity → null');
ok(getQuota(null) === null, 'TEST 4f: null account_id quota → null');

// TEST 5 — missing model → controlled
ok(getCapacityForModel('does-not-exist').length === 0, 'TEST 5: nonexistent model capacity → []');
ok(getQuotaForModel('does-not-exist').length === 0, 'TEST 5b: nonexistent model quota → []');
ok(getCapacityForModel('').length === 0, 'TEST 5c: empty model_id capacity → []');
ok(getQuotaForModel(null).length === 0, 'TEST 5d: null model_id quota → []');

// TEST 6 — no secrets
const allKeys = collectKeys(registry, []);
ok(!allKeys.some(k => SECRET_KEY_RE.test(k)), 'TEST 6: no secret field names in registry');
const registryText = JSON.stringify(registry);
scanTextForSecrets(registryText, 'TEST 6b registry.json');
const contractText = fs.readFileSync(path.join(__dirname, '..', 'quota', 'contract.md'), 'utf8');
const lookupSrc = fs.readFileSync(path.join(__dirname, '..', 'quota', 'lookup.js'), 'utf8');
const testText = fs.readFileSync(__filename, 'utf8');
scanTextForSecrets(contractText, 'TEST 6c contract.md');
scanTextForSecrets(lookupSrc, 'TEST 6d lookup.js');
scanTextForSecrets(testText, 'TEST 6e this test file');
ok(!('credential_ref' in registry.entries[0]), 'TEST 6f: quota layer does not duplicate credential_ref');

// TEST 7 — no invented quotas
ok(registry.entries.every(e => e.quota.status === 'unknown'), 'TEST 7: every quota.status is unknown');
ok(registry.entries.every(e => e.quota.limits === null), 'TEST 7b: every quota.limits is null');
ok(registry.entries.every(e => e.capacity.status === 'unknown'), 'TEST 7c: every capacity.status is unknown');
ok(registry.entries.every(e => e.capacity.max_known === null), 'TEST 7d: every capacity.max_known is null');
ok(registry.entries.every(e => e.rate_limit.status === 'unknown' && e.rate_limit.limits === null),
  'TEST 7e: every rate_limit is unknown/null');
ok(registry.entries.every(e =>
  e.usage.status === 'unknown' &&
  e.usage.requests_consumed === null &&
  e.usage.tokens_consumed === null &&
  e.usage.remaining === null &&
  e.usage.reset_at === null
), 'TEST 7f: usage is unknown with null metrics (not simulated)');
const nums = collectNumbers(registry.entries, [], '');
ok(nums.length === 0, 'TEST 7g: no numeric quota/capacity/usage values in seed entries');
ok(registry.entries.every(e => {
  const keys = collectKeys(e, []);
  return !keys.some(k => INVENTED_LIMIT_KEYS.includes(k));
}), 'TEST 7h: seed does not materialize RPM/TPM/RPD/TPD/concurrency keys');
ok(!registryText.includes('"remaining": 95') && !registryText.includes('"used": 5'),
  'TEST 7i: no simulated remaining/used samples');

// TEST 8 — every account_id is valid in Account Manager
ok(registry.entries.every(e => accountLookup.getAccount(e.account_id) !== null),
  'TEST 8: every account_id exists in Account Manager');
ok(accountLookup.getAccount(SEED_ID) !== null, 'TEST 8b: seed account still resolvable');
ok(accountLookup.isAccountActive(SEED_ID) === true, 'TEST 8c: seed account remains active');

// TEST 9 — every model_id is valid in Model Registry
ok(registry.entries.every(e => modelLookup.getModel(e.model_id) !== null),
  'TEST 9: every model_id exists in Model Registry');
ok(modelLookup.getModel(SEED_MODEL) !== null, 'TEST 9b: seed model still resolvable');

// TEST 10 — Provider Registry 10.1 still functions (seed compatibility)
const evidencedProviders = new Set(Object.keys(modelReg.indexes.by_provider || {}));
evidencedProviders.add('openrouter');
ok(registry.entries.every(e => evidencedProviders.has(e.provider_id)),
  'TEST 10: every provider_id points to the 10.1 openrouter seed');
ok(modelLookup.providerOf(SEED_MODEL) === SEED_PROVIDER,
  'TEST 10b: 10.1 provider seed still reachable via Model Registry');

// TEST 11 — Model Registry 10.2 still functions
ok(modelLookup.getModel(SEED_MODEL) !== null, 'TEST 11: getModel still resolves seed');
ok(modelLookup.modelsByProvider(SEED_PROVIDER).length >= 1,
  'TEST 11b: modelsByProvider(openrouter) still works');
ok(modelLookup.version === modelReg.version, 'TEST 11c: Model Registry version intact');

// TEST 12 — Capability Matrix 10.3 still functions
ok(capLookup.supports(SEED_MODEL, SEED_CAP) === true,
  'TEST 12: supports(text_generation) still true');
ok(capLookup.modelsByCapability(SEED_CAP).includes(SEED_MODEL),
  'TEST 12b: modelsByCapability still lists seed model');
ok(capLookup.version === capReg.version, 'TEST 12c: Capability Matrix version intact');

// TEST 13 — Account Manager 10.4 still functions
ok(accountLookup.version === 'aria-account-manager-v1.0.0', 'TEST 13: Account Manager version intact');
ok(accountLookup.credentialRefOf(SEED_ID) === 'secret://openrouter/acct_openrouter_primary',
  'TEST 13b: credential_ref still a reference');
ok(accountLookup.modelsOfAccount(SEED_ID).includes(SEED_MODEL),
  'TEST 13c: modelsOfAccount still lists seed model');
ok(!('quota' in (accountLookup.getAccount(SEED_ID) || {})),
  'TEST 13d: Account Manager still does not copy quota');

// TEST 14 — no Router logic
ok(!/selectModel|chooseAccount|routeTo|bestAccount|pickRoute/.test(lookupSrc),
  'TEST 14: lookup contains no router selection logic');
ok(!('router' in registry) && !('fallback' in registry),
  'TEST 14b: registry has no router/fallback objects');
ok(registry.entries.every(e => {
  const keys = collectKeys(e, []);
  return !keys.some(k => ROUTER_KEYS.includes(k));
}), 'TEST 14c: entries have no router/fallback/selected/priority fields');

// TEST 15 — no selection / fallback logic
ok(!/fallback|selectAccount|chooseProvider|rotateAccount/.test(lookupSrc),
  'TEST 15: lookup contains no fallback/selection/rotation logic');
ok(!lookupSrc.includes('use this account'), 'TEST 15b: lookup does not recommend accounts');

// TEST 16 — no billing / pricing
ok(registry.entries.every(e => {
  const keys = collectKeys(e, []);
  return !keys.some(k => BILLING_KEYS.includes(k.toLowerCase()));
}), 'TEST 16: no billing/pricing fields on entries');
ok(!/\b(price|pricing|billing|cost_per_token|usd)\b/.test(lookupSrc),
  'TEST 16b: lookup contains no billing/pricing logic');

// TEST 17 — no logical duplicates
const pairs = registry.entries.map(e => e.account_id + '::' + e.model_id);
ok(pairs.length === new Set(pairs).size, 'TEST 17: no duplicate (account_id, model_id)');
ok(listAccountIds().length === new Set(listAccountIds()).size, 'TEST 17b: no duplicate account_ids in index');
ok(listModelIds().includes(SEED_MODEL), 'TEST 17c: listModelIds includes seed');
ok(registry.entries.every(e => CANONICAL_STATUS.includes(e.quota.status)),
  'TEST 17d: quota statuses are canonical');
ok(registry.entries.every(e => CANONICAL_STATUS.includes(e.capacity.status)),
  'TEST 17e: capacity statuses are canonical');
ok(!('capability_refs' in registry.entries[0]) && !('canonical_name' in registry.entries[0]),
  'TEST 17f: model/capability metadata is not duplicated here');

console.log('\nAll', passed, 'assertions passed.');
