'use strict';
const assert=require('node:assert/strict');
const {validateGraph,readySteps,topologicalBatches}=require('../autonomy/mission-graph');
const {runMissionGraph}=require('../autonomy/orchestrator-v3');
const {normalizeCommand,requiresApproval}=require('../interfaces/aria-command');
const {updateReputation,rankAgents}=require('../agents/reputation');
const {gradeTrace}=require('../evaluation/trace-grader');

(async()=>{
 const graph=[{id:'a'},{id:'b'},{id:'c',depends_on:['a','b']}];
 assert.equal(validateGraph(graph).valid,true);assert.deepEqual(readySteps(graph,[]).map(x=>x.id).sort(),['a','b']);assert.deepEqual(topologicalBatches(graph),[['a','b'],['c']]);assert.equal(validateGraph([{id:'a',depends_on:['a']}]).reason,'dependency_missing_or_self');
 const events=[];const out=await runMissionGraph({missionId:'m',steps:graph,maxParallel:2,execute:async step=>({status:'succeeded',step_id:step.id}),onEvent:async e=>events.push(e)});assert.equal(out.status,'completed');assert.equal(out.completed_steps.length,3);assert.equal(events.filter(e=>e.type==='step_succeeded').length,3);
 assert.equal(normalizeCommand({request_id:'r',command:'status'}).risk,'read');assert.equal(requiresApproval('mission.cancel'),true);assert.throws(()=>normalizeCommand({request_id:'r',command:'unknown'}),/command_not_supported/);
 assert.equal(updateReputation(.5,'success',.5),.75);assert.equal(rankAgents([{id:'a',reputation:.4},{id:'b',reputation:.9}])[0].id,'b');
 assert.equal(gradeTrace({expectedOperations:['read','write'],events:[{operation:'read'},{operation:'write'}]}).passed,true);assert.equal(gradeTrace({expectedOperations:['write'],events:[{operation:'write',status:'succeeded',risk:'high',approval_verified:false}]}).passed,false);
 console.log('ORCHESTRATION V3 TESTS PASS');
})().catch(e=>{console.error(e);process.exit(1)});
