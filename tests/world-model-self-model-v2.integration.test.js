'use strict';
const assert=require('node:assert/strict');
const {createWorldModelV2}=require('../memory/world-model-v2');
const {createSelfModelV2}=require('../self-model/self-model-v2');
const p=source=>({source,confidence:.95});
const world=createWorldModelV2({entities:[
  {id:'supabase',type:'platform',state:'available',provenance:p('registry')},
  {id:'fn_x',type:'function',state:'healthy',provenance:p('supabase')},
  {id:'db_y',type:'database',state:'healthy',provenance:p('supabase')},
  {id:'worker',type:'worker',state:'deployed',provenance:p('cloudflare')}
],dependencies:[
  {from:'worker',to:'fn_x',type:'depends_on',provenance:p('architecture')},
  {from:'db_y',to:'fn_x',type:'writes_to',provenance:p('schema')}
]});
const self=createSelfModelV2({identity:'ARIA',canonicalEntrypoint:'aria-canonical-runtime-v1',softwareVersion:'2.6.8',capabilities:[{id:'world_model_v2',status:'verified',confidence:1,reliability:1}],dependencies:{},worldModel:world});
const s=self.refresh();
assert.equal(s.authority.world_model,true);
assert.equal(s.world_model.version,'world-model-v2.0.0');
assert.equal(self.worldImpact('fn_x').count,2);
assert.deepEqual(self.explainWorldChange({entity_id:'fn_x',change:{state:'degraded'}}).affected_entities.map(x=>x.id),['worker','db_y'].sort());
assert.deepEqual(self.answer('World Model').answer.impacted.map(x=>x.entity_id),['db_y','worker'].sort());
const absent=createSelfModelV2();
assert.equal(absent.worldImpact('x').status,'unavailable');
assert.equal(absent.explainWorldChange({entity_id:'x'}).status,'unavailable');
console.log('WORLD MODEL → SELF-MODEL: PASS — read-only operational graph exposure and impact reasoning integration');
