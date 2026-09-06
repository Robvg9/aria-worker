'use strict';
const assert=require('node:assert/strict');
const {createAutonomousMissionOrchestrator}=require('../autonomy/orchestrator');

(async()=>{
 const storeState={mission_id:'m_parallel',status:'queued',current_step:0,completed_steps:0,checkpoint:{}};
 const store={
  async get(){return structuredClone(storeState);},
  async transition(_id,status,patch={}){Object.assign(storeState,{status,...patch});return structuredClone(storeState);},
  async checkpoint(_id,checkpoint,patch={}){storeState.checkpoint=structuredClone(checkpoint);Object.assign(storeState,patch);return structuredClone(storeState);}
 };
 let active=0,maxActive=0;
 const planner=async()=>[
  {id:'a',action:'a',operation:'noop',risk:'low',depends_on:[]},
  {id:'b',action:'b',operation:'noop',risk:'low',depends_on:[]},
  {id:'c',action:'c',operation:'noop',risk:'low',depends_on:['a','b']}
 ];
 const executor=async({step})=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,15));active--;return {status:'succeeded',step:step.id};};
 const verify=async()=>true;
 const o=createAutonomousMissionOrchestrator({missionStore:store,planner,executor,verify,policy:{enabled:true,max_risk:'low',max_parallel:2,max_runtime_ms:5000}});
 const result=await o.run('m_parallel');
 assert.equal(result.status,'succeeded');
 assert.equal(maxActive,2);
 assert.deepEqual(new Set(storeState.checkpoint.completed_steps),new Set(['a','b','c']));
 assert.equal(storeState.completed_steps,3);
 console.log('ORCHESTRATOR PARALLEL GRAPH: PASS — bounded concurrency + dependency gate');
})().catch(e=>{console.error(e);process.exit(1)});
