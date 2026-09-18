import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { generateCandidates, selectDynamicGoal } from './_shared/dynamic-goal-engine.mjs';
import { buildIdeaMissionProposal, validateProposal } from './_shared/idea-to-mission.mjs';
const supabase=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CANONICAL_RUNTIME=`${Deno.env.get('SUPABASE_URL')}/functions/v1/aria-canonical-runtime-v1`;
const RUNTIME_SECRET=Deno.env.get('ARIA_RUNTIME_SHARED_SECRET')||'';
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})}
async function hash(t:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function body(r:Request){try{return await r.json()}catch{return {}}}
async function auth(r:Request,id?:string){const m=(r.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i);if(!m)return{error:json({error:'unauthorized'},401)};const deviceId=id||r.headers.get('x-aria-device-id');if(!deviceId)return{error:json({error:'device_id_required'},400)};const tokenHash=await hash(m[1]);const {data,error}=await supabase.schema('aria_internal').from('device_registry').select('device_id,agent_type,status,capabilities').eq('device_id',deviceId).eq('token_hash',tokenHash).maybeSingle();if(error||!data)return{error:json({error:'unauthorized'},401)};if(data.status==='disabled')return{error:json({error:'device_disabled'},403)};return{device:data}}
function keyOf(v:unknown){return typeof v==='string'?v.trim().toLowerCase().replace(/\s+/g,' ').replace(/[^a-z0-9:_ -]/g,''):''}
async function recoverStale(){const {data,error}=await supabase.rpc('aria_autonomy_recover_stale_missions',{p_stale_after:'00:02:00'});if(error)throw new Error(error.message);return Number(data||0)}
async function learnRecent(){const cut=new Date(Date.now()-6*60*60*1000).toISOString();const {data,error}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,metadata,last_stderr,last_stdout,updated_at,created_at').in('status',['succeeded','blocked','failed','timeout','cancelled']).gt('updated_at',cut);if(error)throw new Error(error.message);let created=0;for(const m of data||[]){const {data:e}=await supabase.schema('aria_internal').from('autonomy_learnings').select('lesson_id').eq('mission_id',m.mission_id).limit(1);if(!e?.length){const {error:ie}=await supabase.schema('aria_internal').from('autonomy_learnings').insert({mission_id:m.mission_id,goal_id:m.metadata?.goal_id??null,category:m.status==='succeeded'?'verified_success':'operational_failure',summary:`Observed ${m.status}: ${(m.goal||'').slice(0,220)}`,evidence:{status:m.status,stderr:m.last_stderr||null,stdout_sample:(m.last_stdout||'').slice(0,800)},confidence:m.status==='succeeded'?0.9:0.75,reusable:true});if(!ie)created++}}return{scanned:data?.length||0,created}}
async function syncGoalTerminalStates(){const {data,error}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,status,metadata').not('metadata->>goal_id','is',null).in('status',['succeeded','failed','blocked','timeout','cancelled']).order('updated_at',{ascending:false}).limit(50);if(error)throw new Error(error.message);let completed=0,blocked=0;for(const m of data||[]){const goalId=m.metadata?.goal_id;if(!goalId)continue;const next=m.status==='succeeded'?'completed':'blocked';const {data:updated,error:ue}=await supabase.schema('aria_internal').from('autonomy_goals').update({status:next,updated_at:new Date().toISOString(),last_mission_id:m.mission_id}).eq('goal_id',goalId).in('status',['queued','running','paused']).select('goal_id').maybeSingle();if(ue)throw new Error(ue.message);if(updated){if(next==='completed')completed++;else blocked++}}return{completed,blocked}}
async function runCanonicalMission(missionId:string,trigger='meditation-ia'){if(!RUNTIME_SECRET)return{status:'blocked',error:'meditation_runtime_secret_missing'};const response=await fetch(CANONICAL_RUNTIME,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${RUNTIME_SECRET}`,'x-aria-trigger':trigger},body:JSON.stringify({mission_id:missionId})});const text=await response.text();let payload:any;try{payload=text?JSON.parse(text):{}}catch{payload={status:'failed',error:'canonical_runtime_invalid_json'}};if(!response.ok)return{status:'failed',error:payload?.error||`canonical_runtime_${response.status}`,runtime_http_status:response.status};return{...payload,runtime_http_status:response.status}}
async function closeGoalOnMissionSuccess(m:any){const goalId=m?.metadata?.goal_id;if(!goalId)return;await supabase.schema('aria_internal').from('autonomy_goals').update({status:'completed',updated_at:new Date().toISOString(),last_mission_id:m.mission_id}).eq('goal_id',goalId).eq('status','running')}

function queueError(e:any){const m=String(e?.message||e||'queue_error');return m.replace(/^.*?\s*:\s*/,'').slice(0,500)}
async function meditationQueueSnapshot(deviceId:string){const {data,error}=await supabase.schema('aria_internal').from('meditation_queue').select('queue_id,device_id,item_type,item_id,resolved_mission_id,position,status,last_error,metadata,created_at,started_at,completed_at,updated_at').eq('device_id',deviceId).order('status',{ascending:true}).order('position',{ascending:true}).limit(100);if(error)throw new Error(error.message);return data||[]}
async function meditationNotificationsSnapshot(unreadOnly=false,limit=50){
  const safeLimit=Math.max(1,Math.min(100,Number(limit)||50));
  const sb=supabase.schema('aria_internal');
  let q=sb.from('meditation_notifications').select('notification_id,source_event_id,mission_id,kind,severity,title,message,action,metadata,read_at,created_at').order('created_at',{ascending:false}).limit(safeLimit);
  if(unreadOnly)q=q.is('read_at',null);
  const [{data,error},{count:unreadCount,error:countError}]=await Promise.all([
    q,
    sb.from('meditation_notifications').select('notification_id',{count:'exact',head:true}).is('read_at',null)
  ]);
  if(error)throw new Error(error.message);
  if(countError)throw new Error(countError.message);
  return{version:'aria-meditation-notifications-v1',notifications:data||[],unread_count:Number(unreadCount||0),external_channels:{configured:false,channels:[]}};
}
async function createMeditationIdeaProposal(b:any,d:any){
  const idea=typeof b?.idea==='string'?b.idea.trim():'';
  if(!idea)throw new Error('idea_required');
  const proposal=await buildIdeaMissionProposal(idea,{device_id:d.device_id,created_by:'robert'});
  const validation=validateProposal(proposal);
  if(!validation.valid)throw new Error('proposal_invalid:'+String(validation.reason||'unknown'));
  const sb=supabase.schema('aria_internal');
  const {data:existing,error:ee}=await sb.from('meditation_idea_proposals').select('*').eq('fingerprint',proposal.fingerprint).maybeSingle();
  if(ee)throw new Error(ee.message);
  const present=(row:any)=>({
    proposal_id:String(row.proposal_id),
    fingerprint:String(row.fingerprint),
    schema_version:String(row.schema_version),
    status:String(row.status),
    input:{idea:String(row.idea)},
    classification:row.classification||{},
    objective:row.objective||{},
    subobjectives:row.subobjectives||[],
    missions:row.missions||[],
    queue_policy:row.metadata?.queue_policy||{mode:'manual_only',auto_enqueue:false,auto_execute:false,human_decision_required:true},
    closure:row.metadata?.closure||{required:true,rule:'inspectable_plan_without_auto_queue'},
    created_from:row.metadata?.created_from||{source:'meditation-idea-to-mission-v1',device_id:row.source_device_id||null,created_by:'robert'},
    summary:row.metadata?.summary||null,
    auto_enqueued:Boolean(row.auto_enqueued)
  });
  if(existing)return{ok:true,status:'proposed',deduplicated:true,proposal:present(existing)};
  const {data:row,error}=await sb.from('meditation_idea_proposals').insert({
    fingerprint:proposal.fingerprint,
    idea:proposal.input.idea,
    schema_version:proposal.schema_version,
    status:'proposed',
    classification:proposal.classification,
    objective:proposal.objective,
    subobjectives:proposal.subobjectives,
    missions:proposal.missions,
    blockers:proposal.classification.blockers||[],
    metadata:{created_from:proposal.created_from,summary:proposal.summary,queue_policy:proposal.queue_policy,closure:proposal.closure},
    auto_enqueued:false,
    source_device_id:d.device_id
  }).select('*').single();
  if(error){
    const duplicate=await sb.from('meditation_idea_proposals').select('*').eq('fingerprint',proposal.fingerprint).maybeSingle();
    if(!duplicate.error&&duplicate.data)return{ok:true,status:'proposed',deduplicated:true,proposal:present(duplicate.data)};
    throw new Error(error.message);
  }
  return{ok:true,status:'proposed',deduplicated:false,proposal:present(row)};
}
async function meditationIdeaProposalsSnapshot(deviceId:string,limit=50){
  const safe=Math.max(1,Math.min(100,Number(limit)||50));
  const {data,error}=await supabase.schema('aria_internal').from('meditation_idea_proposals')
    .select('proposal_id,fingerprint,idea,schema_version,status,classification,objective,subobjectives,missions,blockers,metadata,auto_enqueued,source_device_id,created_at,updated_at')
    .eq('source_device_id',deviceId).order('created_at',{ascending:false}).limit(safe);
  if(error)throw new Error(error.message);
  return{version:'aria-meditation-idea-to-mission-v1',device_id:deviceId,items:data||[],total:Number(data?.length||0),auto_enqueue_policy:'forbidden'};
}
async function meditationIdeaProposalById(deviceId:string,id:string){
  const {data,error}=await supabase.schema('aria_internal').from('meditation_idea_proposals').select('*').eq('proposal_id',id).eq('source_device_id',deviceId).maybeSingle();
  if(error)throw new Error(error.message);
  if(!data)throw new Error('proposal_not_found');
  return data;
}

async function mission5ModelProbe(b:any,d:any){
  const modelId=typeof b?.model_id==='string'?b.model_id.trim():'';
  const prompt=typeof b?.prompt==='string'?b.prompt.trim():'';
  const risk=typeof b?.risk==='string'?b.risk:'READ';
  const allowed={
    'google/gemini-3.5-flash-lite-direct':{provider_id:'google',account_id:'acct_google_gemini_free'},
    'google/gemini-2.5-flash-lite':{provider_id:'openrouter',account_id:'acct_openrouter_primary'}
  } as Record<string,{provider_id:string;account_id:string}>;
  const route=allowed[modelId];
  if(!route)throw new Error('model_not_allowed_for_mission5_probe');
  if(risk!=='READ')throw new Error('mission5_model_probe_read_only');
  if(!prompt||!prompt.includes('M5_MODEL_E2E_OK'))throw new Error('mission5_model_probe_prompt_contract');
  if(!RUNTIME_SECRET)throw new Error('meditation_runtime_secret_missing');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/aria-execution-runtime-v1`,{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${RUNTIME_SECRET}`,'x-aria-trigger':'mission5-model-probe'},
      body:JSON.stringify({
        execution_version:'1',
        request_id:`mission5:model:${modelId}:${crypto.randomUUID()}`,
        task_id:'mission5_model_probe',
        capability:'text_generation',
        selected_route:{status:'selected',provider_id:route.provider_id,account_id:route.account_id,model_id:modelId,capability:'text_generation'},
        authorization:{status:'approved',risk_class:'READ',evidence_ref:`mission5:model-probe:${modelId}`},
        input:{payload:{prompt}},
        policy:{risk:'READ',mission5:true,probe:true}
      }),
      signal:controller.signal
    });
    const textBody=await response.text();
    let payload:any;try{payload=textBody?JSON.parse(textBody):{}}catch{payload={status:'failed',error:'invalid_execution_runtime_json'}};
    if(!response.ok)throw new Error(String(payload?.error?.message||payload?.error||`execution_runtime_http_${response.status}`));
    return {ok:true,device_id:d.device_id,mission5:true,probe:true,model_id:modelId,provider_id:route.provider_id,account_id:route.account_id,runtime_status:payload?.status||null,response:payload?.response||null,usage:payload?.usage||null,runtime_error:payload?.error||null,metadata:{...payload?.metadata,transport:'device-gateway',evidence_ref:`mission5:model-probe:${modelId}`}};
  }catch(e:any){
    if(e?.name==='AbortError')throw new Error('mission5_model_probe_timeout');
    throw e;
  }finally{clearTimeout(timer)}
}

async function mission5AgentProbe(b:any,d:any){
  const agentId=typeof b?.agent_id==='string'?b.agent_id.trim():'';
  const prompt=typeof b?.prompt==='string'?b.prompt.trim():'';
  const risk=typeof b?.risk==='string'?b.risk:'READ';
  const missionId=typeof b?.mission_id==='string'&&b.mission_id.trim()?b.mission_id.trim():'mission5-agent-probe-'+crypto.randomUUID();
  const stepId=typeof b?.step_id==='string'&&b.step_id.trim()?b.step_id.trim():'mission5_probe_1';
  const allowed=new Set(['aria-agent-planner-gemini35-v1','aria-agent-verifier-gemini35-v1']);
  if(!allowed.has(agentId))throw new Error('agent_not_allowed_for_mission5_probe');
  if(risk!=='READ')throw new Error('mission5_probe_read_only');
  if(!prompt||!prompt.includes('M5_AGENT_E2E_OK'))throw new Error('mission5_probe_prompt_contract');
  if(!RUNTIME_SECRET)throw new Error('meditation_runtime_secret_missing');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/aria-agent-runtime-v1`,{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${RUNTIME_SECRET}`,'x-aria-trigger':'mission5-agent-probe'},
      body:JSON.stringify({operation:'delegate',agent_id:agentId,mission_id:missionId,step_id:stepId,risk:'READ',input:{prompt},policy:{risk:'READ',mission5:true,probe:true}})
      ,signal:controller.signal
    });
    const textBody=await response.text();
    let payload:any; try{payload=textBody?JSON.parse(textBody):{}}catch{payload={status:'failed',error:'invalid_agent_runtime_json'}};
    if(!response.ok)throw new Error(String(payload?.error?.message||payload?.error||`agent_runtime_http_${response.status}`));
    return {ok:true,device_id:d.device_id,mission5:true,probe:true,agent_id:agentId,mission_id:missionId,step_id:stepId,runtime_status:payload?.status||null,provider_id:payload?.provider_id||payload?.metadata?.provider_id||null,account_id:payload?.account_id||payload?.metadata?.account_id||null,model_id:payload?.model_id||payload?.metadata?.model_id||null,capability_id:payload?.capability_id||payload?.metadata?.capability_id||null,response:payload?.response||null,usage:payload?.usage||null,metadata:{...payload?.metadata,transport:'device-gateway',resource_graph:'aria_internal.resolve_agent_resource'}};
  }catch(e:any){
    if(e?.name==='AbortError')throw new Error('mission5_agent_probe_timeout');
    throw e;
  }finally{clearTimeout(timer)}
}

async function markMeditationNotificationsRead(body:any){
  const ids=Array.isArray(body?.notification_ids)?body.notification_ids.map(String).filter(Boolean):[];
  const all=body?.all===true;
  if(!ids.length&&!all)throw new Error('notification_ids_or_all_required');
  const sb=supabase.schema('aria_internal');
  let q=sb.from('meditation_notifications').update({read_at:new Date().toISOString()});
  if(all)q=q.is('read_at',null);
  else q=q.in('notification_id',ids);
  const {data,error}=await q.select('notification_id');
  if(error)throw new Error(error.message);
  return{ok:true,marked_read:Number(data?.length||0),notification_ids:(data||[]).map((x:any)=>String(x.notification_id))};
}
function objectiveHumanGate(goal:any,mission:any,gateEvents:any[]=[]){const gate=mission?.metadata?.human_gate;if(!gate||typeof gate!=='object'||gate.enabled!==true||!String(gate.method||'').trim())return{required:false,status:'none',label:'NO EXISTE MISION HUMANA',reason:null,method:null,instructions:null};const completed=mission?.checkpoint?.human_gate?.status==='completed'&&mission?.checkpoint?.human_gate?.verified===true;return{required:true,status:completed?'completed':'pending',label:completed?'HUMAN GATE COMPLETADO':'HUMAN GATE PENDIENTE',reason:String(gate.reason||'Verificación humana requerida antes del cierre.'),method:String(gate.method),instructions:String(gate.instructions||'Confirmar manualmente la verificación requerida.')}}
function missionProgress(m:any){const plan=Array.isArray(m?.checkpoint?.plan)?m.checkpoint.plan:[];const total=plan.length||Number(m?.total_steps||0)||0;const done=Array.isArray(m?.checkpoint?.completed_steps)?m.checkpoint.completed_steps.length:Number(m?.completed_steps||0)||0;const progress=total?Math.max(0,Math.min(100,Math.round(done/total*1000)/10)):String(m?.status||'')==='succeeded'?100:0;return{percent:progress,completed:done,total}}
function missionStepRows(m:any){
  const plan=Array.isArray(m?.checkpoint?.plan)?m.checkpoint.plan:[];
  const done=new Set((Array.isArray(m?.checkpoint?.completed_steps)?m.checkpoint.completed_steps:[]).map(String));
  const results=m?.checkpoint?.results&&typeof m.checkpoint.results==='object'?m.checkpoint.results:{};
  const recovery=m?.checkpoint?.recovery&&typeof m.checkpoint.recovery==='object'?m.checkpoint.recovery:{};
  const failed=Array.isArray(recovery.failed_step_ids)?recovery.failed_step_ids.map(String):[];
  return plan.map((s:any,i:number)=>{
    const id=String(s?.id??`step_${i+1}`);
    let status=done.has(id)?'succeeded':'pending';
    if(!done.has(id)&&results[id]?.status==='failed')status='failed';
    if(!done.has(id)&&m?.status==='blocked'&&failed.includes(id))status='blocked';
    if(!done.has(id)&&m?.status==='running'&&Number(m?.current_step??0)===i)status='running';
    if(!done.has(id)&&m?.status==='paused'&&recovery.status==='waiting_for_async_executor')status='waiting';
    return {
      index:i+1,id,title:String(s?.title??s?.operation??`Paso ${i+1}`),status,
      risk:String(s?.risk??'READ'),
      executor_type:String(s?.executor_type||s?.target?.type||''),
      operation:String(s?.operation??''),
      depends_on:Array.isArray(s?.depends_on)?s.depends_on.map(String):[],
      result:results[id]??null
    };
  });
}
function catalogText(g:any){const md=g?.metadata&&typeof g.metadata==='object'?g.metadata:{};const goal=String(g?.goal||'').trim();const acceptance=String(md.acceptance||'').trim();const source=String(md.source_section||md.source_type||g?.source_type||'ARIA');return{summary:goal,result:acceptance||goal||'Resultado definido por el objetivo canónico.',solution:`Trabajo gobernado para el objetivo: ${goal||'objetivo registrado'}`,improvement:`Mejora ARIA: avanza la capacidad asociada a ${source} con evidencia verificable.`,technical_description:goal,dependencies:Array.isArray(md.dependencies)?md.dependencies.map(String):[],risk:String(md.risk||md.risk_level||'READ'),source_type:String(g?.source_type||'unknown'),acceptance:acceptance||null}}
async function meditationCatalog(deviceId:string){const sb=supabase.schema('aria_internal');const [goalsRes,missionsRes,gatesRes]=await Promise.all([sb.from('autonomy_goals').select('goal_id,goal,priority,status,next_run_at,last_mission_id,source_type,source_ref,dynamic_score,metadata,objective_verification_status,objective_verification_reason,objective_verified_at,updated_at').in('status',['queued','paused','running','blocked']).order('priority',{ascending:false}).order('updated_at',{ascending:false}).limit(120),sb.from('mission_state').select('mission_id,goal,status,current_step,total_steps,completed_steps,next_action,last_stdout,last_stderr,checkpoint,metadata,created_at,updated_at,finished_at').in('status',['queued','planning','running','waiting','paused','blocked']).order('updated_at',{ascending:false}).limit(120),sb.from('mission_events').select('mission_id,event_type,payload,created_at').in('event_type',['human_gate_requested','self_improvement_human_gate']).order('created_at',{ascending:false}).limit(300)]);for(const r of [goalsRes,missionsRes,gatesRes])if(r.error)throw new Error(r.error.message);const missionsById=new Map((missionsRes.data||[]).map((m:any)=>[String(m.mission_id),m]));const gates=gatesRes.data||[];const seen=new Set<string>();const goalItems=(goalsRes.data||[]).map((g:any)=>{const mission=g.last_mission_id?missionsById.get(String(g.last_mission_id)):null;const human_gate=objectiveHumanGate(g,mission,gates);const progress=mission?missionProgress(mission):{percent:g.status==='completed'?100:0,completed:0,total:0};const texts=catalogText(g);const item={id:`goal:${g.goal_id}`,item_type:'goal',goal_id:g.goal_id,mission_id:mission?.mission_id??null,title:String(g.goal||g.goal_id),...texts,status:String(g.status),priority:Number(g.priority||0),progress_percent:progress.percent,progress_steps:progress,steps:missionStepRows(mission),next_action:mission?.next_action??null,last_error:mission?.last_stderr??null,objective_verification_status:g.objective_verification_status??'UNVERIFIED',objective_verification_reason:g.objective_verification_reason??null,human_gate,source_ref:g.source_ref??null,updated_at:g.updated_at};seen.add(String(g.goal_id));return item});const missionItems=(missionsRes.data||[]).filter((m:any)=>!seen.has(String(m.metadata?.goal_id||''))).map((m:any)=>{const progress=missionProgress(m);const human_gate=objectiveHumanGate(m,m,gates);const text=catalogText({goal:m.goal,metadata:m.metadata,source_type:m.metadata?.source});return{id:`mission:${m.mission_id}`,item_type:'mission',goal_id:m.metadata?.goal_id??null,mission_id:m.mission_id,title:String(m.goal||m.mission_id),...text,status:String(m.status),priority:0,progress_percent:progress.percent,progress_steps:progress,steps:missionStepRows(m),objective_verification_status:'MISSION_SCOPE',objective_verification_reason:null,human_gate,source_ref:m.metadata?.source_ref??null,updated_at:m.updated_at,next_action:m.next_action??null,last_error:m.last_stderr??null}});const catalog=[...goalItems,...missionItems].sort((a,b)=>Number(b.priority)-Number(a.priority)||String(a.status).localeCompare(String(b.status))||String(b.updated_at).localeCompare(String(a.updated_at)));return{version:'aria-meditation-catalog-v1',device_id:deviceId,items:catalog,total:catalog.length,human_gate_rule:'NO EXISTE MISION HUMANA when no real human verification method is registered'}}
async function createManualMissionFromGoal(goalId:string,b:any,d:any){const {data:goal,error}=await supabase.schema('aria_internal').from('autonomy_goals').select('*').eq('goal_id',goalId).maybeSingle();if(error)throw new Error(error.message);if(!goal)throw new Error('goal_not_found');if(goal.status==='completed')throw new Error('goal_terminal');if(goal.last_mission_id){const {data:existing}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,status,metadata').eq('mission_id',goal.last_mission_id).maybeSingle();if(existing&&!['succeeded','failed','blocked','cancelled'].includes(String(existing.status)))return existing}const missionId=`mission_${crypto.randomUUID()}`;const {data:mission,error:me}=await supabase.rpc('aria_mission_create',{p_mission:{mission_id:missionId,status:'queued',goal:goal.goal,current_step:0,completed_steps:0,checkpoint:{manual_queue:{queue_v1:true,queue_item_goal_id:goalId}},metadata:{source:'meditation-center-v1',meditation_session_id:b.session_id||null,device_id:d.device_id,goal_id:goalId,manual_queue:true,...(goal.metadata?.requires_human_gate?{human_gate_required:Array.isArray(goal.metadata.requires_human_gate)?goal.metadata.requires_human_gate:[String(goal.metadata.requires_human_gate)]}:goal.metadata?.physical_gate===true?{human_gate_required:['PHYSICAL']}:{})}}});if(me)throw new Error(me.message);await supabase.schema('aria_internal').from('autonomy_goals').update({status:'running',last_mission_id:missionId,updated_at:new Date().toISOString()}).eq('goal_id',goalId).eq('status',goal.status);return mission}
async function processManualQueue(b:any,d:any){const {data:q,error:qe}=await supabase.rpc('meditation_queue_claim_next',{p_device_id:d.device_id});if(qe)throw new Error(qe.message);if(!q)return null;let missionId=q.resolved_mission_id?String(q.resolved_mission_id):null;try{if(String(q.item_type)==='goal'){const m=await createManualMissionFromGoal(String(q.item_id),b,d);missionId=String(m.mission_id);await supabase.schema('aria_internal').from('meditation_queue').update({resolved_mission_id:missionId,updated_at:new Date().toISOString()}).eq('queue_id',q.queue_id).eq('device_id',d.device_id)}else missionId=String(q.item_id);const {data:before}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,status,goal,metadata').eq('mission_id',missionId).maybeSingle();if(!before)throw new Error('mission_not_found');if(['succeeded','failed','blocked','cancelled'].includes(String(before.status))){const terminalStatus=String(before.status)==='succeeded'?'completed':String(before.status);await supabase.schema('aria_internal').from('meditation_queue').update({status:terminalStatus,completed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('queue_id',q.queue_id);return{status:terminalStatus,queue_id:q.queue_id,mission_id:missionId,manual_queue:true,already_terminal:true}}const runtime=await runCanonicalMission(missionId,'meditation-ia-manual');const finalStatus=runtime.status==='succeeded'?'completed':runtime.status==='blocked'?'blocked':runtime.status==='failed'?'failed':'paused';await supabase.schema('aria_internal').from('meditation_queue').update({status:finalStatus,resolved_mission_id:missionId,last_error:finalStatus==='completed'?null:String(runtime.error||runtime.status||''),completed_at:['completed','blocked','failed'].includes(finalStatus)?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('queue_id',q.queue_id);if(runtime.status==='succeeded'){const {data:finished}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,metadata').eq('mission_id',missionId).maybeSingle();await closeGoalOnMissionSuccess(finished)}return{status:runtime.status,queue_id:q.queue_id,mission_id:missionId,manual_queue:true,runtime}}catch(error){const message=queueError(error);await supabase.schema('aria_internal').from('meditation_queue').update({status:'failed',last_error:message,updated_at:new Date().toISOString(),completed_at:new Date().toISOString()}).eq('queue_id',q.queue_id).eq('device_id',d.device_id);return{status:'failed',queue_id:q.queue_id,mission_id:missionId,manual_queue:true,error:message}}}

async function meditationTick(b:any,d:any){const recovered=await recoverStale();const learning=await learnRecent();const goalSync=await syncGoalTerminalStates();const manual=await processManualQueue(b,d);if(manual)return{ok:manual.status!=='failed'&&manual.status!=='blocked',status:manual.status,manual_queue:true,queue_id:manual.queue_id,active_mission_id:manual.mission_id,recovered,learning,goalSync,runtime:manual.runtime||null};const {data:active,error:ae}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,metadata,updated_at').contains('metadata',{source:'meditation-ia-v1'}).in('status',['queued','planning','running','paused']).order('updated_at',{ascending:false}).limit(1);if(ae)throw new Error(ae.message);if(active?.length){const m=active[0];const runtime=await runCanonicalMission(m.mission_id);if(runtime.status==='succeeded')await closeGoalOnMissionSuccess(m);return{ok:runtime.status!=='failed'&&runtime.status!=='blocked',status:runtime.status||'runtime_unknown',active_mission_id:m.mission_id,goal:m.goal||null,recovered,learning,goalSync,created:false,runtime}}const now=new Date().toISOString();const [goalsRes,failuresRes,gapsRes,learningsRes]=await Promise.all([supabase.schema('aria_internal').from('autonomy_goals').select('*').in('status',['queued','paused','running','blocked','completed']),supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,last_stderr,last_stdout,updated_at,created_at,metadata').in('status',['failed','blocked','timeout']).gt('updated_at',new Date(Date.now()-72*60*60*1000).toISOString()).order('updated_at',{ascending:false}).limit(12),supabase.schema('aria_internal').from('capability_matrix').select('model_id,capability_id,status,evidence_type,evidence_ref,verified_at,notes,metadata,updated_at').neq('status','verified').order('updated_at',{ascending:false}).limit(30),supabase.schema('aria_internal').from('autonomy_learnings').select('lesson_id,mission_id,goal_id,category,summary,evidence,confidence,reusable,created_at').eq('reusable',true).order('created_at',{ascending:false}).limit(30)]);for(const r of [goalsRes,failuresRes,gapsRes,learningsRes])if(r.error)throw new Error(r.error.message);const goals=goalsRes.data||[];const candidates=generateCandidates({goals,failures:failuresRes.data||[],capabilityGaps:gapsRes.data||[],learnings:learningsRes.data||[]},{now});const blockedIds=new Set(goals.filter((g:any)=>['blocked','completed'].includes(g.status)).map((g:any)=>g.goal_id));const activeIds=new Set(goals.filter((g:any)=>g.status==='running').map((g:any)=>g.goal_id));let generated=[] as string[];const fingerprints=new Set(goals.map((g:any)=>keyOf(g.goal)).filter(Boolean));for(const c of candidates.slice(0,15)){if(goals.some((g:any)=>g.goal_id===c.goal_id)||fingerprints.has(keyOf(c.goal)))continue;const {error}=await supabase.schema('aria_internal').from('autonomy_goals').insert({goal_id:c.goal_id,goal:c.goal,priority:Math.round(c.priority),status:'queued',next_run_at:now,attempts:0,max_attempts:3,source_type:c.source_type,source_ref:c.source_ref||null,dynamic_score:c.dynamic_score,metadata:{...(c.metadata||{}),dynamic:true,source:'meditation-ia-v1'}});if(error&&!String(error.message||'').toLowerCase().includes('duplicate'))throw new Error(error.message);if(!error)generated.push(c.goal_id)}const {data:eligible,error:er}=await supabase.schema('aria_internal').from('autonomy_goals').select('*').eq('status','queued').lte('next_run_at',now).order('dynamic_score',{ascending:false}).limit(30);if(er)throw new Error(er.message);const ranked=generateCandidates({goals:eligible||[]},{now});const selected=selectDynamicGoal(ranked,{blockedIds,activeIds});if(!selected)return{ok:true,status:'idle',recovered,learning,goalSync,candidate_count:candidates.length,generated_count:generated.length,mission_created:null};const claimedAt=new Date().toISOString();const {data:claimed,error:ce}=await supabase.schema('aria_internal').from('autonomy_goals').update({status:'running',attempts:Number(selected.attempts||0)+1,updated_at:claimedAt}).eq('goal_id',selected.goal_id).eq('status','queued').select('*').maybeSingle();if(ce)throw new Error(ce.message);if(!claimed)return{ok:true,status:'raced',recovered,learning,goalSync};const existingByGoal=await supabase.schema('aria_internal').from('mission_state').select('mission_id,status,goal,metadata').eq('metadata->>goal_id',selected.goal_id).in('status',['queued','planning','running','waiting','paused']).order('updated_at',{ascending:false}).limit(1).maybeSingle();if(existingByGoal.error)throw new Error(existingByGoal.error.message);if(existingByGoal.data){const existingRuntime=await runCanonicalMission(String(existingByGoal.data.mission_id));return{ok:existingRuntime.status!=='failed'&&existingRuntime.status!=='blocked',status:existingRuntime.status||'runtime_unknown',mission_created:null,active_mission_id:String(existingByGoal.data.mission_id),goal:selected.goal,goal_id:selected.goal_id,dynamic_score:selected.dynamic_score,goal_source:selected.source_type,reused_existing_mission:true,recovered,learning,goalSync,runtime:existingRuntime}}const missionId=`mission_${crypto.randomUUID()}`;const {data:mission,error:me}=await supabase.rpc('aria_mission_create',{p_mission:{mission_id:missionId,status:'queued',goal:selected.goal,current_step:0,completed_steps:0,checkpoint:{dynamic_goal_selection:{goal_id:selected.goal_id,score:selected.dynamic_score,source_type:selected.source_type,source_ref:selected.source_ref}},metadata:{source:'meditation-ia-v1',meditation_session_id:b.session_id||null,device_id:d.device_id,goal_id:selected.goal_id,dynamic_goal:true,dynamic_score:selected.dynamic_score??null,goal_source:selected.source_type??null,human_gate_required:['HIGH_RISK_WRITE','destructive','production_merge']}}});if(me){await supabase.schema('aria_internal').from('autonomy_goals').update({status:'queued',attempts:Math.max(0,Number(claimed.attempts||1)-1),updated_at:new Date().toISOString()}).eq('goal_id',selected.goal_id).eq('status','running');throw new Error(me.message)}const {error:ue}=await supabase.schema('aria_internal').from('autonomy_goals').update({last_mission_id:missionId,updated_at:new Date().toISOString()}).eq('goal_id',selected.goal_id).eq('status','running');if(ue)throw new Error(ue.message);const runtime=await runCanonicalMission(missionId);if(runtime.status==='succeeded')await supabase.schema('aria_internal').from('autonomy_goals').update({status:'completed',updated_at:new Date().toISOString(),last_mission_id:missionId}).eq('goal_id',selected.goal_id).eq('status','running');return{ok:runtime.status!=='failed'&&runtime.status!=='blocked',status:runtime.status||'runtime_unknown',mission_created:missionId,goal:selected.goal,goal_id:selected.goal_id,dynamic_score:selected.dynamic_score,goal_source:selected.source_type,recovered,learning,goalSync,runtime}}
Deno.serve(async(req)=>{const u=new URL(req.url);const p=u.pathname.replace(/^\/aria-device-gateway/,'').replace(/\/+$/,'')||'/';const b=await body(req);if(req.method==='GET'&&p==='/health')return json({ok:true,service:'aria-device-gateway',version:'12',canonical_runtime:true,meditation_owned_missions:true,goal_completion_sync:true,recursive_failure_guard:true,idea_to_mission:true});if(req.method==='POST'&&p==='/v1/devices/enroll'){if(typeof b.device_id!=='string'||typeof b.token!=='string')return json({error:'device_id_and_token_required'},400);const {data,error}=await supabase.rpc('enroll_device',{p_device_id:b.device_id,p_token:b.token});if(error)return json({error:'enrollment_failed',code:error.code??null,message:error.message??null},409);return json(data)}const a=await auth(req,b.device_id);if(a.error)return a.error;const d=a.device;if(req.method==='POST'&&p==='/v1/devices/heartbeat'){const {error}=await supabase.rpc('heartbeat_device_gateway',{p_device_id:d.device_id,p_capabilities:Array.isArray(b.capabilities)?b.capabilities:d.capabilities,p_agent_type:String(b.agent_type||d.agent_type)});if(error)return json({error:'heartbeat_failed'},500);return json({ok:true,device_id:d.device_id})}if(req.method==='POST'&&p==='/v1/meditation/tick'){try{return json(await meditationTick(b,d))}catch(e){return json({ok:false,status:'failed',error:e instanceof Error?e.message:String(e)},200)}}
if(req.method==='GET'&&p==='/v1/meditation/catalog'){try{return json(await meditationCatalog(d.device_id))}catch(e){return json({ok:false,error:queueError(e)},500)}}
if(req.method==='GET'&&p==='/v1/meditation/queue'){try{return json({version:'aria-meditation-queue-v1',device_id:d.device_id,items:await meditationQueueSnapshot(d.device_id)})}catch(e){return json({ok:false,error:queueError(e)},500)}}
if(req.method==='POST'&&p==='/v1/meditation/queue/add'){try{const type=String(b.item_type||'');const id=String(b.item_id||'');if(!type||!id)return json({error:'item_type_and_item_id_required'},400);const {data,error}=await supabase.rpc('meditation_queue_add',{p_device_id:d.device_id,p_item_type:type,p_item_id:id});if(error)return json({error:queueError(error)},400);return json({ok:true,item:data})}catch(e){return json({ok:false,error:queueError(e)},400)}}
if(req.method==='POST'&&p==='/v1/meditation/queue/remove'){try{const id=String(b.queue_id||'');if(!id)return json({error:'queue_id_required'},400);const {data,error}=await supabase.rpc('meditation_queue_remove',{p_device_id:d.device_id,p_queue_id:id});if(error)return json({error:queueError(error)},400);if(!data)return json({error:'queue_item_not_removable'},409);return json({ok:true,item:data})}catch(e){return json({ok:false,error:queueError(e)},400)}}
if(req.method==='POST'&&p==='/v1/meditation/queue/reorder'){try{const ids=Array.isArray(b.queue_ids)?b.queue_ids.map(String).filter(Boolean):[];if(!ids.length)return json({error:'queue_ids_required'},400);const {data,error}=await supabase.rpc('meditation_queue_resequence',{p_device_id:d.device_id,p_queue_ids:ids});if(error)return json({error:queueError(error)},400);return json({ok:true,updated:Number(data||0),items:await meditationQueueSnapshot(d.device_id)})}catch(e){return json({ok:false,error:queueError(e)},400)}}
if(req.method==='POST'&&p==='/v1/meditation/queue/run-next'){try{const manual=await processManualQueue({session_id:null},d);if(!manual)return json({ok:true,status:'idle',manual_queue:true});return json({ok:manual.status!=='failed'&&manual.status!=='blocked',...manual})}catch(e){return json({ok:false,status:'failed',error:queueError(e)},200)}}
if(req.method==='POST'&&p==='/v1/meditation/human-gate/complete'){try{const missionId=String(b.mission_id||'');if(!missionId)return json({error:'mission_id_required'},400);if(b.confirm!==true)return json({error:'human_gate_confirmation_required'},400);const {data,error}=await supabase.rpc('meditation_human_gate_complete',{p_mission_id:missionId,p_device_id:d.device_id,p_note:typeof b.note==='string'?b.note:null});if(error)return json({ok:false,error:queueError(error)},409);return json({ok:true,status:'human_gate_completed',mission_id:missionId,mission:data})}catch(e){return json({ok:false,error:queueError(e)},409)}}
if(req.method==='GET'&&p==='/v1/meditation/notifications'){try{return json(await meditationNotificationsSnapshot(String(u.searchParams.get('unread_only')||'false').toLowerCase()==='true',Number(u.searchParams.get('limit')||50)))}catch(e){return json({ok:false,error:queueError(e)},500)}}
if(req.method==='POST'&&p==='/v1/meditation/notifications/read'){try{return json(await markMeditationNotificationsRead(b))}catch(e){return json({ok:false,error:queueError(e)},400)}}
if(req.method==='POST'&&p==='/v1/mission5/agent-probe'){try{return json(await mission5AgentProbe(b,d))}catch(e){return json({ok:false,error:queueError(e)},400)}}
if(req.method==='POST'&&p==='/v1/mission5/model-probe'){try{return json(await mission5ModelProbe(b,d))}catch(e){return json({ok:false,error:queueError(e)},400)}}
if(req.method==='POST'&&p==='/v1/meditation/idea-to-mission'){try{return json(await createMeditationIdeaProposal(b,d))}catch(e){return json({ok:false,error:queueError(e)},400)}}
if(req.method==='GET'&&p==='/v1/meditation/ideas'){try{return json(await meditationIdeaProposalsSnapshot(d.device_id,Number(u.searchParams.get('limit')||50)))}catch(e){return json({ok:false,error:queueError(e)},500)}}
const ideaMatch=p.match(/^\/v1\/meditation\/ideas\/([^/]+)$/);
if(req.method==='GET'&&ideaMatch){try{return json({ok:true,proposal:await meditationIdeaProposalById(d.device_id,decodeURIComponent(ideaMatch[1]))})}catch(e){return json({ok:false,error:queueError(e)},404)}}if(req.method==='POST'&&p==='/v1/jobs/claim'){const {data,error}=await supabase.rpc('claim_execution_job_gateway',{p_device_id:d.device_id});if(error)return json({error:'claim_failed'},500);return json({job:data??null})}const s=p.match(/^\/v1\/jobs\/([^/]+)\/start$/);if(req.method==='POST'&&s){const jobId=decodeURIComponent(s[1]);const {data,error}=await supabase.rpc('start_execution_job_gateway',{p_job_id:jobId,p_device_id:d.device_id});if(error)return json({error:'start_failed'},500);if(!data)return json({error:'job_not_owned_or_not_claimed'},409);return json({ok:true,job:data})}const z=p.match(/^\/v1\/jobs\/([^/]+)\/result$/);if(req.method==='POST'&&z){const jobId=decodeURIComponent(z[1]);if(!b.result||typeof b.result!=='object')return json({error:'result_required'},400);const r=b.result as Record<string,unknown>;const status=['succeeded','failed','timeout','cancelled'].includes(String(r.status))?String(r.status):'failed';const exitCode=Number.isInteger(r.exit_code)?Number(r.exit_code):null;const clean={status,exit_code:exitCode,stdout:typeof r.stdout==='string'?r.stdout:'',stderr:typeof r.stderr==='string'?r.stderr:'',duration_ms:Number.isFinite(Number(r.duration_ms))?Number(r.duration_ms):null,metadata:r.metadata&&typeof r.metadata==='object'?r.metadata:{}};const {data,error}=await supabase.rpc('complete_execution_job_gateway',{p_job_id:jobId,p_device_id:d.device_id,p_status:status,p_exit_code:exitCode,p_stdout:clean.stdout,p_stderr:clean.stderr,p_result:clean});if(error)return json({error:'result_failed'},500);if(!data)return json({error:'job_not_owned_or_already_finished'},409);return json({ok:true,job:{job_id:jobId,status}})}return json({error:'not_found'},404)})