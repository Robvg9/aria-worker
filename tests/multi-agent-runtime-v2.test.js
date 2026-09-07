'use strict';
const assert=require('node:assert/strict');
const {createMultiAgentRuntime}=require('../agents/runtime-v2');

(async()=>{
 const agents=[
  {id:'planner',role:'planner',capabilities:['planning'],reliability:.95,cost:1},
  {id:'researcher',role:'researcher',capabilities:['research'],reliability:.9,cost:1},
  {id:'reviewer',role:'reviewer',capabilities:['review'],reliability:.94,cost:1}
 ];
 let running=0,maxRunning=0,calls=0;
 const executors={};
 for(const id of ['planner','researcher','reviewer']) executors[id]=async({task,attempt})=>{calls++;running++;maxRunning=Math.max(maxRunning,running);await new Promise(r=>setTimeout(r,10));running--;if(task.fail_once&&attempt===1)return{status:'failed',claim:'TEMP'};return{status:'succeeded',claim:task.claim,evidence:'verified'};};
 const runtime=createMultiAgentRuntime({agents,executors,maxAgents:3,maxParallel:2,budget:10,maxAttempts:1,verifier:(results,arb)=>arb.agreement==='consensus'&&results.every(r=>r.status==='succeeded'&&r.evidence)});
 const parallel=await runtime.run({goal:'review',requiredCapabilities:['research'],tasks:[{id:'a',cost:1,claim:'SAFE',parallelizable:true},{id:'b',cost:1,claim:'SAFE',parallelizable:true}]});
 assert.equal(parallel.status,'succeeded'); assert.equal(parallel.decision.verified,true); assert.ok(maxRunning<=2); assert.equal(parallel.plan.mode,'parallel');
 const beforeGate=calls;
 const gated=await runtime.run({goal:'write',requiredCapabilities:['review'],tasks:[{id:'c',cost:1,claim:'WRITE',requireHumanGate:true}]});
 assert.equal(gated.status,'blocked'); assert.equal(gated.reason,'human_gate_required'); assert.equal(calls,beforeGate);
 const dissent=await runtime.run({goal:'decide',tasks:[{id:'d',cost:1,claim:'A'},{id:'e',cost:1,claim:'B'}]});
 assert.equal(dissent.decision.arbitration.agreement,'disagreement'); assert.equal(dissent.status,'needs_review');
 const budget=await runtime.run({goal:'expensive',tasks:[{id:'f',cost:8,claim:'X'},{id:'g',cost:8,claim:'X'}],budget:5});
 assert.equal(budget.status,'blocked'); assert.equal(budget.reason,'budget_exceeded');
 const escalate=createMultiAgentRuntime({agents:[agents[0],agents[1]],executors,maxAgents:2,maxParallel:1,budget:10,maxAttempts:2,verifier:(results)=>results.every(r=>r.status==='succeeded')});
 const recovery=await escalate.run({goal:'recover',tasks:[{id:'r',cost:1,claim:'RECOVER',fail_once:true}]});
 assert.equal(recovery.status,'succeeded'); assert.equal(recovery.results[0].agentId,'researcher'); assert.equal(recovery.results[0].attempt,2); assert.equal(recovery.attempts.length,2);
 console.log('MULTI-AGENT RUNTIME V2: PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
