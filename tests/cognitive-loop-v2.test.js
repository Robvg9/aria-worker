'use strict';
const assert=require('assert');
const {createCognitiveLoop}=require('../autonomy/cognitive-loop');
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
  const calls=[];
  const loop=createCognitiveLoop({
    memory:{search:async()=>[]},
    startMission:async()=>({mission:{mission_id:'parallel-cognitive'},result:{status:'succeeded'}}),
    reflect:async()=>{calls.push('reflect');await sleep(10);return'R';},
    learn:async(_e,r)=>{calls.push('learn:'+r);await sleep(80);return'L';},
    worldModel:async()=>{calls.push('world');await sleep(80);return'W';},
    confidence:async(_e,p)=>{calls.push('confidence:'+p.reflection);await sleep(80);return'C';},
    skillCompiler:async(_e,p)=>{calls.push('skill:'+p.learning);await sleep(10);return'S';}
  });
  const started=Date.now();
  const result=await loop.run({goal:'parallel postprocessing'});
  const elapsed=Date.now()-started;
  assert.equal(result.cognition.post.learning,'L');
  assert.equal(result.cognition.post.world_model,'W');
  assert.equal(result.cognition.post.confidence,'C');
  assert.equal(result.cognition.post.skill,'S');
  assert.deepStrictEqual(calls,['reflect','learn:R','world','confidence:R','skill:L']);
  assert(elapsed<180,'postprocessing did not overlap independent work: '+elapsed+'ms');
  console.log('cognitive-loop parallel contract: PASS');
})().catch(e=>{console.error(e);process.exit(1)});