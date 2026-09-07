'use strict';
const assert=require('node:assert/strict');
const {createSelfModelV2}=require('../self-model/self-model-v2');
const {aggregateMissionTelemetry}=require('../evaluation/engine-v2');

const missions=Array.from({length:100},(_,i)=>({id:`browser-${i+1}`,capability:'browser',status:i===97?'failed':'succeeded',verified:i!==97,recovered:i===98,attempts:i%8===0?2:1,failure_mode:i===97?'timeout':null}));
const agg=aggregateMissionTelemetry(missions,'browser');
const evaluation={reliabilityFor:capability=>capability==='browser'?agg.reliability:null};
const model=createSelfModelV2({identity:'ARIA',capabilities:[
  {id:'browser',status:'verified',confidence:.99,reliability:null,evidence:{source:'evaluation-engine-v2'}},
  {id:'external_multi_ia',status:'blocked',confidence:0,reliability:0}
],evaluation});
const snapshot=model.refresh({current_activity:{mission_id:'eval-phase3',state:'running'}});
assert.equal(snapshot.authority.evaluation_engine,true);
assert.equal(snapshot.reliability_by_capability.browser.missions,100);
assert.equal(snapshot.reliability_by_capability.browser.success_rate,.99);
assert.equal(snapshot.reliability_by_capability.browser.verification_rate,.99);
assert.equal(snapshot.reliability_by_capability.browser.failure_modes.timeout,1);
assert.ok(snapshot.reliability_by_capability.browser.score>=0&&snapshot.reliability_by_capability.browser.score<=1);
assert.equal(model.answer('What is my reliability?').answer.browser.missions,100);
console.log('EVALUATION → SELF-MODEL INTEGRATION: PASS — longitudinal reliability is exposed back into ARIA Self-Model');
