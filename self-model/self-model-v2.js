'use strict';

const crypto=require('node:crypto');
const {buildSelfModel,diffSelfModel}=require('./system-state');
const {buildCapabilityGraph,bestCapability,diffCapabilityGraph,normalizeCapability}=require('./capability-graph-v2');

function stable(value){
  if(Array.isArray(value)) return '['+value.map(stable).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function hash(value){return crypto.createHash('sha256').update(stable(value)).digest('hex');}
function recentList(value){return Array.isArray(value)?value.slice(-50).map(x=>structuredClone(x)):[];}

function createSelfModelV2({identity='ARIA',canonicalEntrypoint='aria-canonical-runtime-v1',softwareVersion=null,capabilities=[],dependencies={},resources=[],tools=[],providers=[],router=null,memory=null,learning=null,planner=null,selfDevelopment=null,stateStore=null}={}){
  const staticBase=buildSelfModel({identity,canonicalEntrypoint,version:softwareVersion,capabilities:capabilities.map(c=>typeof c==='string'?c:c.id),dependencies:Object.keys(dependencies),providers,tools,agents:[],deployment:{}});
  let current=staticBase;

  function snapshot(extra={}){
    const graph=buildCapabilityGraph({capabilities,dependencies,tools,resources});
    const failures=recentList(extra.recent_failures || memory?.recent_failures || memory?.failures);
    const changes=recentList(extra.recent_changes || memory?.recent_changes || memory?.changes);
    const learningState=extra.learning || learning?.state || learning?.current || null;
    const doing=extra.current_activity ?? extra.currentActivity ?? null;
    const model=Object.freeze({
      version:'self-model-v2.0.0',identity:current.identity,canonical_entrypoint:current.canonical_entrypoint,software_version:current.software_version,
      what_i_can_do:Object.freeze(graph.nodes.filter(x=>['verified','active','available'].includes(x.status)).map(x=>x.capability)),
      what_i_cannot_do:Object.freeze(graph.nodes.filter(x=>['blocked','unavailable','deprecated'].includes(x.status)).map(x=>x.capability)),
      capabilities:Object.freeze(graph.nodes),capability_graph:graph,what_i_am_currently_doing:doing,
      resources:Object.freeze(recentList(extra.resources || resources)),tools:Object.freeze([...new Set(tools.map(String))].sort()),providers:Object.freeze([...new Set(providers.map(String))].sort()),
      verified_capabilities:Object.freeze(graph.nodes.filter(x=>x.status==='verified').map(x=>x.capability)),
      uncertain_capabilities:Object.freeze(graph.nodes.filter(x=>['uncertain','unknown','learning'].includes(x.status)).map(x=>x.capability)),
      what_changed_recently:Object.freeze(changes),what_i_am_learning:learningState,what_failed_recently:Object.freeze(failures),
      why_it_failed:Object.freeze(failures.map(f=>({id:f.id||null,reason:f.reason||f.error||null,capability:f.capability||null}))),
      authority:{router:Boolean(router),memory:Boolean(memory),learning:Boolean(learning),planner:Boolean(planner),self_development:Boolean(selfDevelopment)},generated_at:new Date().toISOString()
    });
    return Object.freeze({...model,integrity_hash:hash({...model,generated_at:undefined})});
  }
  function refresh(extra={}){const model=snapshot(extra);current=buildSelfModel({identity:model.identity,canonicalEntrypoint:model.canonical_entrypoint,version:model.software_version,capabilities:model.what_i_can_do,dependencies:model.capability_graph.edges.map(e=>`${e.from}->${e.to}`),providers:model.providers,tools:model.tools,deployment:{self_model_version:model.version}});return model;}
  function answer(question,extra={}){
    const m=refresh(extra); const q=String(question||'').toLowerCase();
    if(q.includes('who am i')||q.includes('quién soy')) return {answer:m.identity,model:m};
    if(q.includes('what can i do')||q.includes('qué puedo')) return {answer:m.what_i_can_do,model:m};
    if((q.includes('what can')&&q.includes("can't"))||q.includes('qué no puedo')) return {answer:m.what_i_cannot_do,model:m};
    if(q.includes('currently doing')||q.includes('haciendo')) return {answer:m.what_i_am_currently_doing,model:m};
    if(q.includes('resources')||q.includes('recursos')) return {answer:m.resources,model:m};
    if(q.includes('verified')) return {answer:m.verified_capabilities,model:m};
    if(q.includes('uncertain')) return {answer:m.uncertain_capabilities,model:m};
    if(q.includes('learning')) return {answer:m.what_i_am_learning,model:m};
    if(q.includes('failed')||q.includes('falló')||q.includes('fallo')) return {answer:m.why_it_failed,model:m};
    if(q.includes('changed')||q.includes('cambió')) return {answer:m.what_changed_recently,model:m};
    return {answer:m,model:m};
  }
  function capability(id,extra={}){const m=refresh(extra);return m.capabilities.find(x=>x.capability===id)||null;}
  function chooseBest(id,extra={}){
    const m=refresh(extra);
    const routerResolve=typeof router?.resolveCapability==='function'
      ? (cap)=>router.resolveCapability(cap)
      : typeof router?.route==='function'
        ? (cap)=>{ const result=router.route({capability:cap}); if(result) return result; return router.route(cap); }
        : null;
    return bestCapability(m.capability_graph,id,{routerResolve,minConfidence:extra.minConfidence??0});
  }
  function observe(event){if(stateStore?.append) stateStore.append(event);return event;}
  function compare(previous){const next=refresh();return Object.freeze({system:diffSelfModel(previous?.system||previous,current),capabilities:diffCapabilityGraph(previous?.capability_graph||previous?.capabilityGraph||{nodes:[]},next.capability_graph)});}
  return Object.freeze({snapshot,refresh,answer,capability,chooseBest,observe,compare,normalizeCapability,version:'self-model-v2.0.0'});
}
module.exports=Object.freeze({createSelfModelV2});
