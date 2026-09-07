'use strict';
const assert=require('node:assert/strict');
const {MODALITIES,normalizePerception,createMultimodalRuntime,containsSecretLike}=require('../multimodal/runtime-v1');

(async()=>{
  assert.deepEqual([...MODALITIES],['voice_input','voice_output','image','screenshot','camera','document','audio']);
  assert.equal(containsSecretLike('hello world'),false);
  assert.throws(()=>normalizePerception(null),/perception_invalid/);
  assert.throws(()=>normalizePerception({modality:'unknown'}),/modality_invalid/);
  assert.throws(()=>normalizePerception({modality:'image',observations:['Bearer abcdefghijklmnop']}),/secret_material_rejected/);

  const state=normalizePerception({modality:'screenshot',content_type:'ui',source_ref:'screen-1',observations:['button Save visible'],entities:['Save'],ui_state:{nodes:[{id:'n1',role:'button',name:'Save',visible:true}]},confidence:0.91,provenance:{kind:'injected-test'},sensitivity:'internal',metadata:{viewport:'1080x1920',raw_bytes:'REMOVED'}});
  assert.equal(state.state_version,'aria-multimodal-state-v1.0');
  assert.equal(state.modality,'screenshot');
  assert.equal(state.content_type,'ui');
  assert.equal(state.confidence,0.91);
  assert.equal(state.metadata.raw_bytes,undefined);
  assert.equal(typeof state.state_hash,'string');
  assert.equal(state.state_hash.length,64);

  const seen=[];
  const runtime=createMultimodalRuntime({
    perceivers:{
      voice_input:async()=>({transcript:'abre el archivo',confidence:0.98,provenance:{kind:'speech'},metadata:{language:'es'}}),
      image:async()=>({observations:['logo visible'],entities:['logo'],confidence:0.9,provenance:{kind:'vision'}}),
      screenshot:async()=>({content_type:'ui',observations:['Save button visible'],ui_state:{nodes:[{id:'save',role:'button',name:'Save',visible:true}]} ,confidence:0.97,provenance:{kind:'vision+ui'}}),
      camera:async()=>({observations:['person visible'],entities:['person'],confidence:0.88,provenance:{kind:'camera'}}),
      document:async()=>({document_text:'Título del documento',observations:['one page'],confidence:0.94,provenance:{kind:'document'}}),
      audio:async()=>({transcript:'audio transcrito',confidence:0.86,provenance:{kind:'audio'}})
    },
    cognition:async(state)=>{seen.push(state.modality);return{route:'planner',state_hash:state.state_hash};}
  });
  for(const modality of ['voice_input','image','screenshot','camera','document','audio']){
    const result=await runtime.perceive({modality,source_ref:modality+'-src'});
    assert.equal(result.status,'succeeded');
    assert.equal(result.state.modality,modality);
    assert.equal(result.cognition.route,'planner');
  }
  assert.deepEqual(seen,['voice_input','image','screenshot','camera','document','audio']);

  const unsupported=await runtime.perceive({modality:'voice_output',source_ref:'tts'});
  assert.equal(unsupported.status,'blocked');
  assert.equal(unsupported.reason,'perceiver_unavailable');

  const spoken=[];
  const speechRuntime=createMultimodalRuntime({voiceRenderer:async(req)=>{spoken.push(req);return{played:false,provider:'mock'};}});
  const speak=await speechRuntime.speak({text:'Hola Robert',voice:'es',format:'text',metadata:{channel:'assistant'}});
  assert.equal(speak.status,'succeeded');
  assert.equal(spoken[0].version,'aria-voice-output-v1.0');
  assert.equal(spoken[0].text,'Hola Robert');
  assert.equal(spoken[0].voice,'es');
  assert.equal(speechRuntime.speak, speechRuntime.speak);
  const noRenderer=await createMultimodalRuntime().speak({text:'Hola'});
  assert.equal(noRenderer.status,'blocked');
  assert.equal(noRenderer.reason,'voice_renderer_unavailable');
  const empty=await speechRuntime.speak({text:'   '});
  assert.equal(empty.reason,'voice_text_missing');
  const secretSpeak=await speechRuntime.speak({text:'Bearer abcdefghijklmnop'});
  assert.equal(secretSpeak.status,'blocked');
  assert.equal(secretSpeak.reason,'secret_material_rejected');

  let cognitionCalled=false;
  const failClosed=createMultimodalRuntime({perceivers:{image:async()=>({observations:['safe']})},cognition:async()=>{cognitionCalled=true;throw new Error('should-not-run');}});
  const secret=await failClosed.perceive({modality:'image'}).catch(()=>null);
  assert.equal(cognitionCalled,false);
  void secret;

  console.log('MULTIMODAL V1: PASS — modalities, structured state, perception→cognition, voice output boundary, security and fail-closed behavior');
})().catch(e=>{console.error(e);process.exitCode=1});
