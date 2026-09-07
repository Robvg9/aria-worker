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
  const executors=Object.fromEntries(agents.map(a=>[a.id,async({task})=>{trace.push(a.id+':'+task.id);return{status:'succeeded',claim:task.claim||'SAFE',evidence:a.id+'-verified'};} ]));
  const verifier=createVerifierV2();
  const verify=(results,arb)=>verifier.verify(results,arb).passed;
  let learned=0;
  const runtime=createMultiAgentRuntime({agents,executors,maxAgents:4,maxParallel:2,budget:20,verifier:verify,learning:async()=>{learned++;}});
  const result=await runtime.run({
    goal:'certify coordinated internal decision',
    requiredCapabilities:['security','review'],
    tasks:[
      {id:'security-check',assignedAgentId:'aria-agent-security-v1',cost:2,claim:'SAFE',parallelizable:true},
      {id:'review-check',assignedAgentId:'aria-agent-reviewer-v1',cost:1,claim:'SAFE',parallelizable:true},
      {id:'planner-check',assignedAgentId:'aria-agent-planner-v1',cost:1,claim:'SAFE',parallelizable:true},
      {id:'research-check',assignedAgentId:'aria-agent-research-v1',cost:1,claim:'SAFE',parallelizable:true}
    ]
  });
  assert.equal(result.status,'succeeded');
  assert.equal(result.decision.verified,true);
  assert.equal(result.decision.arbitration.agreement,'consensus');
  assert.equal(result.plan.mode,'parallel');
  assert.ok(result.plan.agents.length<=4);
  assert.ok(result.budgetUsed<=20);
  assert.equal(learned,1);

  let gateCalls=0;
  const gatedRuntime=createMultiAgentRuntime({agents:agents.slice(0,2),executors:{[agents[0].id]:async()=>{gateCalls++;return{status:'succeeded',claim:'WRITE'}}},maxParallel:2});
  const gated=await gatedRuntime.run({goal:'protected write',tasks:[{id:'gate',cost:1,requireHumanGate:true}]});
  assert.equal(gated.status,'blocked');
  assert.equal(gated.reason,'human_gate_required');
  assert.equal(gateCalls,0);

  const recoveryRuntime=createMultiAgentRuntime({
    agents:[agents.find(a=>a.id==='aria-agent-planner-v1'),agents.find(a=>a.id==='aria-agent-research-v1')],
    executors:{
      'aria-agent-planner-v1':async()=>({status:'failed',claim:'TEMP_FAILURE'}),
      'aria-agent-research-v1':async()=>({status:'succeeded',claim:'RECOVERED',evidence:'researcher-recovery-verified'})
    },
    maxAgents:2,maxParallel:1,maxAttempts:2,budget:10,
    verifier:results=>results.length===1&&results[0].status==='succeeded'
  });
  const recovered=await recoveryRuntime.run({goal:'recover through another agent',tasks:[{id:'recover',cost:1,parallelizable:false}]});
  assert.equal(recovered.status,'succeeded');
  assert.equal(recovered.results[0].agentId,'aria-agent-research-v1');
  assert.equal(recovered.results[0].attempt,2);
  assert.equal(recovered.attempts.length,2);

  const dissentRuntime=createMultiAgentRuntime({
    agents:[agents.find(a=>a.id==='aria-agent-planner-v1'),agents.find(a=>a.id==='aria-agent-reviewer-v1')],
    executors:{
      'aria-agent-planner-v1':async()=>({status:'succeeded',claim:'A',evidence:'planner'}),
      'aria-agent-reviewer-v1':async()=>({status:'succeeded',claim:'B',evidence:'reviewer'})
    },
    maxParallel:2,
    verifier:(results,arb)=>verifier.verify(results,arb).passed
  });
  const dissent=await dissentRuntime.run({goal:'detect disagreement',tasks:[
    {id:'d1',assignedAgentId:'aria-agent-planner-v1',cost:1,claim:'A',parallelizable:true},
    {id:'d2',assignedAgentId:'aria-agent-reviewer-v1',cost:1,claim:'B',parallelizable:true}
  ]});
  assert.equal(dissent.status,'needs_review');
  assert.equal(dissent.decision.arbitration.agreement,'disagreement');
  assert.equal(verifier.verify(dissent.results,dissent.decision.arbitration).passed,false);

  const budgetRuntime=createMultiAgentRuntime({agents:[agents[0]],executors:{[agents[0].id]:async()=>({status:'succeeded',claim:'X',evidence:'e'})},budget:5});
  const budget=await budgetRuntime.run({goal:'budget blocked',tasks:[{id:'x',cost:8,claim:'X'},{id:'y',cost:8,claim:'X'}]});
  assert.equal(budget.status,'blocked');
  assert.equal(budget.reason,'budget_exceeded');

  console.log(JSON.stringify({status:'succeeded',marker:'ARIA_MULTI_AGENT_2_LIVE_OK',catalog_coverage:coverage,consensus:true,disagreement_detected:true,human_gate_fail_closed:true,internal_escalation:true,bounded_parallelism:true,budget_guard:true,learning_called_once:true,verifier_fail_closed:true,trace,selected_agents:result.plan.agents.map(a=>a.id),plan_hash:result.plan.planHash,budget_used:result.budgetUsed},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
