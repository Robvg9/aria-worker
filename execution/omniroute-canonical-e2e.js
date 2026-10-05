'use strict';

/** OmniRoute Phase 12 — canonical ARIA absorb chain. */
const security=require('../security/omniroute-security.js');
const auto=require('../router/omniroute-auto.js');
const resilience=require('../router/omniroute-resilience.js');
const recovery=require('./omniroute-recovery.js');
const execution=require('./lookup.js');
const verifier=require('../execution-engine/verifier.js');
const {createMissionStateStore}=require('./mission-state.js');
const VERSION='aria-omniroute-canonical-e2e-v1.0.0';

async function runCanonical(input={}){
  if(!input||typeof input!=='object')return{status:'blocked',stage:'input',reason:'input_required',version:VERSION};
  const sec=security.validateSecurityConfig(input.security||{});
  if(sec.status!=='allowed')return{status:'blocked',stage:'security',reason:sec.reason,version:VERSION};
  const selection=auto.selectAuto({
    task_id:input.task_id,task:input.task,capability:input.capability||'text_generation',mode:input.mode||'auto',
    constraints:input.constraints||{},allowed_routes:input.allowed_routes||[]
  });
  if(selection.status!=='selected')return{status:'blocked',stage:'router',route_selection:selection,version:VERSION};

  const route={status:'selected',provider_id:selection.selected.provider_id,account_id:selection.selected.account_id,model_id:selection.selected.model_id,upstream_model:selection.selected.upstream_model,capability:selection.capability,route_type:'omniroute_auto_combo',gateway_endpoint:input.security.gateway_endpoint,omniroute_provider:input.omniroute_provider};
  const checkpointSource={mission_id:input.mission_id,goal:input.task,status:'running',current_step:input.current_step??0,total_steps:input.total_steps??1,completed_steps:input.completed_steps??0,next_action:'execute_selected_route',checkpoint:{}};
  const cp=recovery.createCheckpoint(checkpointSource,{gateway_status:'verified',gateway_generation:input.gateway_generation??0,selected_route:route});
  if(cp.status!=='checkpointed')return{status:'blocked',stage:'checkpoint',reason:cp.reason,version:VERSION};

  const deps=input.execution_deps||{};
  const result=await execution.execute({
    task_id:input.task_id,capability:route.capability,selected_route:route,authorization:input.authorization||{status:'approved'},
    input:{modality:'text',payload:input.payload||{messages:[{role:'user',content:input.task}]}}
  },deps);
  const verification=verifier.verifyStep(result,input.verification_rules||{});
  if(!verification.verified){
    const failureKind=typeof result?.error?.provider_status==='number'?resilience.classifyFailure({status:result.error.provider_status}):resilience.classifyFailure(result?.error||{});
    const failover=resilience.planFallback({primary:route,error:result?.error||{code:'execution_failure'},visited:[resilience.key(route)],alternatives:input.alternative_routes||[],policy:input.resilience_policy||{}});
    return{status:result?.status==='failed'?'failed':'blocked',stage:'verification',execution:result,verification,failure_kind:failureKind,failover,checkpoint:cp,version:VERSION};
  }
  return{status:'succeeded',stage:'canonical_e2e',execution:result,verification,checkpoint:cp,route_selection:selection,version:VERSION};
}

function createCheckpointStore(repository){return createMissionStateStore(repository);}

module.exports={VERSION,runCanonical,createCheckpointStore};