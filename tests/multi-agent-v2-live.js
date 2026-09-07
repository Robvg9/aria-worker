'use strict';
const assert=require('node:assert/strict');
const {createMultiAgentRuntime}=require('../agents/runtime-v2');

(async()=>{
  const agents=[
    {id:'planner',role:'planner',capabilities:['planning'],reliability:.96,cost:1},
    {id:'researcher',role:'researcher',capabilities:['research'],reliability:.93,cost:1},
    {id:'security',role:'security',capabilities:['security'],reliability:.99,cost:2},
    {id:'reviewer',role:'reviewer',capabilities:['review'],reliability:.95,cost:1}
  ];
  const trace=[];
  const executors={
    planner:async({task})=>{trace.push('planner:'+task.id);return{status:'succeeded',claim:'SAFE',evidence:'planner-verified'};},
    researcher:async({task})=>{trace.push('researcher:'+task.id);return{status:'succeeded',claim:'SAFE',evidence:'research-verified'};},
    security:async({task})=>{trace.push('security:'+task.id);return{status:'succeeded',claim:'SAFE',evidence:'security-verified'};},
    reviewer:async({task})=>{trace.push('reviewer:'+task.id);return{status:'succeeded',claim:'SAFE',evidence:'review-verified'};}
  };
  const verifier=(results,arb)=>results.every(r=>r.status==='succeeded'&&r.evidence)&&arb.agreement==='consensus';
  const runtime=createMultiAgentRuntime({agents,executors,maxAgents:4,maxParallel:2,budget:20,verifier});
  const result=await runtime.run({
    goal:'certify coordinated internal decision',
    requiredCapabilities:['security','review'],
    tasks:[
      {id:'security-check',cost:2,claim:'SAFE',parallelizable:true},
      {id:'review-check',cost:1,claim:'SAFE',parallelizable:true},
      {id:'planner-check',cost:1,claim:'SAFE',parallelizable:true},
      {id:'research-check',cost:1,claim:'SAFE',parallelizable:true}
    ]
  });
  assert.equal(result.status,'succeeded');
  assert.equal(result.decision.verified,true);
  assert.equal(result.decision.arbitration.agreement,'consensus');
  assert.equal(result.plan.mode,'parallel');
  assert.ok(result.plan.agents.length<=4);
  assert.ok(result.budgetUsed<=20);

  const dissentRuntime=createMultiAgentRuntime({
    agents:agents.slice(0,2),
    executors:{planner:async()=>({status:'succeeded',claim:'A'}),researcher:async()=>({status:'succeeded',claim:'B'})},
    maxParallel:2,
    verifier:()=>false
  });
  const dissent=await dissentRuntime.run({goal:'detect disagreement',tasks:[{id:'d1',cost:1},{id:'d2',cost:1}]});
  assert.equal(dissent.status,'needs_review');
  assert.equal(dissent.decision.arbitration.agreement,'disagreement');

  console.log(JSON.stringify({
    status:'succeeded',
    marker:'ARIA_MULTI_AGENT_2_LIVE_OK',
    consensus:true,
    disagreement_detected:true,
    bounded_parallelism:true,
    trace,
    selected_agents:result.plan.agents.map(a=>a.id),
    plan_hash:result.plan.planHash,
    budget_used:result.budgetUsed
  },null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
