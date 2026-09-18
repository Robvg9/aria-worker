'use strict';
const assert=require('node:assert/strict');
const r=require('../router/intelligent-v2.js');

const candidates=[
 {model:{model_id:'m-fast',provider_id:'p1',status:'available',enabled:true,integration_status:'connected',pricing:{tier:'free',cost:'$0'},context_window:100000,metadata:{access_path:'direct'}},capability_verified:true,live_verified:true,account:{account_id:'a1',status:'active',enabled:true},quota:{status:'available',rate_limit_status:'unknown'},agents:[{agent_id:'a1-coder',role:'coder',capabilities:['coding'],max_risk:'high',status:'available'}],observation:{attempts:10,successes:10,avg_latency_ms:500}},
 {model:{model_id:'m-research',provider_id:'p2',status:'available',enabled:true,integration_status:'connected',pricing:{tier:'free',cost:'$0'},context_window:100000,metadata:{access_path:'direct'}},capability_verified:true,live_verified:true,account:{account_id:'a2',status:'active',enabled:true},quota:{status:'available',rate_limit_status:'unknown'},agents:[{agent_id:'a2-research',role:'researcher',capabilities:['research'],max_risk:'medium',status:'available'}],observation:{attempts:8,successes:7,avg_latency_ms:900}},
 {model:{model_id:'m-blocked',provider_id:'p3',status:'available',enabled:true,integration_status:'connected',pricing:{tier:'free',cost:'$0'}},capability_verified:true,live_verified:false,account:{account_id:'a3',status:'active',enabled:true},quota:{status:'available'},agents:[],observation:{attempts:0,successes:0}}
];

let out=r.select(candidates,{task:'research and compare architecture approaches',capability:'text_generation',risk:'medium'});
assert.equal(out.status,'selected');
assert.equal(out.selected.model_id,'m-research');
assert.ok(out.fallback.length>=1);
assert.ok(out.selection_evidence.specialization.score===1);

out=r.select(candidates,{task:'debug this code and implement a safe patch',capability:'text_generation',risk:'high'});
assert.equal(out.selected.model_id,'m-fast');
assert.equal(out.selected.agent_role,'coder');

out=r.select(candidates,{task:'critical production migration',capability:'text_generation',risk:'critical'});
assert.equal(out.status,'no_route');

assert.deepEqual(r.parallelPlan([{id:'a'},{id:'b'},{id:'c',depends_on:['a','b']}],{maxParallel:2}).batches,[['a','b'],['c']]);
assert.equal(r.parallelPlan([{id:'a',depends_on:['a']}]).status,'blocked');

console.log('MISSION 6 ROUTER V2 CONTRACT: PASS');

out=r.select(candidates,{task:'write code and debug a regression',capability:'text_generation',risk:'high',required_tools:['coding']});
assert.equal(out.status,'selected');
assert.equal(out.selected.model_id,'m-fast');
assert.equal(out.selected.agent_role,'coder');
out=r.select(candidates,{task:'research and synthesize findings',capability:'text_generation',risk:'medium',prefer_specialist_agent:true});
assert.equal(out.status,'selected');
assert.equal(out.selected.agent_role,'researcher');
out=r.select(candidates,{task:'research with unavailable tool',capability:'text_generation',risk:'medium',required_tools:['device']});
assert.equal(out.status,'no_route');
console.log('MISSION 6 ROUTER V2 SPECIALIZATION/TOOLS: PASS');
