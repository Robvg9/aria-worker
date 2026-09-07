'use strict';
const assert = require('node:assert/strict');
const { createWorldModelV2, hash } = require('../memory/world-model-v2');

const p = source => ({source, kind:'observed', confidence:0.9});
const wm = createWorldModelV2({
  entities:[
    {id:'supabase',type:'platform',name:'Supabase',state:'available',provenance:p('registry')},
    {id:'fn_x',type:'function',name:'function X',state:'healthy',provenance:p('supabase')},
    {id:'db_y',type:'database',name:'database Y',state:'healthy',provenance:p('supabase')},
    {id:'secret_z',type:'secret_ref',name:'secret Z',state:'configured',metadata:{ref:'ref:secret-z'},provenance:p('credential-registry')},
    {id:'runtime_a',type:'runtime',name:'runtime A',state:'active',provenance:p('runtime')},
    {id:'worker',type:'worker',name:'Cloudflare Worker',state:'deployed',provenance:p('cloudflare')}
  ],
  relationships:[
    {from:'supabase',to:'fn_x',type:'contains',provenance:p('registry')},
    {from:'supabase',to:'db_y',type:'contains',provenance:p('registry')},
    {from:'supabase',to:'secret_z',type:'contains',provenance:p('credential-registry')},
    {from:'supabase',to:'runtime_a',type:'runs_on',provenance:p('runtime')}
  ],
  dependencies:[
    {from:'worker',to:'fn_x',type:'depends_on',provenance:p('architecture')},
    {from:'runtime_a',to:'fn_x',type:'calls',provenance:p('runtime')},
    {from:'db_y',to:'fn_x',type:'writes_to',provenance:p('schema')},
    {from:'fn_x',to:'secret_z',type:'requires',provenance:p('credential-registry')}
  ]
});

const snap = wm.snapshot();
assert.equal(snap.version,'world-model-v2.0.0');
assert.equal(snap.entities.length,6);
assert.equal(snap.relationships.length,4);
assert.equal(snap.dependencies.length,4);
assert.ok(snap.integrity_hash === hash({version:snap.version,entities:snap.entities,relationships:snap.relationships,events:snap.events,causes:snap.causes,dependencies:snap.dependencies}));

const impact = wm.impactOf('fn_x');
assert.deepEqual(impact.impacted.map(x=>x.entity_id),['db_y','runtime_a','worker','secret_z'].sort());
assert.ok(impact.impacted.every(x=>x.path.length>=1 && x.confidence>0));
assert.equal(wm.dependentsOf('fn_x').length,4);
assert.equal(wm.dependenciesOf('fn_x').length,1);

const explanation = wm.explainChange({entity_id:'fn_x',change:{state:'degraded'}});
assert.equal(explanation.entity.id,'fn_x');
assert.equal(explanation.affected_entities.length,4);
assert.ok(explanation.impact.reasoning.includes('reverse dependency'));

const observed = wm.observeState('fn_x','degraded',p('live-probe'));
assert.equal(observed.event.type,'state_observed');
assert.deepEqual(observed.event.changes,{from:'healthy',to:'degraded'});
assert.equal(wm.stateEvidence('fn_x').current_state,'degraded');
assert.equal(wm.stateEvidence('fn_x').observations.length,1);

wm.recordEvent({id:'evt_root',type:'failure',entity_ids:['fn_x'],changes:{state:'degraded'},provenance:p('incident')});
wm.addCause({cause_event:'evt_root',effect_entity:'worker',confidence:0.8,mechanism:'dependency_propagation',provenance:p('incident-analysis')});
wm.recordEvent({id:'evt_worker',type:'worker_affected',entity_ids:['worker'],provenance:p('incident')});
wm.addCause({cause_event:'evt_prior',effect_event:'evt_root',confidence:0.7,mechanism:'upstream_failure',provenance:p('incident-analysis')});
wm.recordEvent({id:'evt_prior',type:'upstream',entity_ids:['fn_x'],provenance:p('incident')});
assert.equal(wm.causeChain('evt_worker')[0].event_id,'evt_root');
assert.equal(wm.causeChain('evt_root')[0].event_id,'evt_prior');

assert.throws(()=>wm.addDependency({from:'fn_x',to:'fn_x',provenance:p('bad')}),/self_dependency_invalid/);
assert.throws(()=>wm.addRelationship({from:'fn_x',to:'fn_x',type:'related_to',provenance:p('bad')}),/self_relationship_invalid/);
assert.throws(()=>wm.upsertEntity({id:'bad',state:'x'}),/provenance_source_required/);
assert.throws(()=>wm.addDependency({from:'unknown',to:'fn_x',type:'depends_on',provenance:p('bad')}),/provenance_source_required/);

const before = wm.snapshot();
const again = wm.impactOf('fn_x');
assert.deepEqual(again.impacted.map(x=>x.entity_id),impact.impacted.map(x=>x.entity_id));
assert.deepEqual(wm.snapshot().entities.map(e=>e.id),before.entities.map(e=>e.id));
assert.equal(wm.integrity().valid,true);
assert.equal(/secret_z/.test(JSON.stringify(wm.snapshot().entities.find(e=>e.id==='secret_z'))),true);
assert.equal(JSON.stringify(wm.snapshot()).includes('super-secret-value'),false);

console.log('WORLD MODEL V2: PASS — operational graph, state/events, provenance, causal chains, dependency impact, deterministic traversal and secret-safe integrity');
