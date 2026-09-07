'use strict';

const crypto = require('node:crypto');

const ROLES = Object.freeze([
  'planner','researcher','coder','security','reviewer','memory','business','device'
]);

const MODES = Object.freeze(['sequential','parallel']);
const STOP_REASONS = Object.freeze(['consensus','verified','budget','failure','human_gate_required','max_steps']);

function stableJson(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}

function hash(value){
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function normalizeAgent(agent){
  if(!agent || typeof agent!=='object' || !agent.id) throw new Error('agent_invalid');
  if(!ROLES.includes(agent.role)) throw new Error('agent_role_invalid');
  return Object.freeze({
    id: agent.id,
    role: agent.role,
    capabilities: Object.freeze([...(agent.capabilities||[])].map(String).sort()),
    reliability: Number.isFinite(agent.reliability) ? Math.max(0,Math.min(1,agent.reliability)) : 0.5,
    cost: Number.isFinite(agent.cost) ? Math.max(0,agent.cost) : 1,
    risk: agent.risk || 'low',
    available: agent.available !== false,
  });
}

function capabilityScore(agent, required=[]){
  if(!agent.available) return -Infinity;
  const set = new Set(agent.capabilities);
  const hits = required.filter(x=>set.has(x)).length;
  return hits * 10 + agent.reliability * 5 - agent.cost - (String(agent.risk).toLowerCase()==='high' ? 3 : 0);
}

function selectAgents({agents=[],requiredCapabilities=[],preferredRoles=[],maxAgents=3}={}){
  const normalized=agents.map(normalizeAgent);
  return normalized
    .filter(a=>a.available)
    .map(a=>({...a,score:capabilityScore(a,requiredCapabilities)+(preferredRoles.includes(a.role)?2:0)}))
    .sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id))
    .slice(0,Math.max(1,maxAgents));
}

function chooseMode({tasks=[],budget=Infinity,maxParallel=2}={}){
  if(tasks.length<=1) return 'sequential';
  const independent=tasks.every(t=>t && t.parallelizable !== false);
  const estimated=tasks.reduce((n,t)=>n+(Number(t.cost)||1),0);
  return independent && maxParallel>1 && estimated<=budget ? 'parallel' : 'sequential';
}

function buildPlan({goal,agents=[],tasks=[],requiredCapabilities=[],budget=10,maxAgents=3,maxParallel=2}={}){
  if(!goal) throw new Error('goal_required');
  const selected=selectAgents({agents,requiredCapabilities,maxAgents});
  if(!selected.length) return {status:'blocked',reason:'no_available_agent',goal};
  const mode=chooseMode({tasks,budget,maxParallel});
  const estimatedCost=tasks.reduce((n,t)=>n+(Number(t.cost)||1),0) + selected.reduce((n,a)=>n+a.cost,0);
  return Object.freeze({
    status: estimatedCost>budget ? 'blocked' : 'planned',
    reason: estimatedCost>budget ? 'budget_exceeded' : null,
    goal,
    mode,
    agents:selected.map(({score,...a})=>a),
    tasks:tasks.map((t,i)=>Object.freeze({id:t.id||`task-${i+1}`,...t})),
    estimatedCost,
    maxParallel,
    planHash:hash({goal,mode,agents:selected,tasks,estimatedCost}),
  });
}

function shouldStop({results=[],verified=false,budgetUsed=0,budget=Infinity,step=0,maxSteps=20,requireHumanGate=false}={}){
  if(requireHumanGate) return {stop:true,reason:'human_gate_required'};
  if(verified) return {stop:true,reason:'verified'};
  if(results.length && results.every(r=>r && r.status==='succeeded')){
    const verdicts=results.map(r=>r.verdict).filter(Boolean);
    if(verdicts.length && verdicts.every(v=>v==='agree')) return {stop:true,reason:'consensus'};
  }
  if(budgetUsed>=budget) return {stop:true,reason:'budget'};
  if(results.some(r=>r && r.status==='failed')) return {stop:true,reason:'failure'};
  if(step>=maxSteps) return {stop:true,reason:'max_steps'};
  return {stop:false,reason:null};
}

function arbitrate(results=[]){
  const valid=results.filter(Boolean);
  if(!valid.length) return {decision:'undetermined',agreement:'none',confidence:0,disagreements:[]};
  const buckets=new Map();
  for(const r of valid){
    const key=String(r.claimHash || r.claim || r.output || r.status || 'unknown');
    buckets.set(key,(buckets.get(key)||0)+1);
  }
  const ranked=[...buckets.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
  const [winner,count]=ranked[0];
  const confidence=count/valid.length;
  const disagreements=valid.filter(r=>String(r.claimHash || r.claim || r.output || r.status || 'unknown')!==winner).map(r=>r.agentId||r.id||'unknown');
  const agreement=ranked.length===1?'consensus':count*2>valid.length?'majority':'disagreement';
  return {decision:winner,agreement,confidence,disagreements};
}

function finalizeDecision({results=[],verifier=null,requireConsensus=false}={}){
  const arbitration=arbitrate(results);
  const verified=verifier ? verifier(results,arbitration) : arbitration.agreement==='consensus';
  if(requireConsensus && arbitration.agreement!=='consensus'){
    return {status:'blocked',reason:'consensus_required',arbitration,verified:false};
  }
  return {
    status: verified ? 'succeeded' : 'needs_review',
    decision: arbitration.decision,
    arbitration,
    verified: Boolean(verified),
  };
}

function createAgentManager({agents=[],verifier=null,budget=10,maxSteps=20,maxAgents=3,maxParallel=2}={}){
  return Object.freeze({
    plan(input={}){return buildPlan({...input,agents:input.agents||agents,budget:input.budget??budget,maxSteps:input.maxSteps??maxSteps,maxAgents:input.maxAgents??maxAgents,maxParallel:input.maxParallel??maxParallel});},
    stop(input={}){return shouldStop({...input,budget:input.budget??budget,maxSteps:input.maxSteps??maxSteps});},
    decide(results,opts={}){return finalizeDecision({results,verifier:opts.verifier||verifier,requireConsensus:opts.requireConsensus||false});},
  });
}

module.exports={ROLES,MODES,STOP_REASONS,stableJson,hash,normalizeAgent,selectAgents,chooseMode,buildPlan,shouldStop,arbitrate,finalizeDecision,createAgentManager};
