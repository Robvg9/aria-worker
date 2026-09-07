'use strict';
const assert=require('node:assert/strict');
const {createSelfModelV2}=require('../self-model/self-model-v2');
const {buildCapabilityGraph,diffCapabilityGraph,bestCapability}=require('../self-model/capability-graph-v2');
const router={route:(capability)=>capability==='browser'?{status:'selected',provider_id:'google',account_id:'acct',model_id:'model'}:null};
const memory={recent_failures:[{id:'f1',capability:'dom_recovery',reason:'selector_missing'}],recent_changes:[{id:'c1',what:'sandbox'}]};
const learning={state:{capability:'dom_recovery',status:'learning'}};
const planner={version:'planner-v10'}; const selfDevelopment={version:'self-development-v2'};
const model=createSelfModelV2({identity:'ARIA',canonicalEntrypoint:'aria-canonical-runtime-v1',softwareVersion:'2.6.8',capabilities:[
{id:'browser',status:'verified',confidence:.96,last_verified:'2026-09-07',evidence:{test:'live'},dependencies:['computer'],cost:{kind:'none'},risk:'medium',reliability:.94},
{id:'computer',status:'active',confidence:.9,reliability:.88},{id:'dom_recovery',status:'uncertain',confidence:.42,risk:'high'},{id:'dangerous_write',status:'blocked',risk:'critical'}
],dependencies:{browser:['computer'],dom_recovery:['browser']},resources:['github','supabase'],tools:['github','browser'],providers:['google'],router,memory,learning,planner,selfDevelopment});
const s=model.refresh({current_activity:{mission_id:'m1',state:'running'}});
assert.equal(s.version,'self-model-v2.0.0');
assert.deepEqual(s.what_i_can_do,['browser','computer']); assert.deepEqual(s.what_i_cannot_do,['dangerous_write']);
assert.deepEqual(s.verified_capabilities,['browser']); assert.deepEqual(s.uncertain_capabilities,['dom_recovery']);
assert.equal(s.what_i_am_currently_doing.mission_id,'m1'); assert.equal(s.what_failed_recently[0].id,'f1'); assert.equal(s.why_it_failed[0].reason,'selector_missing');
assert.equal(s.authority.router,true);assert.equal(s.authority.memory,true);assert.equal(s.authority.learning,true);assert.equal(s.authority.planner,true);assert.equal(s.authority.self_development,true);
assert.equal(s.capabilities.find(x=>x.capability==='browser').confidence,.96);
assert.deepEqual(model.chooseBest('browser').route,{status:'selected',provider_id:'google',account_id:'acct',model_id:'model'});
assert.equal(model.chooseBest('dom_recovery').status,'uncertain'); assert.equal(model.chooseBest('missing').status,'missing');
assert.equal(model.answer('What can I do?').answer.includes('browser'),true);
const g1=buildCapabilityGraph({capabilities:[{id:'a',status:'verified'},{id:'b',status:'unknown'}],dependencies:{a:['b']}});
const g2=buildCapabilityGraph({capabilities:[{id:'a',status:'verified'},{id:'b',status:'verified'},{id:'c',status:'active'}],dependencies:{a:['b']}});
assert.deepEqual(diffCapabilityGraph(g1,g2),{added:['c'],removed:[],changed:['b'],unchanged:false}); assert.equal(bestCapability(g2,'a').status,'selected');
const c=model.compare(s);assert.equal(c.system.unchanged,true);assert.equal(c.capabilities.unchanged,true);
console.log('SELF-MODEL 2.0: PASS — self state, capability graph, confidence/evidence, uncertainty, failures, resources, learning state, and router-aware capability selection');
