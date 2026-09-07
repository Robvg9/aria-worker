/** Mission 10.5 — Quota / Capacity Manager v1.1 current-contract tests */
const assert = require('assert');
const fs = require('fs');
const { registry, version, getQuota, getCapacity, getQuotaForModel, getCapacityForModel } = require('../quota/lookup.js');
const accountLookup = require('../accounts/lookup.js');
const modelLookup = require('../models/lookup.js');
const capLookup = require('../capabilities/lookup.js');
let passed = 0;
function ok(c,m){assert.ok(c,m);passed++;console.log('PASS:',m);}
console.log('=== Quota / Capacity Manager 10.5 v1.1 tests ===');
ok(version === 'aria-quota-capacity-v1.1.0','version is aria-quota-capacity-v1.1.0');
const expected=[
 ['acct_openrouter_primary','openrouter','google/gemini-2.5-flash-lite'],
 ['acct_google_gemini_free','google','google/gemini-3.5-flash-lite-direct']
];
for(const [acct,provider,model] of expected){
 const q=getQuota(acct), c=getCapacity(acct);
 ok(q && q.account_id===acct && q.provider_id===provider && q.model_id===model,`quota projection valid for ${acct}`);
 ok(c && c.account_id===acct && c.provider_id===provider && c.model_id===model,`capacity projection valid for ${acct}`);
 ok(accountLookup.getAccount(acct)!==null,`account ${acct} exists`);
 ok(modelLookup.getModel(model)!==null,`model ${model} exists`);
 ok(modelLookup.providerOf(model)===provider,`model ${model} provider is ${provider}`);
 ok(capLookup.supports(model,'text_generation')===true,`model ${model} supports text_generation`);
}
const direct=getQuota('acct_google_gemini_free');
ok(direct.status==='available','direct Gemini quota is available');
ok(getCapacity('acct_google_gemini_free').status==='available','direct Gemini capacity is available');
ok(direct.usage.status==='observed' && direct.usage.requests_consumed===1 && direct.usage.tokens_consumed===25,'direct Gemini usage reflects observed LIVE evidence');
ok(direct.quota===undefined,'quota projection does not leak nested quota object');
ok(getQuotaForModel('google/gemini-3.5-flash-lite-direct').length===1,'model quota lookup resolves direct Gemini');
ok(getCapacityForModel('google/gemini-3.5-flash-lite-direct').length===1,'model capacity lookup resolves direct Gemini');
ok(getQuota('does-not-exist')===null,'missing account returns null');
ok(getCapacityForModel('does-not-exist').length===0,'missing model returns empty list');
const text=fs.readFileSync(require.resolve('../quota/registry.json'),'utf8');
ok(!/AIza[A-Za-z0-9_-]{20,}/.test(text),'registry contains no Google API key material');
ok(!/\b(sk-|or-v1-)/.test(text),'registry contains no provider secret material');
ok(registry.entries.every(e=>e.quota.limits===null || typeof e.quota.limits==='object'),'quota limits are explicit/null, never invented');
ok(registry.entries.every(e=>e.rate_limit.limits===null || typeof e.rate_limit.limits==='object'),'rate limits are explicit/null, never invented');
console.log(`All ${passed} assertions passed.`);
