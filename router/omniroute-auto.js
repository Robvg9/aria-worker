'use strict';

/**
 * OmniRoute Phase 8 — governed Auto-Combo / Intelligent Routing.
 * ARIA owns the allowed set and constraints. This selector may only choose
 * one provider/account/model from that pre-authorized set.
 */
const crypto = require('node:crypto');
const MODES = new Set(['auto','auto/coding','auto/fast','auto/cheap','auto/offline']);
const VERSION = 'aria-omniroute-auto-combo-v1.0.0';
const EVIDENCE_SOURCE = 'aria.router.allowed_set';

function isRecord(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function num(v){return Number.isFinite(Number(v))?Number(v):null;}

function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(isRecord(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function decisionHash(value){return crypto.createHash('sha256').update(canonical(value)).digest('hex');}

function reject(reason,extra={}){return {status:'no_route',reason,version:VERSION,...extra};}

function normalizeRoute(route,index){
  if(!isRecord(route))return {ok:false,reasons:['route_not_object'],index};
  const providerId=String(route.provider_id||'').trim();
  const accountId=String(route.account_id||'').trim();
  const modelId=String(route.model_id||'').trim();
  const capability=String(route.capability||'').trim();
  const evidence=isRecord(route.evidence)?route.evidence:{};
  const tags=Array.isArray(route.tags)?route.tags.map(String):[];
  const evidenceId=String(evidence.evidence_id||'').trim();
  const targetId=String(evidence.target_id||'').trim();
  const reasons=[];
  if(!providerId||!accountId||!modelId)reasons.push('identity_incomplete');
  if(capability!=='text_generation')reasons.push('capability_not_allowed');
  if(route.allowed!==true)reasons.push('route_not_authorized');
  if(route.availability_status!=='available')reasons.push('availability_not_verified');
  if(evidence.source!==EVIDENCE_SOURCE)reasons.push('evidence_source_invalid');
  if(!evidenceId)reasons.push('evidence_id_missing');
  if(!targetId)reasons.push('target_id_missing');
  if(targetId!==String(route.task_id||targetId))reasons.push('route_target_mismatch');
  if(evidence.provider_id!==providerId)reasons.push('evidence_provider_mismatch');
  if(evidence.model_id!==modelId)reasons.push('evidence_model_mismatch');
  return {ok:reasons.length===0,reasons,index,provider_id:providerId,account_id:accountId,model_id:modelId,capability,
    latency_ms:num(route.latency_ms),cost_usd:num(route.cost_usd),offline:route.offline===true,local:route.local===true,tags,evidence_id:evidenceId,target_id:targetId};
}

function modeCompatible(route,mode){
  if(mode==='auto')return true;
  if(mode==='auto/coding')return route.tags.includes('coding');
  if(mode==='auto/fast')return route.latency_ms!==null;
  if(mode==='auto/cheap')return route.cost_usd!==null;
  if(mode==='auto/offline')return route.offline===true&&route.local===true;
  return false;
}

function constraintsCompatible(route,constraints){
  if(!isRecord(constraints))return {ok:true,reasons:[]};
  const reasons=[];
  if(constraints.max_latency_ms!==undefined&&(route.latency_ms===null||route.latency_ms>Number(constraints.max_latency_ms)))reasons.push('max_latency_exceeded');
  if(constraints.max_cost_usd!==undefined&&(route.cost_usd===null||route.cost_usd>Number(constraints.max_cost_usd)))reasons.push('max_cost_exceeded');
  if(constraints.preferred_provider&&route.provider_id!==String(constraints.preferred_provider))reasons.push('preferred_provider_mismatch');
  if(constraints.preferred_model&&route.model_id!==String(constraints.preferred_model))reasons.push('preferred_model_mismatch');
  return {ok:reasons.length===0,reasons};
}

function score(route,mode){
  if(mode==='auto/fast')return route.latency_ms===null?Number.POSITIVE_INFINITY:route.latency_ms;
  if(mode==='auto/cheap')return route.cost_usd===null?Number.POSITIVE_INFINITY:route.cost_usd;
  return 0;
}

function selectAuto(input){
  if(!isRecord(input))return reject('input_required');
  const taskId=String(input.task_id||'').trim();
  const task=String(input.task||'').trim();
  const capability=String(input.capability||'').trim();
  const mode=String(input.mode||'auto').trim();
  if(!taskId)return reject('task_id_required');
  if(!task)return reject('task_required');
  if(capability!=='text_generation')return reject('capability_not_supported');
  if(!MODES.has(mode))return reject('mode_not_supported');
  if(!Array.isArray(input.allowed_routes)||!input.allowed_routes.length)return reject('allowed_set_required');

  const normalized=input.allowed_routes.map((x,i)=>normalizeRoute(x,i));
  const rejected=[];const eligible=[];
  for(const route of normalized){
    if(!route.ok){rejected.push({index:route.index,model_id:route.model_id||null,reasons:route.reasons});continue;}
    if(!modeCompatible(route,mode)){rejected.push({index:route.index,model_id:route.model_id,reasons:['mode_not_compatible']});continue;}
    const c=constraintsCompatible(route,input.constraints);
    if(!c.ok){rejected.push({index:route.index,model_id:route.model_id,reasons:c.reasons});continue;}
    eligible.push(route);
  }
  if(!eligible.length)return reject('no_eligible_allowed_route',{task_id:taskId,mode,rejected});

  eligible.sort((a,b)=>score(a,mode)-score(b,mode)||a.provider_id.localeCompare(b.provider_id)||a.account_id.localeCompare(b.account_id)||a.model_id.localeCompare(b.model_id));
  const winner=eligible[0];
  const evidence={
    source:EVIDENCE_SOURCE,
    target_id:taskId,
    task,
    capability,
    mode,
    provider_id:winner.provider_id,
    account_id:winner.account_id,
    model_id:winner.model_id,
    evidence_id:winner.evidence_id,
    candidate_count:eligible.length,
    selection_rule:mode==='auto/fast'?'lowest_observed_latency':mode==='auto/cheap'?'lowest_observed_cost':mode==='auto/coding'?'coding_tag_then_stable_id':mode==='auto/offline'?'offline_local_then_stable_id':'stable_id'
  };
  const decision={status:'selected',version:VERSION,route_type:'omniroute_auto_combo',task_id:taskId,capability,mode,
    selected:{provider_id:winner.provider_id,account_id:winner.account_id,model_id:winner.model_id},
    selection_evidence:evidence,decision_hash:null,candidates_considered:eligible.length,rejected_candidates:rejected};
  decision.decision_hash=decisionHash({task_id:taskId,capability,mode,selected:decision.selected,selection_evidence:evidence});
  return decision;
}

module.exports={VERSION,MODES,EVIDENCE_SOURCE,canonical,decisionHash,normalizeRoute,modeCompatible,constraintsCompatible,selectAuto};