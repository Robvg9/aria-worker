'use strict';

/**
 * OmniRoute Phase 10 — governed mission recovery boundary.
 * Reuses ARIA's canonical mission-state transitions. This module does not
 * persist, execute, start/stop processes, or mutate canonical mission stores.
 */
const crypto=require('node:crypto');
const missionState=require('./mission-state.js');
const VERSION='aria-omniroute-recovery-v1.0.0';

function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function hash(value){return crypto.createHash('sha256').update(canonical(value)).digest('hex');}
function assertMission(mission){return missionState.normalizeMission(mission);}

function createCheckpoint(mission,{gateway_status='available',gateway_generation=0,selected_route=null}={}){
  const current=assertMission(mission);
  if(missionState.TERMINAL_STATUSES.has(current.status))return {status:'blocked',reason:'terminal_mission',version:VERSION};
  const checkpoint={
    mission_id:current.mission_id,
    current_step:current.current_step,
    completed_steps:current.completed_steps,
    total_steps:current.total_steps,
    mission_status:current.status,
    next_action:current.next_action,
    gateway_status,
    gateway_generation,
    selected_route:selected_route&&typeof selected_route==='object'?{...selected_route}:null
  };
  return {status:'checkpointed',checkpoint,checkpoint_id:'chk_'+hash(checkpoint).slice(0,32),version:VERSION};
}

function markDisconnected(mission,checkpoint,failure={}){
  const current=assertMission(mission);
  if(current.mission_id!==checkpoint?.mission_id)return {status:'blocked',reason:'mission_checkpoint_mismatch',version:VERSION};
  if(current.status!=='running')return {status:'blocked',reason:'mission_not_running',version:VERSION};
  const next=missionState.transitionMission(current,'waiting',{
    current_step:checkpoint.current_step,
    completed_steps:checkpoint.completed_steps,
    next_action:'wait_for_omniroute_recovery',
    checkpoint:{...current.checkpoint,omniroute_recovery:{phase:'interrupted',checkpoint_id:'chk_'+hash(checkpoint).slice(0,32),failure:failure&&typeof failure==='object'?{...failure}:null}}
  });
  return {status:'interrupted',mission:next,checkpoint_id:'chk_'+hash(checkpoint).slice(0,32),version:VERSION};
}

function restoreGateway(evidence={}){
  const verified=evidence.status==='verified'&&evidence.healthy===true&&typeof evidence.evidence_id==='string'&&evidence.evidence_id.trim()!=='';
  if(!verified)return {status:'blocked',reason:'gateway_health_unverified',version:VERSION};
  return {status:'gateway_restored',gateway_generation:evidence.gateway_generation??null,evidence_id:evidence.evidence_id,version:VERSION};
}

function resumeMission(mission,checkpoint,healthEvidence){
  const current=assertMission(mission);
  if(current.mission_id!==checkpoint?.mission_id)return {status:'blocked',reason:'mission_checkpoint_mismatch',version:VERSION};
  if(current.status!=='waiting')return {status:'blocked',reason:'mission_not_waiting',version:VERSION};
  const health=restoreGateway(healthEvidence);
  if(health.status!=='gateway_restored')return health;
  const next=missionState.transitionMission(current,'running',{
    current_step:checkpoint.current_step,
    completed_steps:checkpoint.completed_steps,
    next_action:checkpoint.next_action||'continue_mission',
    checkpoint:{...current.checkpoint,omniroute_recovery:{phase:'restored',gateway_generation:health.gateway_generation,evidence_id:health.evidence_id}}
  });
  return {status:'resumed',mission:next,checkpoint_id:'chk_'+hash(checkpoint).slice(0,32),gateway_generation:health.gateway_generation,evidence_id:health.evidence_id,version:VERSION};
}

function verifyContinuity(before,after){
  const a=assertMission(before),b=assertMission(after);
  const ok=a.mission_id===b.mission_id&&a.current_step===b.current_step&&a.completed_steps===b.completed_steps&&b.status==='running';
  return {status:ok?'continuity_verified':'continuity_failed',mission_id:b.mission_id,current_step:b.current_step,completed_steps:b.completed_steps,version:VERSION};
}

module.exports={VERSION,canonical,hash,createCheckpoint,markDisconnected,restoreGateway,resumeMission,verifyContinuity};