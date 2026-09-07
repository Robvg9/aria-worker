/**
 * ARIA Intelligent Router lookup helpers — v1.1.
 * Pure, deterministic, secret-free. Selection is derived from existing registries.
 * Unknown dimensions are preserved as unknown and never converted into invented values.
 */
const modelLookup = require('../models/lookup.js');
const capLookup = require('../capabilities/lookup.js');
const accountLookup = require('../accounts/lookup.js');
const quotaLookup = require('../quota/lookup.js');
const registry = require('./registry.json');

const SELECTED='selected', NO_ROUTE='no_route', AVAILABLE_CAPACITY='available';
const BLOCKING_CAPACITY=new Set(['unavailable','exhausted','unknown']);
const BLOCKING_RATE_LIMIT=new Set(['unavailable','exhausted']);

function compareCandidates(a,b){return a.provider_id.localeCompare(b.provider_id)||a.account_id.localeCompare(b.account_id)||a.model_id.localeCompare(b.model_id);}
function capacityAllows(accountId,modelId){
  const cap=quotaLookup.getCapacity(accountId), quota=quotaLookup.getQuota(accountId);
  if(!cap||!quota)return false;
  if(cap.model_id&&cap.model_id!==modelId)return false;
  if(quota.model_id&&quota.model_id!==modelId)return false;
  if(BLOCKING_CAPACITY.has(cap.status)||BLOCKING_CAPACITY.has(quota.status))return false;
  if(quota.rate_limit&&BLOCKING_RATE_LIMIT.has(quota.rate_limit.status))return false;
  return cap.status===AVAILABLE_CAPACITY&&quota.status===AVAILABLE_CAPACITY;
}
function candidateEvidence(c){
  const model=modelLookup.getModel(c.model_id), quota=quotaLookup.getQuota(c.account_id);
  const evidence=[];
  let score=0;
  if(model?.status==='available'){score+=50;evidence.push('model_available');}
  if(quota?.status==='available'){score+=35;evidence.push('quota_available');}
  const path=model?.metadata?.access_path;
  if(path==='google_gemini_direct'){score+=10;evidence.push('direct_provider_path');}
  if(quota?.usage?.status==='observed'){score+=5;evidence.push('usage_observed');}
  const unknownDimensions=[];
  if(!quota?.rate_limit||quota.rate_limit.status==='unknown')unknownDimensions.push('rate_limit');
  unknownDimensions.push('cost','latency','risk_quality');
  return {score,evidence,unknown_dimensions:unknownDimensions};
}
function rankCandidates(candidates){
  return candidates.map(c=>({...c,...candidateEvidence(c)})).sort((a,b)=>b.score-a.score||compareCandidates(a,b));
}
function collectCandidates(capability){
  const modelIds=capLookup.modelsByCapability(capability), candidates=[];
  for(const modelId of modelIds){
    if(capLookup.supports(modelId,capability)!==true)continue;
    const model=modelLookup.getModel(modelId);
    if(!model||model.status!=='available')continue;
    const providerId=model.provider_id;
    for(const account of accountLookup.accountsForProvider(providerId)){
      if(!accountLookup.isActiveStatus(account))continue;
      if(Array.isArray(account.model_refs)&&account.model_refs.length>0&&!account.model_refs.includes(modelId))continue;
      if(!capacityAllows(account.account_id,modelId))continue;
      candidates.push({provider_id:providerId,account_id:account.account_id,model_id:modelId});
    }
  }
  return rankCandidates(candidates);
}
function applyPreferences(candidates,input){
  if(!candidates.length)return null;
  let pool=candidates;
  if(input.preferred_provider){const f=pool.filter(c=>c.provider_id===input.preferred_provider);if(f.length)pool=f;}
  if(input.preferred_account){const f=pool.filter(c=>c.account_id===input.preferred_account);if(f.length)pool=f;}
  if(input.preferred_model){const f=pool.filter(c=>c.model_id===input.preferred_model);if(f.length)pool=f;}
  return pool[0]||null;
}
function route(input){
  if(!input||typeof input!=='object')return {status:NO_ROUTE};
  const capability=input.capability;
  if(!capability||typeof capability!=='string'||capability.trim()==='')return {status:NO_ROUTE};
  const c=collectCandidates(capability.trim()), chosen=applyPreferences(c,input);
  if(!chosen)return {status:NO_ROUTE};
  return {status:SELECTED,provider_id:chosen.provider_id,account_id:chosen.account_id,model_id:chosen.model_id,capability:capability.trim(),score:chosen.score,selection_evidence:chosen.evidence,unknown_dimensions:chosen.unknown_dimensions};
}
module.exports={version:registry.version,route,collectCandidates,rankCandidates,candidateEvidence,capacityAllows,registry};
