'use strict';
const assert=require('node:assert/strict');
const {selectAgents,chooseMode,buildPlan,shouldStop,arbitrate,finalizeDecision,createAgentManager}=require('../agents/manager-v2');

const agents=[
 {id:'planner',role:'planner',capabilities:['planning'],reliability:.95,cost:1},
 {id:'researcher',role:'researcher',capabilities:['research'],reliability:.9,cost:1},
 {id:'security',role:'security',capabilities:['security'],reliability:.98,cost:2},
 {id:'reviewer',role:'reviewer',capabilities:['review'],reliability:.94,cost:1}
];
assert.equal(selectAgents({agents,requiredCapabilities:['security'],maxAgents:2})[0].id,'security');
assert.equal(chooseMode({tasks:[{id:'a',cost:1},{id:'b',cost:1}],budget:5,maxParallel:2}),'parallel');
assert.equal(chooseMode({tasks:[{id:'a',cost:4},{id:'b',cost:4}],budget:5,maxParallel:2}),'sequential');
const plan=buildPlan({goal:'review release',agents,tasks:[{id:'a',parallelizable:true,cost:1},{id:'b',parallelizable:true,cost:1}],requiredCapabilities:['review'],budget:10});
assert.equal(plan.status,'planned'); assert.equal(plan.mode,'parallel'); assert.ok(plan.planHash.length===64);
assert.deepEqual(shouldStop({verified:true}),{stop:true,reason:'verified'});
assert.deepEqual(shouldStop({requireHumanGate:true}),{stop:true,reason:'human_gate_required'});
const a=arbitrate([{agentId:'planner',claim:'safe'},{agentId:'reviewer',claim:'safe'}]);
assert.equal(a.agreement,'consensus'); assert.equal(a.confidence,1);
const d=finalizeDecision({results:[{agentId:'a',claim:'A'},{agentId:'b',claim:'B'}],requireConsensus:false});
assert.equal(d.status,'needs_review'); assert.equal(d.verified,false); assert.equal(d.arbitration.agreement,'disagreement');
const manager=createAgentManager({agents,budget:10});
const delegated=manager.plan({goal:'research and review',requiredCapabilities:['research'],tasks:[{id:'t1',cost:1}]});
assert.equal(delegated.status,'planned');
console.log('MULTI-AGENT V2: PASS');
