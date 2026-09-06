'use strict';
function createTrustEnvelope({actor_id,capabilities=[],max_risk='low',expires_at=null,correlation_id}={}){if(!actor_id||!correlation_id)throw new Error('trust_envelope_identity_required');return Object.freeze({version:1,actor_id,capabilities:[...new Set(capabilities)],max_risk,expires_at,correlation_id});}
function authorizeEnvelope(env,request={}){if(!env||!request.capability||!env.capabilities.includes(request.capability))return{allowed:false,reason:'capability_denied'};if(request.risk&&request.risk!=='low'&&env.max_risk==='low')return{allowed:false,reason:'risk_exceeded'};if(env.expires_at&&Date.parse(env.expires_at)<=Date.now())return{allowed:false,reason:'trust_expired'};return{allowed:true,reason:'trusted'};}
module.exports={createTrustEnvelope,authorizeEnvelope};
