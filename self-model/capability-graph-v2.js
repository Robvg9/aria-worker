'use strict';

const STATUS = Object.freeze(new Set(['verified','available','active','uncertain','unknown','unavailable','blocked','deprecated','learning']));
const RISK = Object.freeze(new Set(['unknown','low','medium','high','critical','destructive']));

function arr(value){ return Array.isArray(value) ? value : []; }
function uniqStrings(value){ return [...new Set(arr(value).map(String).map(s=>s.trim()).filter(Boolean))].sort(); }
function clampConfidence(value){ return Number.isFinite(value) ? Math.max(0, Math.min(1, Number(value))) : null; }
function normalizeCapability(input={}){
  if(typeof input==='string') return normalizeCapability({id:input});
  const id=String(input.id||input.capability||'').trim();
  if(!id) throw new TypeError('capability_id_required');
  const status=STATUS.has(input.status)?input.status:'unknown';
  const confidence=clampConfidence(input.confidence);
  const risk=RISK.has(input.risk)?input.risk:'unknown';
  return Object.freeze({
    capability:id,
    status,
    confidence,
    last_verified:input.last_verified??null,
    evidence: input.evidence??null,
    dependencies:Object.freeze(uniqStrings(input.dependencies)),
    cost:input.cost??null,
    risk,
    reliability:clampConfidence(input.reliability),
    source:input.source??null,
    regression_test_id:input.regression_test_id??null,
    notes:input.notes??null
  });
}

function buildCapabilityGraph({capabilities=[], dependencies={}, tools=[], resources=[]}={}){
  const records=new Map();
  for(const item of arr(capabilities)){
    const r=normalizeCapability(item); records.set(r.capability,r);
  }
  for(const [id,deps] of Object.entries(dependencies||{})){
    const base=records.get(id)||normalizeCapability({id,status:'unknown'});
    records.set(id,Object.freeze({...base,dependencies:Object.freeze(uniqStrings([...(base.dependencies||[]),...arr(deps)]))}));
  }
  const nodes=[...records.values()].sort((a,b)=>a.capability.localeCompare(b.capability));
  const edges=[];
  for(const node of nodes) for(const dep of node.dependencies) edges.push(Object.freeze({from:node.capability,to:dep}));
  return Object.freeze({version:'capability-graph-v2.0.0',nodes:Object.freeze(nodes),edges:Object.freeze(edges),tools:Object.freeze(uniqStrings(tools)),resources:Object.freeze(uniqStrings(resources))});
}

function bestCapability(graph, requiredCapability, {routerResolve=null, minConfidence=0}={}){
  const target=String(requiredCapability||'').trim();
  if(!target) return Object.freeze({status:'no_capability',reason:'capability_required'});
  const local=graph?.nodes?.filter(x=>x.capability===target)||[];
  let candidates=local.filter(x=>['verified','active','available'].includes(x.status) && (x.confidence===null || x.confidence>=minConfidence));
  let route=null;
  if(typeof routerResolve==='function') route=routerResolve(target);
  if(route?.status==='selected') return Object.freeze({status:'selected',capability:target,route,evidence:local});
  if(candidates.length){candidates=[...candidates].sort((a,b)=>(b.confidence??-1)-(a.confidence??-1)||((b.reliability??-1)-(a.reliability??-1)));return Object.freeze({status:'selected',capability:target,capability_record:candidates[0],route:route||null,evidence:local});}
  if(local.length) return Object.freeze({status:'uncertain',capability:target,capability_record:local[0],route:route||null});
  return Object.freeze({status:'missing',capability:target,route:route||null});
}

function diffCapabilityGraph(previous,current){
  const a=new Map((previous?.nodes||[]).map(x=>[x.capability,x])); const b=new Map((current?.nodes||[]).map(x=>[x.capability,x]));
  const added=[],removed=[],changed=[];
  for(const id of b.keys()) if(!a.has(id)) added.push(id); else if(JSON.stringify(a.get(id))!==JSON.stringify(b.get(id))) changed.push(id);
  for(const id of a.keys()) if(!b.has(id)) removed.push(id);
  return Object.freeze({added:added.sort(),removed:removed.sort(),changed:changed.sort(),unchanged:!added.length&&!removed.length&&!changed.length});
}

module.exports=Object.freeze({STATUS,RISK,normalizeCapability,buildCapabilityGraph,bestCapability,diffCapabilityGraph});
