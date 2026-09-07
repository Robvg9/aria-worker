'use strict';
const assert=require('node:assert/strict');
const {createMultiAgentRuntime}=require('../agents/runtime-v2');

(async()=>{
 const agents=[
  {id:'planner',role:'planner',capabilities:['planning'],reliability:.95,cost:1},
  {id:'researcher',role:'researcher',capabilities:['research'],reliability:.9,cost:1},
  {id:'reviewer',role:'reviewer',capabilities:['review'],reliability:.94,cost:1}
 ];
 let running=0,maxRunning=0;
 const executors={};
 for(const id of ['planner','researcher','reviewer']) executors[id]=async({task})=>{running++;maxRunning=Math.max(maxRunning,running);await new Promise(r=>setTimeout(r,10));running--;return {status:'succeeded',claim:task.claim};};
 const runtime=createMultiAgentRuntime({agents,executors,maxAgents:3,maxParallel:2,budget:10,verifier:(results,arb)=>arb.agreement==='consensus'});
 const parallel=await runtime.run({goal:'review',requiredCapabilities:['research'],tasks:[{id:'a',cost:1,claim:'SAFE'},{id:'b',cost:1,claim:'SAFE'}]});
 assert.equal(parallel.status,'succeeded'); assert.equal(parallel.decision.verified,true); assert.ok(maxRunning<=2); assert.equal(parallel.plan.mode,'parallel');
 const gated=await runtime.run({goal:'write',requiredCapabilities:['review'],tasks:[{id:'c',cost:1,claim:'WRITE',requireHumanGate:true}]});
 assert.equal(gated.status,'needs_review');
 const dissent=await runtime.run({goal:'decide',tasks:[{id:'d',cost:1,claim:'A'},{id:'e',cost:1,claim:'B'}]});
 assert.equal(dissent.decision.arbitration.agreement,'disagreement'); assert.equal(dissent.status,'needs_review');
 const budget=await runtime.run({goal:'expensive',tasks:[{id:'f',cost:8,claim:'X'},{id:'g',cost:8,claim:'X'}],budget:5});
 assert.equal(budget.status,'blocked'); assert.equal(budget.reason,'budget_exceeded');
 console.log('MULTI-AGENT RUNTIME V2: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
