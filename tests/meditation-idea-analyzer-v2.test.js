'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const api=read('supabase/functions/aria-app-api-v3/index.ts');
const migration=read('supabase/migrations/20261007110000_meditation_idea_analyzer_v3_single_plan.sql');
const pwa=read('pwa/src/App.tsx');
const apiEnginePath=path.join(__dirname,'..','supabase','functions','_shared','idea-to-mission.mjs');

(async()=>{
const engine=await import('../supabase/functions/aria-device-gateway/_shared/idea-to-mission.mjs');

for(const fragment of [
  'meditation_idea_proposals',
  '/meditation/idea-to-mission',
  '/meditation/ideas',
  'meditation_idea_proposal_decide',
  'meditation_idea_convert_mission_v3',
  'owner_user_id'
]) {
  if(!api.includes(fragment)) throw new Error('API missing idea analyzer marker: '+fragment);
}
for(const fragment of [
  'ANALIZAR Y PROPONER',
  'ELIGE UNA RUTA',
  'Plan A · Mínimo',
  'Plan B · Equilibrado',
  'Plan C · Robusto',
  'const [ideaText, setIdeaText] = useState',
  'const [ideaBusy, setIdeaBusy] = useState',
  'const [ideaError, setIdeaError] = useState',
  "const [ideaProposals, setIdeaProposals] = useState<any[]>(() => readCached('meditation_ideas', session.userId) ?? [])"
]) {
  if(!pwa.includes(fragment)) throw new Error('PWA missing idea analyzer marker: '+fragment);
}
for(const fragment of [
  'create or replace function aria_internal.meditation_idea_convert_mission_v3',
  'idea-to-mission-v3',
  'p_plan_id',
  'idea_plan_id',
  'meditation_queue_add',
  'proposal_not_v3'
]) assert.ok(migration.includes(fragment),'migration missing '+fragment);

for(const fragment of [
  'ANALIZADOR DE IDEAS',
  'ANALIZAR Y PROPONER',
  'NO AUTOENCOLADA',
  'NO AUTOEJECUTA',
  '/meditation/ideas/',
  '/convert'
]) assert.ok(pwa.includes(fragment),'PWA missing analyzer marker: '+fragment);

const p=await engine.buildIdeaMissionProposal('Quiero que ARIA mejore el sistema de diagnósticos y necesito mi aprobación antes de modificar producción.');
assert.equal(p.schema_version,'idea-to-mission-v3');
assert.equal(p.queue_policy.auto_enqueue,false);
assert.equal(p.queue_policy.auto_execute,false);
assert.equal(p.missions.length,1);
assert.equal(p.summary.human_gate_required,true);
assert.equal(p.missions[0].plans.length,3);
assert.equal(engine.validateProposal(p).valid,true);

console.log('MEDITATION_IDEA_ANALYZER_V2_CONTRACT=PASS');
})().catch(error=>{console.error(error);process.exit(1)});
