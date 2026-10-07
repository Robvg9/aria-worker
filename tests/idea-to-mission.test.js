'use strict';
const assert=require('node:assert/strict');
(async()=>{
  const engine=await import('../supabase/functions/aria-device-gateway/_shared/idea-to-mission.mjs');
  const p=await engine.buildIdeaMissionProposal('Quiero que ARIA cree un sistema para detectar errores y corregirlos con un nuevo agente antes de desplegar.');
  assert.equal(p.schema_version,'idea-to-mission-v3');
  assert.equal(p.queue_policy.auto_enqueue,false);
  assert.equal(p.queue_policy.auto_execute,false);
  assert.equal(p.summary.auto_enqueue,false);
  assert.equal(p.missions.length,1);
  assert.equal(p.missions[0].mission_id,'idea_mission_main');
  assert.equal(p.missions[0].plans.length,3);
  assert.equal(p.missions[0].plans[1].id,'plan_b');
  assert.equal(p.missions[0].plans[1].recommended,true);
  assert.ok(p.summary.human_explanation);
  assert.ok(p.summary.what_i_understood);
  assert.equal(p.summary.plan_count,3);
  assert.equal(engine.validateProposal(p).valid,true);
  const same=await engine.buildIdeaMissionProposal('  Quiero que ARIA cree un sistema para detectar errores y corregirlos con un nuevo agente antes de desplegar. ');
  assert.equal(same.fingerprint,p.fingerprint,'same idea must deduplicate');

  const human=await engine.buildIdeaMissionProposal('Quiero cambiar producción, pero necesito mi aprobación manual antes del merge.');
  assert.equal(human.classification.execution_state,'human_gate_or_governance_review');
  assert.equal(human.summary.human_gate_required,true);
  assert.equal(human.missions[0].plans.length,3);
  assert.equal(human.missions[0].plans[1].human_gate.enabled,true);

  const blocked=await engine.buildIdeaMissionProposal('Necesito pagar una suscripción y usar una nueva API key para hacer esto.');
  assert.equal(blocked.classification.viability,'viable_now');
  assert.equal(blocked.classification.execution_state,'blocked_payment_or_credential');
  assert.equal(blocked.missions.length,1);
  assert.ok(blocked.missions[0].blockers.some(x=>x.code==='PAYMENT_OR_CREDENTIAL'));

  const deferred=await engine.buildIdeaMissionProposal('Hazlo más adelante, cuando terminemos la fase actual.');
  assert.equal(deferred.classification.viability,'deferred');
  assert.equal(deferred.missions.length,1);

  const impossible=await engine.buildIdeaMissionProposal('Esto no es viable actualmente.');
  assert.equal(impossible.classification.viability,'not_viable_currently');
  assert.equal(impossible.missions.length,1);

  const invalid={...p,queue_policy:{...p.queue_policy,auto_enqueue:true}};
  assert.equal(engine.validateProposal(invalid).valid,false);
  console.log('IDEA -> MISSION V3 ENGINE: PASS');
})().catch(e=>{console.error(e);process.exit(1)});
