'use strict';

/** OmniRoute Phase 11 — ARIA-governed security boundary. */
const {isCredentialRef}=require('../execution/credentials.js');
const {redact}=require('./redactor.js');
const VERSION='aria-omniroute-security-v1.0.0';
const DEFAULT_MIN_TIMEOUT=100;
const DEFAULT_MAX_TIMEOUT=120000;
const DEFAULT_MAX_INPUT_BYTES=262144;

function isRecord(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function parseHttpUrl(value){
  if(typeof value!=='string'||!value.trim())return null;
  try{return new URL(value.trim());}catch{return null;}
}
function isLoopbackHost(host){
  const h=String(host||'').toLowerCase().replace(/^\[|\]$/g,'');
  return h==='localhost'||h==='127.0.0.1'||h==='::1'||h==='0:0:0:0:0:0:0:1';
}
function validateGatewayEndpoint(endpoint){
  const url=parseHttpUrl(endpoint);
  if(!url)return {ok:false,reason:'endpoint_invalid'};
  if(url.protocol!=='http:')return {ok:false,reason:'endpoint_protocol_denied'};
  if(url.username||url.password)return {ok:false,reason:'endpoint_userinfo_denied'};
  if(!isLoopbackHost(url.hostname))return {ok:false,reason:'endpoint_non_loopback_denied'};
  if(!url.pathname.endsWith('/chat/completions'))return {ok:false,reason:'endpoint_path_denied'};
  return {ok:true,host:url.hostname,port:url.port||'default',path:url.pathname};
}
function validateProviderAllowlist(providerId,allowlist=[]){
  if(typeof providerId!=='string'||!providerId.trim())return {ok:false,reason:'provider_id_required'};
  if(!Array.isArray(allowlist)||allowlist.length===0)return {ok:false,reason:'provider_allowlist_required'};
  const normalized=[...new Set(allowlist.map(String).map(x=>x.trim()).filter(Boolean))];
  return normalized.includes(providerId.trim())?{ok:true}:{ok:false,reason:'provider_not_allowlisted'};
}
function validateCredentialBoundary(credentialRef){
  if(typeof credentialRef!=='string'||!credentialRef.trim())return {ok:false,reason:'credential_ref_required'};
  return isCredentialRef(credentialRef.trim())?{ok:true}:{ok:false,reason:'credential_ref_invalid'};
}
function validateTimeout(timeoutMs,{min=DEFAULT_MIN_TIMEOUT,max=DEFAULT_MAX_TIMEOUT}={}){
  const n=Number(timeoutMs);
  if(!Number.isFinite(n)||!Number.isInteger(n))return {ok:false,reason:'timeout_invalid'};
  if(n<min||n>max)return {ok:false,reason:'timeout_out_of_bounds'};
  return {ok:true,value:n};
}
function validateInputPayload(payload,{maxBytes=DEFAULT_MAX_INPUT_BYTES}={}){
  if(payload===undefined||payload===null)return {ok:false,reason:'input_missing'};
  let text;try{text=typeof payload==='string'?payload:JSON.stringify(payload);}catch{return {ok:false,reason:'input_not_serializable'};}
  const bytes=Buffer.byteLength(text,'utf8');
  if(bytes>maxBytes)return {ok:false,reason:'input_too_large',bytes,max_bytes:maxBytes};
  return {ok:true,bytes};
}
function validateOrigin(origin,allowedOrigins=[]){
  if(typeof origin!=='string'||!origin.trim())return {ok:false,reason:'origin_required'};
  if(!Array.isArray(allowedOrigins)||allowedOrigins.length===0)return {ok:false,reason:'allowed_origins_required'};
  const value=origin.trim();
  if(value==='*')return {ok:false,reason:'wildcard_origin_denied'};
  return allowedOrigins.map(String).includes(value)?{ok:true}:{ok:false,reason:'origin_not_allowlisted'};
}
function sanitizeProviderError(error){
  const input=isRecord(error)?{...error}:String(error??'');
  if(isRecord(input)){
    const out={};
    for(const [key,value] of Object.entries(input)){
      if(['secret','api_key','authorization','credential','token','password'].includes(String(key).toLowerCase()))continue;
      out[key]=redact(value);
    }
    return out;
  }
  return redact(input);
}
function assessProviderOutput(output){
  const text=typeof output==='string'?output:JSON.stringify(output??'');
  const suspicious=/\b(ignore (?:all|any) previous instructions|reveal (?:the )?(?:system|developer) prompt|send (?:the )?(?:secret|api key)|disable security|bypass (?:the )?authorization|run this command)\b/i.test(text);
  return {trusted:false,contains_suspicious_instruction:suspicious,execution_authority:'none',reason:'provider_output_is_untrusted'};
}
function validateSecurityConfig(config={}){
  if(!isRecord(config))return {status:'blocked',reason:'config_required',version:VERSION};
  const endpoint=validateGatewayEndpoint(config.gateway_endpoint);
  if(!endpoint.ok)return {status:'blocked',reason:endpoint.reason,version:VERSION};
  const provider=validateProviderAllowlist(config.provider_id,config.provider_allowlist);
  if(!provider.ok)return {status:'blocked',reason:provider.reason,version:VERSION};
  const credential=validateCredentialBoundary(config.credential_ref);
  if(!credential.ok)return {status:'blocked',reason:credential.reason,version:VERSION};
  const timeout=validateTimeout(config.timeout_ms,config.timeout_bounds);
  if(!timeout.ok)return {status:'blocked',reason:timeout.reason,version:VERSION};
  const origin=validateOrigin(config.origin,config.allowed_origins);
  if(!origin.ok)return {status:'blocked',reason:origin.reason,version:VERSION};
  const input=validateInputPayload(config.input,config.input_limits);
  if(!input.ok)return {status:'blocked',reason:input.reason,version:VERSION};
  if(config.encrypted_storage_required===true&&config.encrypted_storage_verified!==true)return {status:'blocked',reason:'encrypted_storage_not_verified',version:VERSION};
  return {status:'allowed',version:VERSION,controls:{endpoint:'loopback_only',provider_allowlist:'pass',credential_ref_only:'pass',timeout_ms:timeout.value,origin:'allowlisted',input_bytes:input.bytes,encrypted_storage:config.encrypted_storage_required===true?'verified':'not_required'}};
}

module.exports={VERSION,DEFAULT_MIN_TIMEOUT,DEFAULT_MAX_TIMEOUT,DEFAULT_MAX_INPUT_BYTES,isLoopbackHost,validateGatewayEndpoint,validateProviderAllowlist,validateCredentialBoundary,validateTimeout,validateInputPayload,validateOrigin,sanitizeProviderError,assessProviderOutput,validateSecurityConfig};