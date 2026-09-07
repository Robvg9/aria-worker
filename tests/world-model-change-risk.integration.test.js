'use strict';
const assert=require('node:assert/strict');
const {createWorldModelV2}=require('../memory/world-model-v2');
const {analyzeChangeRisk}=require('../self-development/change-risk-analyzer-v2');
const p=s=>({source:s,confidence:.9});
const world=createWorldModelV2({entities:[
 {id:'fn_x',type:'function',provenance:p('supabase')},
 {id:'worker',type:'worker',provenance:p('cloudflare')},
 {id:'db_y',type:'database',provenance:p('schema')},
 {id:'runtime_a',type:'runtime',provenance:p('runtime')}
],dependencies:[
 {from:'worker',to:'fn_x',type:'depends_on',provenance:p('architecture')},
 {from:'db_y',to:'fn_x',type:'writes_to',provenance:p('schema')},
 {from:'runtime_a',to:'fn_x',type:'calls',provenance:p('runtime')}
]});
const risk=analyzeChangeRisk({changes:[{type:'modify_file',path:'supabase/functions/fn_x.ts',entity_id:'fn_x'}],worldModel:world});
const finding=risk.changes[0];
assert.equal(risk.max_risk,'high');
assert.equal(risk.approval_requirement,'elevated_review');
assert.ok(finding.reasons.includes('world_model_impact'));
assert.equal(finding.world_impact.count,3);
assert.deepEqual(finding.world_impact.impacted.map(x=>x.entity_id),['db_y','runtime_a','worker'].sort());
assert.equal(analyzeChangeRisk({changes:[{type:'modify_file',path:'x.js'}]}).max_risk,'medium');
console.log('WORLD MODEL → CHANGE RISK: PASS — dependency impact elevates governed change analysis without execution authority');
