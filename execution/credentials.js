'use strict';

/**
 * ARIA Execution Engine — Credential Resolution boundary.
 *
 * Accepts only governed credential references. Concrete stores are injected;
 * this module never reads host configuration or secrets directly.
 */
const CREDENTIAL_RESOLVER_NOTE = 'CREDENTIAL RESOLVER NOT IMPLEMENTED';
const RESOLVED='resolved';
const UNAVAILABLE='unavailable';

function isCredentialRef(ref){
  return typeof ref==='string' && /^(?:secret|env):\/\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?$/.test(ref.trim());
}

const nullCredentialResolver=Object.freeze({resolver_id:'null',resolve(){return{status:UNAVAILABLE,reason:CREDENTIAL_RESOLVER_NOTE};}});
function normalizeResolution(result){if(!result||typeof result!=='object')return{status:UNAVAILABLE,reason:'resolver_invalid_result'};if(result.status===RESOLVED){if(typeof result.secret!=='string'||!result.secret.length)return{status:UNAVAILABLE,reason:'resolver_empty_secret'};return{status:RESOLVED,secret:result.secret};}return{status:UNAVAILABLE,reason:typeof result.reason==='string'?result.reason:'unavailable'};}
async function resolveCredential(credentialRef,resolver){if(!isCredentialRef(credentialRef))return{status:UNAVAILABLE,reason:'credential_ref_invalid'};const r=resolver&&typeof resolver.resolve==='function'?resolver:nullCredentialResolver;let out;try{out=await r.resolve(credentialRef);}catch{return{status:UNAVAILABLE,reason:'resolver_error'}}return normalizeResolution(out);}
module.exports={CREDENTIAL_RESOLVER_NOTE,RESOLVED,UNAVAILABLE,isCredentialRef,nullCredentialResolver,resolveCredential};
