'use strict';

const VERSION='aria-intelligent-router-v2.0.0';
const COMPLEXITY={low:0,medium:1,high:2,critical:3};
const RISK_ORDER={low:0,medium:1,high:2,critical:3};
const TASK_DOMAIN_RULES=[
  {domain:'coding',keywords:/\b(code|coding|debug|bug|refactor|program|implementation|typescript|javascript|sql|patch|fix)\b/i,roles:new Set(['coder'])},
  {domain:'research',keywords:/\b(research|investigate|sources|compare|literature|synthesis|analysis)\b/i,roles:new Set(['researcher'])},
  {domain:'planning',keywords:/\b(plan|planning|decompose|roadmap|architecture|break down)\b/i,roles:new Set(['planner'])},
  {domain:'verification',keywords:/\b(verify|verification|review|audit|test|regression|check)\b/i,roles:new Set(['reviewer','verifier'])},
  {domain:'security',keywords:/\b(security|threat|vulnerability|attack|secret|permission|auth)\b/i,roles:new Set(['security'])},
  {domain:'memory',keywords:/\b(memory|recall|remember|consolidate|knowledge)\b/i,roles:new Set(['memory'])},
  {domain:'device',keywords:/\b(device|windows|android|computer|hardware|diagnostic)\b/i,roles:new Set(['device'])},
  {domain:'business',keywords:/\b(business|strategy|sales|market|customer|pricing)\b/i,roles:new Set(['business'])}
];

function classifyTask(task,explicit){
  if(explicit&&COMPLEXITY[explicit]!==undefined)return explicit;
  const t=String(task||'').trim();
  if(/critical|production|irreversible|destructive|security|migration/i.test(t))return 'critical';
  if(/complex|architecture|multi[- ]step|debug|research|deep|audit/i.test(t)||t.length>240)return 'high';
  if(/write|summarize|classify|extract|transform|explain/i.test(t)||t.length>80)return 'medium';
  return 'low';
}

function domainsForTask(task){
  return TASK_DOMAIN_RULES.filter(x=>x.keywords.test(String(task||''))).map(x=>x.domain);
}

function riskAllowed(maxRisk,taskRisk){
  const a=RISK_ORDER[String(maxRisk||'medium')];const b=RISK_ORDER[String(taskRisk||'low')];
  return Number.isFinite(a)&&Number.isFinite(b)&&a>=b;
}

function numeric(value){return Number.isFinite(Number(value))?Number(value):null;}

function normalizeCandidate(c){
  const model=c?.model||c;const account=c?.account||{};const quota=c?.quota||{};const obs=c?.observation||{};const agents=Array.isArray(c?.agents)?c.agents:[];
  return {
    model_id:String(model.model_id||c.model_id||''),
    provider_id:String(model.provider_id||c.provider_id||''),
    status:String(model.status||'unknown'),
    enabled:model.enabled!==false,
    integration_status:String(model.integration_status||'unknown'),
    capability_verified:c?.capability_verified===true,
    live_verified:c?.live_verified===true,
    account_id:String(account.account_id||c.account_id||''),
    account_status:String(account.status||'unknown'),
    account_enabled:account.enabled!==false,
    quota_status:String(quota.status||'unknown'),
    rate_limit_status:String(quota.rate_limit_status||quota.rate_limit?.status||'unknown'),
    pricing:model.pricing||{},
    context_window:numeric(model.context_window),
    output_limit:numeric(model.output_limit),
    metadata:model.metadata||{},
    agents,
    observation:{
      attempts:numeric(obs.attempts)??0,
      successes:numeric(obs.successes)??0,
      avg_latency_ms:numeric(obs.avg_latency_ms),
      last_status:obs.last_status||null
    }
  };
}

function reliabilityScore(obs){
  const attempts=numeric(obs.attempts)??0;const successes=numeric(obs.successes)??0;
  if(attempts<=0)return {score:null,state:'unknown'};
  return {score:Math.max(0,Math.min(1,successes/attempts)),state:'observed',attempts,successes};
}

function freeCostScore(pricing){
  const tier=String(pricing?.tier||pricing?.billing_tier||'').toLowerCase();
  const cost=pricing?.cost;
  if(tier==='free'||cost==='$0'||cost===0)return 1;
  const input=numeric(pricing?.input_per_1m_tokens??pricing?.cost_per_1k_input_usd);
  const output=numeric(pricing?.output_per_1m_tokens??pricing?.cost_per_1k_output_usd);
  if(input===0&&output===0)return 1;
  if(input!==null||output!==null)return 0.5;
  return null;
}

function latencyScore(latency,allLatencies){
  if(!Number.isFinite(latency))return {score:null,state:'unknown'};
  const vals=allLatencies.filter(Number.isFinite);if(!vals.length)return {score:null,state:'unknown'};
  const min=Math.min(...vals),max=Math.max(...vals);if(max===min)return {score:1,state:'observed'};
  return {score:Number(((max-latency)/(max-min)).toFixed(6)),state:'observed'};
}

function specializationScore(candidate,domains){
  if(!domains.length)return {score:0.5,state:'neutral',matches:[]};
  const matches=candidate.agents.filter(a=>domains.some(d=>TASK_DOMAIN_RULES.find(x=>x.domain===d)?.roles.has(String(a.role||'')))).map(a=>a.agent_id);
  if(matches.length)return {score:1,state:'matched',matches};
  const generic=candidate.agents.some(a=>Array.isArray(a.capabilities)&&a.capabilities.includes('text_generation'));
  return {score:generic?0.45:0,state:generic?'generic':'none',matches:[]};
}

function select(candidates,input={}){
  const task=typeof input.task==='string'?input.task.trim():'';
  if(!task)return {status:'no_route',reason:'task_required',version:VERSION};
  const capability=typeof input.capability==='string'&&input.capability.trim()?input.capability.trim():'text_generation';
  const complexity=classifyTask(task,input.complexity);
  const taskRisk=String(input.risk||({low:'low',medium:'medium',high:'high',critical:'critical'}[complexity]));
  const domains=domainsForTask(task);
  const normalized=candidates.map(normalizeCandidate);
  const allLatencies=normalized.map(x=>x.observation.avg_latency_ms).filter(Number.isFinite);
  const rejected=[];const ranked=[];
  for(const c of normalized){
    const hard=[];
    if(!c.model_id||!c.provider_id||!c.account_id)hard.push('identity_incomplete');
    if(c.status!=='available'||!c.enabled)hard.push('model_unavailable');
    if(c.integration_status==='not_connected')hard.push('integration_not_connected');
    if(!c.capability_verified)hard.push('capability_not_verified');
    if(c.account_status!=='active'||!c.account_enabled)hard.push('account_inactive');
    if(['unavailable','exhausted'].includes(c.quota_status)||['unavailable','exhausted'].includes(c.rate_limit_status))hard.push('capacity_unavailable');
    if(!c.live_verified)hard.push('live_not_verified');
    if(c.context_window!==null&&task.length>0){
      const approxTokens=Math.ceil(task.length/4);
      if(c.context_window<approxTokens)hard.push('context_too_small');
    }
    if(c.agents.length){
      const eligibleAgents=c.agents.filter(a=>String(a.status||'available')==='available'&&riskAllowed(a.max_risk,taskRisk));
      if(!eligibleAgents.length)hard.push('no_agent_with_required_risk');
    }
    if(input.preferred_provider&&c.provider_id!==input.preferred_provider)hard.push('preferred_provider_mismatch');
    if(input.preferred_model&&c.model_id!==input.preferred_model)hard.push('preferred_model_mismatch');
    if(hard.length){rejected.push({model_id:c.model_id,provider_id:c.provider_id,reasons:hard});continue;}
    const rel=reliabilityScore(c.observation);const lat=latencyScore(c.observation.avg_latency_ms,allLatencies);const cost=freeCostScore(c.pricing);const spec=specializationScore(c,domains);
    const live=c.live_verified?1:0;const capabilityScore=c.capability_verified?1:0;const providerDirect=String(c.metadata?.access_path||'').includes('direct')?1:0.5;
    const score=
      live*0.20+
      capabilityScore*0.15+
      (rel.score===null?0.05:rel.score*0.20)+
      (lat.score===null?0.05:lat.score*0.15)+
      (cost===null?0.05:cost*0.10)+
      spec.score*0.15+
      providerDirect*0.05;
    const agents=c.agents.filter(a=>String(a.status||'available')==='available'&&riskAllowed(a.max_risk,taskRisk));
    const agent=agents.sort((a,b)=>String(a.agent_id).localeCompare(String(b.agent_id)))[0]||null;
    ranked.push({
      ...c,
      selected_agent_id:agent?.agent_id||null,
      selected_agent_role:agent?.role||null,
      score:Number(score.toFixed(6)),
      signals:{
        complexity,task_risk:taskRisk,domains,
        reliability:rel,latency:lat,cost_state:cost===null?'unknown':cost,specialization:spec,
        live_verified:live,capability_verified:capabilityScore,direct_path:providerDirect
      }
    });
  }
  ranked.sort((a,b)=>b.score-a.score||String(a.provider_id).localeCompare(String(b.provider_id))||String(a.model_id).localeCompare(String(b.model_id)));
  if(!ranked.length)return {status:'no_route',reason:'no_eligible_candidate',version:VERSION,complexity,task_risk:taskRisk,domains,rejected};
  const winner=ranked[0];
  const fallback=ranked.slice(1,4).map((x,i)=>({rank:i+2,provider_id:x.provider_id,account_id:x.account_id,model_id:x.model_id,agent_id:x.selected_agent_id,score:x.score}));
  return {
    status:'selected',version:VERSION,capability,task,complexity,task_risk:taskRisk,domains,
    selected:{provider_id:winner.provider_id,account_id:winner.account_id,model_id:winner.model_id,capability,agent_id:winner.selected_agent_id,agent_role:winner.selected_agent_role},
    score:winner.score,selection_evidence:winner.signals,fallback,
    candidates_considered:ranked.length,rejected_candidates:rejected
  };
}

function parallelPlan(tasks,{maxParallel=2,risk=null}={}){
  if(!Array.isArray(tasks)||!tasks.length)return {status:'no_plan',reason:'tasks_required',version:VERSION};
  const ids=new Set();for(const t of tasks){if(!t||!t.id||ids.has(String(t.id)))return{status:'blocked',reason:'duplicate_or_missing_task_id',version:VERSION};ids.add(String(t.id));}
  const normalized=tasks.map(t=>({...t,id:String(t.id),depends_on:Array.isArray(t.depends_on)?t.depends_on.map(String):[]}));
  for(const t of normalized)for(const d of t.depends_on)if(!ids.has(d)||d===t.id)return{status:'blocked',reason:'invalid_dependency',task_id:t.id,dependency:d,version:VERSION};
  const batches=[];const done=new Set();
  while(done.size<normalized.length){
    const ready=normalized.filter(t=>!done.has(t.id)&&t.depends_on.every(d=>done.has(d))).slice(0,Math.max(1,Math.floor(maxParallel)));
    if(!ready.length)return{status:'blocked',reason:'dependency_cycle',version:VERSION};
    batches.push(ready.map(t=>t.id));ready.forEach(t=>done.add(t.id));
  }
  return {status:'planned',version:VERSION,max_parallel:Math.max(1,Math.floor(maxParallel)),batches};
}

module.exports={VERSION,classifyTask,domainsForTask,riskAllowed,normalizeCandidate,reliabilityScore,select,parallelPlan};
