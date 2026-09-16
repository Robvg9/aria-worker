'use strict';
const crypto=require('node:crypto');
const OUTCOMES=new Set(['VERIFIED','FAILED','BLOCKED']);
function canonical(value){
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
function hashEvidence(evidence){return crypto.createHash('sha256').update(canonical(evidence),'utf8').digest('hex')}
function validateEvidence(record){
  if(!record||typeof record!=='object') throw new TypeError('record required');
  for(const key of ['objective_id','mission_id','outcome']) if(!String(record[key]||'').trim()) throw new Error(`missing:${key}`);
  if(!OUTCOMES.has(record.outcome)) throw new Error(`invalid_outcome:${record.outcome}`);
  if(record.outcome==='VERIFIED'){
    if(!Array.isArray(record.tests)||record.tests.length===0) throw new Error('verified_requires_tests');
    if(!record.regression||record.regression.status!=='passed') throw new Error('verified_requires_regression');
    if(!record.verifier||record.verifier.status!=='passed') throw new Error('verified_requires_verifier');
    if(!Array.isArray(record.artifacts)||record.artifacts.length===0) throw new Error('verified_requires_artifacts');
  }
  return true;
}
function buildEvidenceRecord(input){
  validateEvidence(input);
  const base={...input, evidence_hash:undefined};
  base.evidence_hash=hashEvidence(base);
  return Object.freeze(base);
}
module.exports=Object.freeze({OUTCOMES,canonical,hashEvidence,validateEvidence,buildEvidenceRecord});
