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
assert.equal(r.classifyFallbackFailure({provider_status:429}),'rate_limit');
assert.deepEqual(r.governFallback({provider_id:'p1',account_id:'a1'},[{provider_id:'p1',account_id:'a1',model_id:'m-same'},{provider_id:'p2',account_id:'a2',model_id:'m-next'}],'provider_unavailable').map(x=>x.model_id),['m-next']);
assert.deepEqual(r.governFallback({provider_id:'p1',account_id:'a1'},[{provider_id:'p2',account_id:'a2',model_id:'m-next'}],'rate_limit'),[]);
assert.equal(r.governFallback({provider_id:'p1',account_id:'a1'},[{provider_id:'p2',account_id:'a2',model_id:'m-next'}],'rate_limit',{allow_rate_limit_fallback:true}).length,1);
console.log('MISSION 6 ROUTER V2 FALLBACK GOVERNANCE: PASS');

const auto={...require('../router/omniroute-auto.js')};
const allowed=[
 {task_id:'task-8',provider_id:'p-z',account_id:'a-z',model_id:'slow',capability:'text_generation',allowed:true,availability_status:'available',latency_ms:900,cost_usd:0.001,tags:[],evidence:{source:'aria.router.allowed_set',target_id:'task-8',provider_id:'p-z',model_id:'slow',evidence_id:'ev-slow'}},
 {task_id:'task-8',provider_id:'p-a',account_id:'a-a',model_id:'coder',capability:'text_generation',allowed:true,availability_status:'available',latency_ms:500,cost_usd:0.004,tags:['coding'],evidence:{source:'aria.router.allowed_set',target_id:'task-8',provider_id:'p-a',model_id:'coder',evidence_id:'ev-coder'}},
 {task_id:'task-8',provider_id:'p-b',account_id:'a-b',model_id:'cheap',capability:'text_generation',allowed:true,availability_status:'available',latency_ms:700,cost_usd:0.0005,tags:['coding'],evidence:{source:'aria.router.allowed_set',target_id:'task-8',provider_id:'p-b',model_id:'cheap',evidence_id:'ev-cheap'}},
 {task_id:'task-8',provider_id:'p-c',account_id:'a-c',model_id:'offline',capability:'text_generation',allowed:true,availability_status:'available',latency_ms:1200,cost_usd:0,tags:['offline'],offline:true,local:true,evidence:{source:'aria.router.allowed_set',target_id:'task-8',provider_id:'p-c',model_id:'offline',evidence_id:'ev-offline'}}
];
let a=auto.selectAuto({task_id:'task-8',task:'implement coding fix',capability:'text_generation',mode:'auto/coding',allowed_routes:allowed});
assert.equal(a.status,'selected'); assert.equal(a.selected.model_id,'cheap'); assert.equal(a.selection_evidence.target_id,'task-8'); assert.equal(a.selection_evidence.provider_id,'p-b'); assert.equal(a.selection_evidence.model_id,'cheap');
let f1=auto.selectAuto({task_id:'task-8',task:'fast response',capability:'text_generation',mode:'auto/fast',allowed_routes:allowed});
assert.equal(f1.selected.model_id,'coder');
let c1=auto.selectAuto({task_id:'task-8',task:'cheap response',capability:'text_generation',mode:'auto/cheap',allowed_routes:allowed});
assert.equal(c1.selected.model_id,'cheap');
let o1=auto.selectAuto({task_id:'task-8',task:'offline response',capability:'text_generation',mode:'auto/offline',allowed_routes:allowed});
assert.equal(o1.selected.model_id,'offline');
let d1=auto.selectAuto({task_id:'task-8',task:'same decision',capability:'text_generation',mode:'auto',allowed_routes:allowed});
let d2=auto.selectAuto({task_id:'task-8',task:'same decision',capability:'text_generation',mode:'auto',allowed_routes:allowed.slice().reverse()});
assert.equal(d1.decision_hash,d2.decision_hash);
let blocked=auto.selectAuto({task_id:'task-8',task:'same',capability:'text_generation',mode:'auto',allowed_routes:allowed.map(x=>({...x,allowed:false}))});
assert.equal(blocked.status,'no_route'); assert.equal(blocked.reason,'no_eligible_allowed_route');
let constrained=auto.selectAuto({task_id:'task-8',task:'cheap under budget',capability:'text_generation',mode:'auto',constraints:{max_cost_usd:0.0007},allowed_routes:allowed});
assert.equal(constrained.selected.model_id,'cheap');
let targetBlocked=auto.selectAuto({task_id:'task-8',task:'same',capability:'text_generation',mode:'auto',allowed_routes:[{...allowed[0],task_id:'other'}]});
assert.equal(targetBlocked.status,'no_route');
assert.equal(auto.selectAuto({task_id:'task-8',task:'x',capability:'text_generation',mode:'auto/unknown',allowed_routes:allowed}).status,'no_route');
console.log('OMNIROUTE PHASE 8 AUTO-COMBO: PASS');