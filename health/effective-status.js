'use strict';
const EXECUTOR_TYPES = Object.freeze(["model","agent","device","connector","eas"]);
const SURFACES = Object.freeze(["pwa","device","runtime","provider","connector","agent","model","eas"]);
const VALID = new Set(["unknown","healthy","degraded","unavailable"]);
function normalizeObservation(input={}){
  const executor_type=EXECUTOR_TYPES.includes(String(input.executor_type))?String(input.executor_type):null;
  const surface=SURFACES.includes(String(input.surface))?String(input.surface):null;
  const status=VALID.has(String(input.status))?String(input.status):"unknown";
  return {executor_type,surface,status,evidence_ref:typeof input.evidence_ref==="string"?input.evidence_ref:null,observed_at:typeof input.observed_at==="string"?input.observed_at:null};
}
function deriveEffectiveStatus(observations=[],executor_type){
  const rows=observations.map(normalizeObservation).filter(x=>x.executor_type===executor_type);
  if(!rows.length)return {executor_type,status:"unknown",observed:false,evidence_refs:[]};
  const evidence_refs=rows.map(x=>x.evidence_ref).filter(Boolean);
  if(rows.some(x=>x.status==="unavailable"))return {executor_type,status:"unavailable",observed:true,evidence_refs};
  if(rows.some(x=>x.status==="degraded"))return {executor_type,status:"degraded",observed:true,evidence_refs};
  if(rows.every(x=>x.status==="healthy"))return {executor_type,status:"healthy",observed:true,evidence_refs};
  return {executor_type,status:"unknown",observed:true,evidence_refs};
}
function splitSurfaceStatus(observations=[]){
  const rows=observations.map(normalizeObservation);
  const out={};
  for(const surface of SURFACES){
    const r=rows.filter(x=>x.surface===surface);
    out[surface]=deriveSurface(r);
  }
  return out;
}
function deriveSurface(rows){
  if(!rows.length)return {status:"unknown",observed:false};
  if(rows.some(x=>x.status==="unavailable"))return {status:"unavailable",observed:true};
  if(rows.some(x=>x.status==="degraded"))return {status:"degraded",observed:true};
  if(rows.every(x=>x.status==="healthy"))return {status:"healthy",observed:true};
  return {status:"unknown",observed:true};
}
module.exports=Object.freeze({EXECUTOR_TYPES,SURFACES,normalizeObservation,deriveEffectiveStatus,splitSurfaceStatus});