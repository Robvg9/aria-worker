'use strict';

const EXPECTED_ROLES = Object.freeze({
  'aria-agent-planner-v1':'planner',
  'aria-agent-reviewer-v1':'reviewer',
  'aria-agent-research-v1':'researcher',
  'aria-agent-coding-v1':'coder',
  'aria-agent-security-v1':'security',
  'aria-agent-memory-v1':'memory',
  'aria-agent-business-v1':'business',
  'aria-agent-device-v1':'device',
});

function adaptCatalogAgent(item){
  if(!item || typeof item!=='object') throw new Error('catalog_agent_invalid');
  const id=String(item.agent_id||'');
  if(!EXPECTED_ROLES[id]) throw new Error('catalog_agent_unrecognized');
  if(String(item.status||'')!=='available') return null;
  return Object.freeze({
    id,
    role:EXPECTED_ROLES[id],
    capabilities:Object.freeze([...(item.capabilities||[])].map(String).sort()),
    scope:Object.freeze([...(item.scope||[])].map(String).sort()),
    risk:item.max_risk||'low',
    cost:Number.isFinite(item.cost)?Math.max(0,item.cost):1,
    reliability:Number.isFinite(item.reliability)?Math.max(0,Math.min(1,item.reliability)):0.5,
    model_id:item.model_id||null,
    available:true,
    catalog_source:'aria_agent_catalog'
  });
}

function adaptCatalog(items=[]){
  if(!Array.isArray(items)) return [];
  return items.map(adaptCatalogAgent).filter(Boolean).sort((a,b)=>a.id.localeCompare(b.id));
}

function catalogCoverage(agents=[]){
  const ids=new Set(agents.map(a=>a.id));
  const missing=Object.keys(EXPECTED_ROLES).filter(id=>!ids.has(id));
  const roleSet=new Set(agents.map(a=>a.role));
  return {expected:8,available:agents.length,missing,roles:[...roleSet].sort(),complete:missing.length===0};
}

module.exports={EXPECTED_ROLES,adaptCatalogAgent,adaptCatalog,catalogCoverage};
