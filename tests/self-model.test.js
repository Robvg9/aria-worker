'use strict';
const assert=require('node:assert/strict');
const {buildSelfModel,diffSelfModel}=require('../self-model/system-state');
const a=buildSelfModel({identity:'ARIA',canonicalEntrypoint:'aria-canonical-runtime-v1',version:'2.6.3',capabilities:['memory','execution','research'],tools:['github'],agents:['core']});
assert.equal(a.identity,'ARIA');assert.equal(a.canonical_entrypoint,'aria-canonical-runtime-v1');assert.deepEqual(a.capabilities,['memory','execution','research']);
const b=buildSelfModel({identity:'ARIA',canonicalEntrypoint:'aria-canonical-runtime-v1',version:'2.6.4',capabilities:['memory','execution','research','research'],tools:['github'],agents:['core']});
assert.deepEqual(diffSelfModel(a,a),{changed:[],unchanged:true});assert.ok(diffSelfModel(a,b).changed.includes('software_version'));assert.equal(buildSelfModel({identity:'ARIA',canonicalEntrypoint:'x'}).version,1);assert.throws(()=>buildSelfModel({identity:'ARIA'}),/self_model_identity_required/);
console.log('SELF MODEL TESTS PASS');
