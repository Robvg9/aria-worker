'use strict';

/**
 * OmniRoute Phase 9 — governed fallback / quota / circuit resilience.
 * Pure control-plane planning only. No provider call, retry, secret access,
 * clock-based cooldown inference, or success terminalization.
 */
const VERSION='aria-omniroute-resilience-v1.0.0';
const FAILURE_KINDS=new Set(['rate_limit','provider_unavailable','timeout','gateway_unavailable','quota_exhausted','circuit_open','invalid_response','execution_failure']);

function isRecord(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function key(x){return [x?.provider_id,x?.account_id,x?.model_id].map(v=>String(v||'')).join('|');}

function classifyFailure(error={}){
  const status=Number(error?.provider_status??error?.status??0);
  const code=String(error?.code||'').toLowerCase();
  const name=String(error?.name||'').toLowerCase();
  if(status===429||code==='rate_limit')return 'rate_limit';
  if(status===500||status===502||status===503||code==='provider_unavailable')return 'provider_unavailable';
  if(code==='timeout'||code==='timed_out'||name==='timeouterror')return 'timeout';
  if(code==='econnrefused'||code==='connection_refused'||code==='gateway_unavailable')return 'gateway_unavailable';
  if(code==='quota_exhausted'||error?.quota_exhausted===true)return 'quota_exhausted';
  if(code==='circuit_open'||error?.circuit_open===true)return 'circuit_open';
  if(code==='invalid_response'||error?.invalid_response===true)return 'invalid_response';
  return 'execution_failure';
}

function candidateEligible(candidate){
  if(!isRecord(candidate))return {ok:false,reasons:['candidate_not_object']};
  const reasons=[];
  if(!candidate.provider_id||!candidate.account_id||!candidate.model_id)reasons.push('identity_incomplete');
  if(candidate.availability_status!=='available')reasons.push('availability_not_available');
  if(candidate.quota_status!=='available')reasons.push('quota_not_available');
  if(candidate.circuit_status!=='closed')reasons.push('circuit_not_closed');
  if(candidate.cooldown_active===true)reasons.push('cooldown_active');
  if(candidate.enabled===false)reasons.push('disabled');
  return {ok:reasons.length===0,reasons};
}

function fallbackCandidates(primary,alternatives=[],failureKind='execution_failure',policy={}){
  const visited=new Set(Array.isArray(policy.visited)?policy.visited.map(String):[]);
  const primaryKey=key(primary);
  if(primaryKey)visited.add(primaryKey);
  if(!FAILURE_KINDS.has(failureKind))return {candidates:[],rejected:[{reasons:['failure_kind_invalid']}],version:VERSION};
  if(failureKind==='rate_limit'&&policy.allow_rate_limit_fallback!==true)return {candidates:[],rejected:[{reasons:['rate_limit_fallback_disabled']}],version:VERSION};
  const out=[];const rejected=[];
  for(const candidate of (Array.isArray(alternatives)?alternatives:[])){
    const k=key(candidate);
    const eligibility=candidateEligible(candidate);
    const reasons=[...eligibility.reasons];
    if(visited.has(k))reasons.push('already_visited');
    if(failureKind==='provider_unavailable'&&candidate.provider_id===primary?.provider_id)reasons.push('same_provider_after_provider_failure');
    if(failureKind==='gateway_unavailable'&&candidate.provider_id===primary?.provider_id)reasons.push('same_provider_after_gateway_failure');
    if(failureKind==='circuit_open'&&candidate.provider_id===primary?.provider_id)reasons.push('same_provider_circuit_open');
    if(failureKind==='quota_exhausted'&&candidate.account_id===primary?.account_id)reasons.push('same_account_after_quota_exhaustion');
    if(reasons.length){rejected.push({provider_id:candidate?.provider_id||null,account_id:candidate?.account_id||null,model_id:candidate?.model_id||null,reasons});continue;}
    out.push(candidate);
  }
  out.sort((a,b)=>String(a.provider_id).localeCompare(String(b.provider_id))||String(a.account_id).localeCompare(String(b.account_id))||String(a.model_id).localeCompare(String(b.model_id)));
  return {candidates:out,rejected,version:VERSION};
}

function planFallback(input){
  if(!isRecord(input))return {status:'no_fallback',reason:'input_required',version:VERSION};
  const primary=input.primary;
  const failureKind=classifyFailure(input.error||{});
  const visited=Array.isArray(input.visited)?input.visited.map(String):[];
  const result=fallbackCandidates(primary,input.alternatives,failureKind,{...input.policy,visited});
  if(!result.candidates.length){
    return {status:'no_fallback',outcome:'no_available_provider',failure_kind:failureKind,primary_key:key(primary),state:'provider_failed',rejected:result.rejected,version:VERSION};
  }
  const next=result.candidates[0];
  return {
    status:'fallback_available',
    failure_kind:failureKind,
    primary_key:key(primary),
    next:{provider_id:next.provider_id,account_id:next.account_id,model_id:next.model_id},
    remaining:result.candidates.slice(1).map(x=>({provider_id:x.provider_id,account_id:x.account_id,model_id:x.model_id})),
    state:'fallback_pending',
    rejected:result.rejected,
    version:VERSION
  };
}

module.exports={VERSION,FAILURE_KINDS,key,classifyFailure,candidateEligible,fallbackCandidates,planFallback};