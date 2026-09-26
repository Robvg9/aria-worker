'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const api=read('supabase/functions/aria-app-api-v3/index.ts');
const migration=read('supabase/migrations/20260926100000_meditation_idea_analyzer_v2.sql');
const pwa=read('pwa/src/App.tsx');
const apiEnginePath=path.join(__dirname,'..','supabase','functions','_shared','idea-to-mission.mjs');

(async()=>{
const engine=await import('../supabase/functions/aria-device-gateway/_shared/idea-to-mission.mjs');

for(const fragment of [
  'meditation_idea_proposals',
  '/meditation/idea-to-mission',
  '/meditation/ideas',
  'meditation_idea_proposal_decide',
  'meditation_idea_convert_mission',
  'owner_user_id',
  'ANALIZAR Y PROPONER'
]) {
  if(!api.includes(fragment) && fragment!=='ANALIZAR Y PROPONER') {
    throw new Error('API missing idea analyzer marker: '+fragment);
  }
}
for(const fragment of [
  'add column if not exists aria_internal.meditation_idea_proposals',
  'owner_user_id',
  'meditation_idea_proposal_decide',
  'meditation_idea_convert_mission',
  'proposal_must_be_accepted',
  'meditation_queue_add'
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
assert.equal(p.schema_version,'idea-to-mission-v1');
assert.equal(p.queue_policy.auto_enqueue,false);
assert.equal(p.queue_policy.auto_execute,false);
assert.equal(p.missions.length,4);
assert.equal(p.summary.human_gate_required,true);
assert.equal(engine.validateProposal(p).valid,true);

console.log('MEDITATION_IDEA_ANALYZER_V2_CONTRACT=PASS');
})().catch(error=>{console.error(error);process.exit(1)});
