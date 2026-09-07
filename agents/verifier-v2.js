'use strict';
const crypto=require('node:crypto');

const FORBIDDEN_KEYS=new Set(['secret','api_key','apiKey','token','authorization','password','private_key','credential']);
function walkNoSecrets(value){
  if(value===null||typeof value!=='object') return true;
  if(Array.isArray(value)) return value.every(walkNoSecrets);
  for(const [k,v] of Object.entries(value)){
    if(FORBIDDEN_KEYS.has(k)) return false;
    if(typeof v==='string' && /\b(?:sk-[A-Za-z0-9]{12,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/i.test(v)) return false;
    if(!walkNoSecrets(v)) return false;
  }
  return true;
}

function canonicalClaim(result){
  if(result?.claimHash) return String(result.claimHash);
  if(result?.claim!==undefined) return JSON.stringify(result.claim);
  if(result?.output!==undefined) return JSON.stringify(result.output);
  return JSON.stringify(result?.status ?? 'unknown');
}

function createVerifierV2({requiredEvidence=true,requireSuccess=true}={}){
  return Object.freeze({
    inspect(result={}){
      const checks={
        status:!requireSuccess || result.status==='succeeded',
        evidence:!requiredEvidence || Boolean(result.evidence),
        secrets:walkNoSecrets(result),
        agent:typeof result.agentId==='string' && result.agentId.length>0,
      };
      return {passed:Object.values(checks).every(Boolean),checks,claim:canonicalClaim(result),hash:crypto.createHash('sha256').update(canonicalClaim(result)).digest('hex')};
    },
    verify(results=[],arbitration={}){
      const reports=results.map(r=>this.inspect(r));
      const all=reports.every(r=>r.passed);
      const consensus=arbitration.agreement==='consensus';
      return {passed:all&&consensus,reports,consensus,agreement:arbitration.agreement||'none'};
    }
  });
}

module.exports={walkNoSecrets,canonicalClaim,createVerifierV2};
