'use strict';
const assert=require('node:assert/strict');
const {createMultiAgentRuntime}=require('../agents/runtime-v2');
const {adaptCatalog,catalogCoverage}=require('../agents/catalog-adapter-v2');
const {createVerifierV2}=require('../agents/verifier-v2');

(async()=>{
  const rawCatalog=[
    {agent_id:'aria-agent-planner-v1',role:'planner',capabilities:['planning'],scope:['reason'],max_risk:'low',status:'available',model_id:'model-planner'},
    {agent_id:'aria-agent-reviewer-v1',role:'reviewer',capabilities:['review'],scope:['reason'],max_risk:'low',status:'available',model_id:'model-reviewer'},
    {agent_id:'aria-agent-research-v1',role:'researcher',capabilities:['research'],scope:['reason'],max_risk:'low',status:'available',model_id:'model-researcher'},
    {agent_id:'aria-agent-coding-v1',role:'coder',capabilities:['coding'],scope:['reason'],max_risk:'low',status:'available',model_id:'model-coder'},
    {agent_id:'aria-agent-security-v1',role:'security',capabilities:['security'],scope:['reason'],max_risk:'low',status:'available',model_id:'model-security'},
    {agent_id:'aria-agent-memory-v1',role:'memory',capabilities:['memory'],scope:['reason'],max_risk:'low',status:'available',model_id:'model-memory'},
    {agent_id:'aria-agent-business-v1',role:'business',capabilities:['business'],scope:['reason'],max_risk:'low',status:'available',model_id:'model-business'},
    {agent_id:'aria-agent-device-v1',role:'device',capabilities:['device'],scope:['reason'],max_risk:'low',status:'available',model_id:'model-device'}
  ];
  const agents=adaptCatalog(rawCatalog);
  const coverage=catalogCoverage(agents);
  assert.equal(coverage.complete,true);
  const trace=[];
  const executors=Object.fromEntries(agents.map(a=>[a.id,async({task})=>{trace.push(a.id+':'+task.id);return{status:'succeeded',claim:'SAFE',evidence:a.id+'-verified'};} ]));
  const verifier=createVerifierV2();
  const verify=(results,arb)=>verifier.verify(results,arb).passed;
  const runtime=createMultiAgentRuntime({agents,executors,maxAgents:4,maxParallel:2,budget:20,verifier:verify});
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
    executors:{[agents[0].id]:async()=>({status:'succeeded',claim:'A',evidence:'agent-a'}),[agents[1].id]:async()=>({status:'succeeded',claim:'B',evidence:'agent-b'})},
    maxParallel:2,
    verifier:(results,arb)=>verifier.verify(results,arb).passed
  });
  const dissent=await dissentRuntime.run({goal:'detect disagreement',tasks:[{id:'d1',cost:1,claim:'A'},{id:'d2',cost:1,claim:'B'}]});
  assert.equal(dissent.status,'needs_review');
  assert.equal(dissent.decision.arbitration.agreement,'disagreement');
  assert.equal(verifier.verify(dissent.results,dissent.decision.arbitration).passed,false);

  console.log(JSON.stringify({status:'succeeded',marker:'ARIA_MULTI_AGENT_2_LIVE_OK',catalog_coverage:coverage,consensus:true,disagreement_detected:true,bounded_parallelism:true,verifier_fail_closed:true,trace,selected_agents:result.plan.agents.map(a=>a.id),plan_hash:result.plan.planHash,budget_used:result.budgetUsed},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
