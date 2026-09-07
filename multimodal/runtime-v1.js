'use strict';

const crypto = require('node:crypto');

const MODALITIES = Object.freeze(['voice_input','voice_output','image','screenshot','camera','document','audio']);
const CONTENT_TYPES = Object.freeze(['text','audio','image','document','ui']);
const SENSITIVITY = Object.freeze(['public','internal','sensitive','unknown']);

function stableJson(value){
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}
function hash(value){ return crypto.createHash('sha256').update(stableJson(value)).digest('hex'); }
function containsSecretLike(value){
  const text=typeof value==='string'?value:stableJson(value);
  return /(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----|bearer\s+[A-Za-z0-9._-]{16,})/i.test(text);
}
function assertKnownModality(modality){ if(!MODALITIES.includes(modality)) throw new Error('modality_invalid'); }
function normalizeConfidence(value){ return Number.isFinite(value)?Math.max(0,Math.min(1,value)):null; }
function normalizePerception(input){
  if(!input||typeof input!=='object') throw new Error('perception_invalid');
  assertKnownModality(input.modality);
  if(containsSecretLike(input)) throw new Error('secret_material_rejected');
  const observations=Array.isArray(input.observations)?input.observations.map(String):[];
  const entities=Array.isArray(input.entities)?input.entities.map(String):[];
  const metadata=input.metadata&&typeof input.metadata==='object'?{...input.metadata}:{};
  delete metadata.raw_bytes;
  delete metadata.audio_bytes;
  delete metadata.image_bytes;
  delete metadata.file_bytes;
  const contentType=CONTENT_TYPES.includes(input.content_type)?input.content_type:('screenshot'===input.modality?'ui':input.modality==='voice_input'||input.modality==='audio'||input.modality==='voice_output'?'audio':input.modality==='document'?'document':'image');
  const state={
    state_version:'aria-multimodal-state-v1.0',
    modality:input.modality,
    content_type:contentType,
    source_ref:input.source_ref?String(input.source_ref):null,
    observations,
    entities,
    transcript:input.transcript!=null?String(input.transcript):null,
    document_text:input.document_text!=null?String(input.document_text):null,
    ui_state:input.ui_state&&typeof input.ui_state==='object'?structuredClone(input.ui_state):null,
    confidence:normalizeConfidence(input.confidence),
    provenance:input.provenance&&typeof input.provenance==='object'?structuredClone(input.provenance):null,
    sensitivity:SENSITIVITY.includes(input.sensitivity)?input.sensitivity:'unknown',
    metadata
  };
  if(containsSecretLike(state)) throw new Error('secret_material_rejected');
  state.state_hash=hash(state);
  return Object.freeze(state);
}

function createMultimodalRuntime({perceivers={},cognition=null,voiceRenderer=null}={}){
  return Object.freeze({
    async perceive(input){
      if(!input||!input.modality) return {status:'blocked',reason:'modality_missing'};
      assertKnownModality(input.modality);
      const adapter=perceivers[input.modality];
      if(typeof adapter!=='function') return {status:'blocked',reason:'perceiver_unavailable',modality:input.modality};
      const perception=await adapter(input);
      const state=normalizePerception({...perception,modality:input.modality});
      let cognitionResult=null;
      if(typeof cognition==='function') cognitionResult=await cognition(state);
      return {status:'succeeded',state,cognition:cognitionResult};
    },
    async speak({text,voice=null,format='text',metadata={}}={}){
      if(typeof text!=='string'||!text.trim()) return {status:'blocked',reason:'voice_text_missing'};
      const request={version:'aria-voice-output-v1.0',text:text.trim(),voice:voice?String(voice):null,format:String(format),metadata:{...metadata}};
      if(containsSecretLike(request)) return {status:'blocked',reason:'secret_material_rejected'};
      if(typeof voiceRenderer!=='function') return {status:'blocked',reason:'voice_renderer_unavailable',request};
      const result=await voiceRenderer(request);
      return {status:'succeeded',request,result};
    }
  });
}

module.exports={MODALITIES,CONTENT_TYPES,SENSITIVITY,stableJson,hash,containsSecretLike,normalizePerception,createMultimodalRuntime};
