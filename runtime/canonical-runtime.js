'use strict';
const registry = require("./canonical-registry.json");
const STAGES = Object.freeze(registry.stage_order);
const SURFACES = new Set(registry.failure_surfaces);
const EXECUTOR_TYPES = new Set(["model","agent","device","connector","eas"]);
function canonicalStage(stage){
  if(!STAGES.includes(stage)) throw new Error(`unknown_canonical_stage:${stage}`);
  return registry.canonical_chain[stage];
}
function assertCanonicalChain(chain=registry.canonical_chain){
  for(let i=0;i<STAGES.length;i++){
    const name=chain[STAGES[i]];
    if(typeof name!=="string"||!name) throw new Error(`missing_canonical_stage:${STAGES[i]}`);
    if(registry.legacy_prefixes.some(p=>name.startsWith(p)) && !registry.legacy_exceptions.includes(name)){
      throw new Error(`legacy_stage_forbidden:${name}`);
    }
  }
  return true;
}
function classifyFailure({surface,executor_type,stage,code}={}){
  const ex=EXECUTOR_TYPES.has(String(executor_type))?String(executor_type):null;
  const s=SURFACES.has(String(surface))?String(surface):"runtime";
  return {surface:s,executor_type:ex,stage:STAGES.includes(String(stage))?String(stage):null,code:code?String(code).slice(0,160):null};
}
function effectiveExecutorStatus(observations=[],executor_type){
  if(!EXECUTOR_TYPES.has(String(executor_type))) throw new Error("unknown_executor_type");
  const relevant=observations.filter(x=>x&&x.executor_type===executor_type);
  if(!relevant.length) return {status:"unknown",observations:0};
  if(relevant.some(x=>x.status==="unavailable")) return {status:"unavailable",observations:relevant.length};
  if(relevant.some(x=>x.status==="degraded")) return {status:"degraded",observations:relevant.length};
  if(relevant.every(x=>x.status==="healthy")) return {status:"healthy",observations:relevant.length};
  return {status:"unknown",observations:relevant.length};
}
assertCanonicalChain();
module.exports=Object.freeze({registry,STAGES,canonicalStage,assertCanonicalChain,classifyFailure,effectiveExecutorStatus});