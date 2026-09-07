'use strict';
const assert=require('node:assert/strict');
const {MODALITIES,createMultimodalRuntime}=require('../multimodal/runtime-v1');

(async()=>{
  const observed=[];
  const cognitionInputs=[];
  const perceivers=Object.fromEntries(MODALITIES.filter(m=>m!=='voice_output').map(modality=>[modality,async()=>{
    observed.push(modality);
    const base={confidence:0.95,provenance:{kind:'live-certification'},metadata:{adapter:'injected'}};
    if(modality==='voice_input'||modality==='audio') return {...base,transcript:'hola ARIA'};
    if(modality==='document') return {...base,document_text:'documento de prueba'};
    if(modality==='screenshot') return {...base,content_type:'ui',observations:['botón Guardar visible'],ui_state:{nodes:[{id:'save',role:'button',name:'Guardar',visible:true} ]}};
    return {...base,observations:[modality+' observation'],entities:[modality+' entity']};
  }]));
  const runtime=createMultimodalRuntime({perceivers,cognition:async(state)=>{cognitionInputs.push(state);return{accepted:true,modality:state.modality,state_hash:state.state_hash};}});
  for(const modality of MODALITIES.filter(m=>m!=='voice_output')){
    const result=await runtime.perceive({modality,source_ref:'live:'+modality});
    assert.equal(result.status,'succeeded');
    assert.equal(result.cognition.accepted,true);
    assert.equal(result.state.modality,modality);
    assert.equal(result.state.source_ref,'live:'+modality);
  }
  assert.equal(new Set(observed).size,6);
  assert.equal(cognitionInputs.length,6);
  const speakRuntime=createMultimodalRuntime({voiceRenderer:async(request)=>({transport:'mock-voice',accepted:true,request_hash:request.text.length})});
  const spoken=await speakRuntime.speak({text:'Respuesta verificada',voice:'es'});
  assert.equal(spoken.status,'succeeded');
  assert.equal(spoken.result.accepted,true);
  const noPerceiver=await createMultimodalRuntime().perceive({modality:'camera'});
  assert.equal(noPerceiver.status,'blocked');
  assert.equal(noPerceiver.reason,'perceiver_unavailable');
  const blockedSecret=await createMultimodalRuntime({perceivers:{image:async()=>({observations:['safe']})}}).perceive({modality:'image',metadata:{token:'ghp_123456789012345678901234'}});
  assert.equal(blockedSecret.status,'blocked');
  assert.equal(blockedSecret.reason,'secret_material_rejected');
  console.log(JSON.stringify({status:'succeeded',marker:'ARIA_MULTIMODAL_VOICE_1_LIVE_OK',modalities:MODALITIES,perception_to_state:true,state_to_cognition:true,voice_output:true,secret_fail_closed:true,observed,cognition_count:cognitionInputs.length},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
