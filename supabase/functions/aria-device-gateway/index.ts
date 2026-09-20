import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { generateCandidates, selectDynamicGoal } from './_shared/dynamic-goal-engine.mjs';
import { buildIdeaMissionProposal, validateProposal } from './_shared/idea-to-mission.mjs';
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const supabase=createClient(SUPABASE_URL,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const CANONICAL_RUNTIME=`${Deno.env.get('SUPABASE_URL')}/functions/v1/aria-canonical-runtime-v1`;
const RUNTIME_SECRET=Deno.env.get('ARIA_RUNTIME_SHARED_SECRET')||'';
const LEARNING=`${Deno.env.get("SUPABASE_URL")}/functions/v1/aria-learning-v3`;
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}})}
async function hash(t:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function body(r:Request){try{return await r.json()}catch{return {}}}
async function auth(r:Request,id?:string){const m=(r.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i);if(!m)return{error:json({error:'unauthorized'},401)};const deviceId=id||r.headers.get('x-aria-device-id');if(!deviceId)return{error:json({error:'device_id_required'},400)};const tokenHash=await hash(m[1]);const {data,error}=await supabase.schema('aria_internal').from('device_registry').select('device_id,agent_type,status,capabilities').eq('device_id',deviceId).eq('token_hash',tokenHash).maybeSingle();if(error||!data)return{error:json({error:'unauthorized'},401)};if(data.status==='disabled')return{error:json({error:'device_disabled'},403)};return{device:data}}
function keyOf(v:unknown){return typeof v==='string'?v.trim().toLowerCase().replace(/\s+/g,' ').replace(/[^a-z0-9:_ -]/g,''):''}
async function recoverStale(){const {data,error}=await supabase.rpc('aria_autonomy_recover_stale_missions',{p_stale_after:'00:02:00'});if(error)throw new Error(error.message);return Number(data||0)}
async function learnRecent(){const cut=new Date(Date.now()-6*60*60*1000).toISOString();const {data,error}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,metadata,last_stderr,last_stdout,updated_at,created_at').in('status',['succeeded','blocked','failed','timeout','cancelled']).gt('updated_at',cut);if(error)throw new Error(error.message);let created=0;for(const m of data||[]){const {data:e}=await supabase.schema('aria_internal').from('autonomy_learnings').select('lesson_id').eq('mission_id',m.mission_id).limit(1);if(!e?.length){const {error:ie}=await supabase.schema('aria_internal').from('autonomy_learnings').insert({mission_id:m.mission_id,goal_id:m.metadata?.goal_id??null,category:m.status==='succeeded'?'verified_success':'operational_failure',summary:`Observed ${m.status}: ${(m.goal||'').slice(0,220)}`,evidence:{status:m.status,stderr:m.last_stderr||null,stdout_sample:(m.last_stdout||'').slice(0,800)},confidence:m.status==='succeeded'?0.9:0.75,reusable:true});if(!ie)created++}}return{scanned:data?.length||0,created}}
async function learnMissionViaV3(missionId:string){
  const response=await fetch(LEARNING,{method:'POST',headers:{'authorization':`Bearer ${RUNTIME_SECRET}`,'content-type':'application/json'},body:JSON.stringify({mission_id:missionId})});
  const payload=await response.json().catch(()=>null);
  return{http_status:response.status,ok:response.ok,payload};
}
async function syncGoalTerminalStates(){const {data,error}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,status,metadata').not('metadata->>goal_id','is',null).in('status',['succeeded','failed','blocked','timeout','cancelled']).order('updated_at',{ascending:false}).limit(50);if(error)throw new Error(error.message);let completed=0,blocked=0;for(const m of data||[]){const goalId=m.metadata?.goal_id;if(!goalId)continue;const next=m.status==='succeeded'?'completed':'blocked';const {data:updated,error:ue}=await supabase.schema('aria_internal').from('autonomy_goals').update({status:next,updated_at:new Date().toISOString(),last_mission_id:m.mission_id}).eq('goal_id',goalId).in('status',['queued','running','paused']).select('goal_id').maybeSingle();if(ue)throw new Error(ue.message);if(updated){if(next==='completed')completed++;else blocked++}}return{completed,blocked}}
async function runCanonicalMission(missionId:string,trigger='meditation-ia'){if(!RUNTIME_SECRET)return{status:'blocked',error:'meditation_runtime_secret_missing'};const response=await fetch(CANONICAL_RUNTIME,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${RUNTIME_SECRET}`,'x-aria-trigger':trigger},body:JSON.stringify({mission_id:missionId})});const text=await response.text();let payload:any;try{payload=text?JSON.parse(text):{}}catch{payload={status:'failed',error:'canonical_runtime_invalid_json'}};if(!response.ok)return{status:'failed',error:payload?.error||`canonical_runtime_${response.status}`,runtime_http_status:response.status};return{...payload,runtime_http_status:response.status}}
async function closeGoalOnMissionSuccess(m:any){const goalId=m?.metadata?.goal_id;if(!goalId)return;await supabase.schema('aria_internal').from('autonomy_goals').update({status:'completed',updated_at:new Date().toISOString(),last_mission_id:m.mission_id}).eq('goal_id',goalId).eq('status','running')}

async function resolveRwhtSecret(jobId:string,d:any,secretRef:string){
  if(typeof secretRef!=='string'||!/^secret:\/\/rwht\/rwht_[A-Za-z0-9._:-]+$/.test(secretRef))throw new Error('rwht_secret_ref_required');
  const {data:job,error:je}=await supabase.schema('aria_internal').from('execution_jobs').select('job_id,device_id,operation,status,command').eq('job_id',jobId).eq('device_id',d.device_id).maybeSingle();
  if(je||!job)throw new Error('job_not_found');
  if(job.operation!=='computer.use.android'||!['claimed','running'].includes(String(job.status)))throw new Error('secret_resolution_not_allowed');
  let payload:any={};try{payload=JSON.parse(String(job.command||'{}'));}catch{throw new Error('rwht_job_payload_invalid');}
  if(payload?.secret_ref!==secretRef)throw new Error('rwht_secret_ref_mismatch');
  const credentialName=secretRef.slice('secret://rwht/'.length);
  const {data:entry,error:ee}=await supabase.schema('aria_internal').from('credential_registry').select('credential_name,status,scope,credential_type').eq('credential_name',credentialName).maybeSingle();
  if(ee||!entry||entry.status!=='active'||!String(entry.scope||'').toLowerCase().includes('rwht'))throw new Error('credential_not_registered');
  const {data:secret,error:se}=await supabase.rpc('read_aria_credential_secret',{p_name:credentialName});
  if(se||typeof secret!=='string'||!secret.length)throw new Error('credential_unavailable');
  return{ok:true,secret_ref:secretRef,secret};
}
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
    'google/gemini-3.8-flash-direct':{provider_id:'google',account_id:'acct_google_gemini_free'},
    'google/gemini-3.7-flash-direct':{provider_id:'google',account_id:'acct_google_gemini_free'},
    'google/gemini-3.6-flash-direct':{provider_id:'google',account_id:'acct_google_gemini_free'},
    'google/gemini-3.5-flash-direct':{provider_id:'google',account_id:'acct_google_gemini_free'},
    'google/gemini-3.5-flash-lite-direct':{provider_id:'google',account_id:'acct_google_gemini_free'},
    'google/gemini-3.1-flash-lite-direct':{provider_id:'google',account_id:'acct_google_gemini_free'},
    'nvidia/nemotron-3-ultra-550b-a55b:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'poolside/laguna-s-2.1:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'inclusionai/ling-3.0-flash-fin:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nvidia/nemotron-3.5-lightning:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'thinking-machines/inkling:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'inclusionai/ling-3.0-flash-sante:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'thinking-machines/inkling-small:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'cohere/north-mini-code:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nex-agi/nex-n2.5-mini:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nex-agi/nex-n2.5-pro:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nvidia/nemotron-3-super-120b-a12b:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'deepseek/deepseek-v4-flash-0731:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'thinking-machines/inkling-small:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'inclusionai/ling-3.0-flash-vl:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'poolside/laguna-xs-2.1:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nvidia/nemotron-3-nano-omni:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nex-agi/nex-n2.5-mini:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'cohere/north-mini-code:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'dots-studio/dots3-note-preview:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'}
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
    if(!response.ok)return {ok:false,device_id:d.device_id,mission5:true,probe:true,model_id:modelId,provider_id:route.provider_id,account_id:route.account_id,runtime_status:payload?.status||'http_error',runtime_http_status:response.status,response:payload?.response||null,usage:payload?.usage||null,runtime_error:payload?.error||String(textBody||''),metadata:{...payload?.metadata,transport:'device-gateway',evidence_ref:`mission5:model-probe:${modelId}`}};
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
  const requiredMarker=agentId==='aria-agent-verifier-gemini35-v1'?'M5_VERIFIER_E2E_OK':'M5_AGENT_E2E_OK';
  if(!prompt||!prompt.includes(requiredMarker))throw new Error('mission5_probe_prompt_contract');
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
const M6_RISK:Record<string,number>={low:0,medium:1,high:2,critical:3};
const M6_RULES=[
 {domain:'coding',re:/\b(code|coding|debug|bug|refactor|program|implementation|typescript|javascript|sql|patch|fix)\b/i,roles:['coder']},
 {domain:'research',re:/\b(research|investigate|sources|compare|literature|synthesis|analysis)\b/i,roles:['researcher']},
 {domain:'planning',re:/\b(plan|planning|decompose|roadmap|architecture|break down)\b/i,roles:['planner']},
 {domain:'verification',re:/\b(verify|verification|review|audit|test|regression|check)\b/i,roles:['reviewer','verifier']},
 {domain:'security',re:/\b(security|threat|vulnerability|attack|secret|permission|auth)\b/i,roles:['security']},
 {domain:'memory',re:/\b(memory|recall|remember|consolidate|knowledge)\b/i,roles:['memory']},
 {domain:'device',re:/\b(device|windows|android|computer|hardware|diagnostic)\b/i,roles:['device']},
 {domain:'business',re:/\b(business|strategy|sales|market|customer|pricing)\b/i,roles:['business']}
];
function m6RiskAllowed(maxRisk:string,taskRisk:string){return Number.isFinite(M6_RISK[maxRisk||'medium'])&&Number.isFinite(M6_RISK[taskRisk||'low'])&&M6_RISK[maxRisk||'medium']>=M6_RISK[taskRisk||'low']}
function m6Complexity(task:string,explicit?:string){if(explicit&&['low','medium','high','critical'].includes(explicit))return explicit;if(/critical|production|irreversible|destructive|security|migration/i.test(task))return'critical';if(/complex|architecture|multi[- ]step|debug|research|deep|audit/i.test(task)||task.length>240)return'high';if(/write|summarize|classify|extract|transform|explain/i.test(task)||task.length>80)return'medium';return'low'}
function m6Domains(task:string){return M6_RULES.filter(x=>x.re.test(task)).map(x=>x.domain)}
function m6Num(v:any){return Number.isFinite(Number(v))?Number(v):null}
function m6FreeCost(p:any){const tier=String(p?.tier||p?.billing_tier||'').toLowerCase();if(tier==='free'||p?.cost==='$0'||p?.cost===0)return 1;const i=m6Num(p?.input_per_1m_tokens??p?.cost_per_1k_input_usd),o=m6Num(p?.output_per_1m_tokens??p?.cost_per_1k_output_usd);if(i===0&&o===0)return 1;if(i!==null||o!==null)return .5;return null}
function m6ClassifyFallbackFailure(error:any){const status=Number(error?.provider_status??error?.status??0),code=String(error?.code||'');if(status===429||code==='rate_limit')return'rate_limit';if(code==='credential_unavailable'||code==='account_unavailable')return'account_unavailable';if(status>=500||code==='provider_unavailable')return'provider_unavailable';return'execution_failure'}
function m6GovernFallback(primary:any,alternatives:any[],failureKind:string,policy:any={}){const visited=new Set(Array.isArray(policy?.visited)?policy.visited.map(String):[]);if(failureKind==='rate_limit'&&policy?.allow_rate_limit_fallback!==true)return[];return alternatives.filter((x:any)=>{const key=String(x?.provider_id||'')+'|'+String(x?.account_id||'')+'|'+String(x?.model_id||'');if(visited.has(key))return false;if(failureKind==='provider_unavailable'&&x?.provider_id===primary?.provider_id)return false;if(failureKind==='account_unavailable'&&x?.account_id===primary?.account_id)return false;return true})}
async function intelligentRouterDecision(b:any){
 const {data:snapshot,error}=await supabase.schema('aria_internal').rpc('router_live_snapshot');if(error)throw new Error(error.message);
 const candidates=Array.isArray(snapshot?.candidates)?snapshot.candidates:[];
 const tasks=Array.isArray(b?.tasks)?b.tasks:null;
 const choose=(input:any)=>{
  const task=String(input?.task||'').trim();if(!task)return{status:'no_route',reason:'task_required',version:'aria-intelligent-router-v2.0.0'};
  const capability=String(input?.capability||'text_generation'),complexity=m6Complexity(task,input?.complexity),risk=String(input?.risk||complexity),domains=m6Domains(task),latencies=candidates.map((c:any)=>m6Num(c.avg_latency_ms)).filter(Number.isFinite);
  const rejected:any[]=[];const ranked:any[]=[];
  for(const c of candidates.filter((x:any)=>x.capability_id===capability&&x.capability_verified===true)){
   const hard:string[]=[];if(c.status!=='available'||c.enabled!==true)hard.push('model_unavailable');if(c.integration_status==='not_connected')hard.push('integration_not_connected');if(c.account_status!=='available'||c.account_enabled!==true)hard.push('account_inactive');if(['unavailable','exhausted'].includes(String(c.quota_status)))hard.push('capacity_unavailable');if(['unavailable','exhausted'].includes(String(c.rate_limit_status)))hard.push('rate_limit_unavailable');if(c.live_verified!==true)hard.push('live_not_verified');
   const agents=Array.isArray(c.agents)?c.agents.filter((a:any)=>a?.status==='available'&&m6RiskAllowed(String(a.max_risk||'medium'),risk)):[];
   if(Array.isArray(c.agents)&&c.agents.length&&!agents.length)hard.push('no_agent_with_required_risk');
   if(risk==='critical'&&domains.length===0&&!agents.some((a:any)=>['security','reviewer','verifier','planner'].includes(String(a.role||''))))hard.push('critical_requires_specialist');
   if(c.context_window!==null&&Math.ceil(task.length/4)>Number(c.context_window))hard.push('context_too_small');
   const requiredTools=Array.isArray(input?.required_tools)?input.required_tools.map(String):[];
   if(requiredTools.length){const toolMatch=agents.some((a:any)=>{const caps=new Set(Array.isArray(a.capabilities)?a.capabilities.map(String):[]);const scope=new Set(Array.isArray(a.scope)?a.scope.map(String):[]);return requiredTools.every((t:string)=>caps.has(t)||scope.has(t));});if(!toolMatch)hard.push('required_tools_unavailable');}
   if(input?.prefer_specialist_agent===true&&!agents.length)hard.push('specialist_agent_required');
   if(input?.preferred_provider&&c.provider_id!==input.preferred_provider)hard.push('preferred_provider_mismatch');
   if(input?.preferred_model&&c.model_id!==input.preferred_model)hard.push('preferred_model_mismatch');
   if(hard.length){rejected.push({model_id:c.model_id,reasons:hard});continue}
   const attempts=m6Num(c.attempts)||0,successes=m6Num(c.successes)||0,reliability=attempts>0?Math.max(0,Math.min(1,successes/attempts)):null,latency=m6Num(c.avg_latency_ms),finite=latencies,latScore=latency===null?null:(Math.max(...finite)===Math.min(...finite)?1:(Math.max(...finite)-latency)/(Math.max(...finite)-Math.min(...finite)));
   const specialists=agents.filter((a:any)=>domains.some(d=>M6_RULES.find(x=>x.domain===d)?.roles.includes(String(a.role||''))));const rolePriority=domains.flatMap(d=>M6_RULES.find(x=>x.domain===d)?.roles||[]);const orderedAgents=specialists.slice().sort((a:any,b:any)=>{const ai=rolePriority.indexOf(String(a.role||'')),bi=rolePriority.indexOf(String(b.role||''));return (ai<0?999:ai)-(bi<0?999:bi)||String(a.agent_id).localeCompare(String(b.agent_id));});const spec=orderedAgents.length?1:(agents.some((a:any)=>Array.isArray(a.capabilities)&&a.capabilities.includes(capability))?.45:.5);const cost=m6FreeCost(c.pricing),direct=String(c.metadata?.access_path||'').includes('direct')?1:.5;const score=Number((.20+.15+.15*(reliability??.25)+.10*(latScore??.25)+.05*(cost??.25)+.30*spec+.05*direct).toFixed(6));const agent=orderedAgents[0]||agents[0]||null;
   ranked.push({...c,score,selection_evidence:{complexity,task_risk:risk,domains,reliability:{state:reliability===null?'unknown':'observed',attempts,successes,score:reliability},latency:{state:latency===null?'unknown':'observed',avg_latency_ms:latency,score:latScore},cost_state:cost===null?'unknown':cost,specialization:{score:spec,matches:specialists.map((a:any)=>a.agent_id)},live_verified:true,capability_verified:true,direct_path:direct},selected_agent_id:agent?.agent_id||null,selected_agent_role:agent?.role||null});
  }
  ranked.sort((a,b2)=>b2.score-a.score||String(a.provider_id).localeCompare(String(b2.provider_id))||String(a.model_id).localeCompare(String(b2.model_id)));
  if(!ranked.length)return{status:'no_route',reason:'no_eligible_candidate',version:'aria-intelligent-router-v2.0.0',complexity,task_risk:risk,domains,rejected_candidates:rejected};
  const w=ranked[0];return{status:'selected',version:'aria-intelligent-router-v2.0.0',capability,task,complexity,task_risk:risk,domains,selected:{provider_id:w.provider_id,account_id:w.account_id,model_id:w.model_id,capability,agent_id:w.selected_agent_id,agent_role:w.selected_agent_role},score:w.score,selection_evidence:w.selection_evidence,fallback:ranked.slice(1,4).map((x:any,i:number)=>({rank:i+2,provider_id:x.provider_id,account_id:x.account_id,model_id:x.model_id,agent_id:x.selected_agent_id,score:x.score})),candidates_considered:ranked.length,rejected_candidates:rejected}
 };
 let payload:any;
 if(tasks){
  const ids=new Set<string>();for(const t of tasks){const id=String(t?.id||'');if(!id||ids.has(id))return{status:'blocked',reason:'duplicate_or_missing_task_id',version:'aria-intelligent-router-v2.0.0'};ids.add(id)}
  const planTasks=tasks.map((t:any)=>({...t,id:String(t.id),depends_on:Array.isArray(t.depends_on)?t.depends_on.map(String):[]}));
  const batches:string[][]=[],done=new Set<string>();const maxParallel=Math.max(1,Math.floor(Number(b?.max_parallel||2)));
  for(const t of planTasks)for(const dep of t.depends_on)if(!ids.has(dep)||dep===t.id)return{status:'blocked',reason:'invalid_dependency',version:'aria-intelligent-router-v2.0.0'};
  while(done.size<planTasks.length){const ready=planTasks.filter((t:any)=>!done.has(t.id)&&t.depends_on.every((d:string)=>done.has(d))).slice(0,maxParallel);if(!ready.length)return{status:'blocked',reason:'dependency_cycle',version:'aria-intelligent-router-v2.0.0'};batches.push(ready.map((t:any)=>t.id));ready.forEach((t:any)=>done.add(t.id))}
  const selections=planTasks.map((t:any)=>({...choose({...t,capability:t.capability||b.capability||'text_generation',risk:t.risk||b.risk}),id:t.id}));
  payload={status:selections.every((s:any)=>s.status==='selected')?'selected':'no_route',version:'aria-intelligent-router-v2.0.0',selections,parallel_plan:{status:'planned',max_parallel:batches.length?maxParallel:1,batches}};
 }else payload=choose(b);
 const record=await supabase.schema('aria_internal').rpc('record_router_decision',{p_decision:{decision_id:'router_'+crypto.randomUUID(),trace_id:b?.trace_id||null,task:b?.task||'parallel_batch',capability_id:b?.capability||'text_generation',complexity:payload.complexity||'mixed',selected:payload.selected||null,fallback:payload.fallback||payload.selections?.map((x:any)=>x.fallback||[])||[],evidence:payload.selection_evidence||{parallel:!!tasks},candidates_considered:payload.candidates_considered||candidates.length,rejected:payload.rejected_candidates||payload.selections?.flatMap((x:any)=>x.rejected_candidates||[])||[],parallel_plan:payload.parallel_plan||null}});
 if(record.error)payload.persistence={recorded:false,error:record.error.message};else payload.persistence={recorded:true,decision_id:record.data?.decision_id};
 return payload;
}
async function intelligentRouterExecute(b:any,d:any){
  const authorization=b?.authorization;
  if(!authorization||authorization.status!=='approved')return{status:'blocked',reason:'authorization_not_approved'};
  const routeDecision=await intelligentRouterDecision({
    task:b?.task,capability:b?.capability||'text_generation',complexity:b?.complexity,risk:b?.risk,
    preferred_model:b?.preferred_model,preferred_provider:b?.preferred_provider,trace_id:b?.trace_id||null
  });
  if(routeDecision.status!=='selected')return{status:routeDecision.status||'no_route',route_decision:routeDecision};
  let routes=[routeDecision.selected,...(Array.isArray(routeDecision.fallback)?routeDecision.fallback:[])];
  const results:any[]=[];let primary=routes[0];let attempts=0;
  while(routes.length&&attempts<4){
    const selected=routes.shift();attempts++;
    if(!RUNTIME_SECRET)throw new Error('meditation_runtime_secret_missing');
    const response=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/aria-execution-runtime-v1`,{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${RUNTIME_SECRET}`,'x-aria-trigger':'mission6-router-execution'},
      body:JSON.stringify({
        execution_version:'1',request_id:`mission6:${d.device_id}:${crypto.randomUUID()}`,
        task_id:String(b?.task_id||'mission6-router-execution'),capability:b?.capability||'text_generation',
        selected_route:{status:'selected',provider_id:selected.provider_id,account_id:selected.account_id,model_id:selected.model_id,capability:b?.capability||'text_generation',agent_id:selected.agent_id||null},
        authorization,input:b?.input||{payload:{prompt:String(b?.task||'')}},
        policy:{risk:String(b?.risk||'READ'),mission6:true,router_decision:true,selected_agent_id:selected.agent_id||null}
      })
    });
    const tb=await response.text();let payload:any;try{payload=tb?JSON.parse(tb):{}}catch{payload={status:'failed',error:'invalid_execution_runtime_json'}};
    results.push({rank:attempts,route:selected,status:payload?.status||'failed',response:payload?.response||null,usage:payload?.usage||null,error:payload?.error||null});
    if(payload?.status==='succeeded')return{status:'succeeded',route_decision:routeDecision,selected_route:selected,attempts,attempt_results:results,fallback_used:attempts>1,metadata:{router_version:'aria-intelligent-router-v2.0.0',device_id:d.device_id}};
    const failureKind=m6ClassifyFallbackFailure(payload?.error||{provider_status:response.status});
    routes=m6GovernFallback(primary,routes,failureKind,{allow_rate_limit_fallback:b?.allow_rate_limit_fallback===true});
  }
  return{status:'failed',route_decision:routeDecision,attempts:results,fallback_used:results.length>1,metadata:{router_version:'aria-intelligent-router-v2.0.0',device_id:d.device_id}};
}
async function intelligentRouterParallelExecute(b:any,d:any){
 const authorization=b?.authorization;
 if(!authorization||authorization.status!=='approved')return{status:'blocked',reason:'authorization_not_approved'};
 const tasks=Array.isArray(b?.tasks)?b.tasks:[];
 if(!tasks.length)return{status:'blocked',reason:'tasks_required'};
 const decision=await intelligentRouterDecision({...b,tasks});
 if(decision.status!=='selected')return{status:decision.status||'no_route',route_decision:decision};
 const selectionById=new Map((decision.selections||[]).map((x:any)=>[String(x.id),x]));
 const results:any[]=[];
 for(const batch of decision.parallel_plan.batches){
   const batchResults=await Promise.all(batch.map(async(taskId:string)=>{
     const task=tasks.find((t:any)=>String(t.id)===taskId);
     const selection=selectionById.get(taskId);
     if(!selection||selection.status!=='selected')return{task_id:taskId,status:'failed',error:'route_not_selected'};
     let routes=[selection.selected,...(Array.isArray(selection.fallback)?selection.fallback:[])];
     const attempts:any[]=[];let primary=routes[0];let attemptCount=0;
     while(routes.length&&attemptCount<4){
       const selected=routes.shift();attemptCount++;
       const response=await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/aria-execution-runtime-v1`,{
         method:'POST',
         headers:{'content-type':'application/json',authorization:`Bearer ${RUNTIME_SECRET}`,'x-aria-trigger':'mission6-parallel-router'},
         body:JSON.stringify({
           execution_version:'1',
           request_id:`mission6-parallel:${d.device_id}:${crypto.randomUUID()}`,
           task_id:taskId,
           capability:task?.capability||b?.capability||'text_generation',
           selected_route:{status:'selected',provider_id:selected.provider_id,account_id:selected.account_id,model_id:selected.model_id,capability:task?.capability||b?.capability||'text_generation',agent_id:selected.agent_id||null},
           authorization,
           input:task?.input||b?.input||{payload:{prompt:String(task?.task||'')}},
           policy:{risk:String(task?.risk||b?.risk||'READ'),mission6:true,router_parallel:true,selected_agent_id:selected.agent_id||null}
         })
       });
       const tb=await response.text();let payload:any;try{payload=tb?JSON.parse(tb):{}}catch{payload={status:'failed',error:'invalid_execution_runtime_json'}};
       attempts.push({rank:attemptCount,route:selected,status:payload?.status||'failed',response:payload?.response||null,usage:payload?.usage||null,error:payload?.error||null});
       if(payload?.status==='succeeded')return{task_id:taskId,status:'succeeded',selected_route:selected,attempts,fallback_used:attemptCount>1};
       const failureKind=m6ClassifyFallbackFailure(payload?.error||{provider_status:response.status});
       routes=m6GovernFallback(primary,routes,failureKind,{allow_rate_limit_fallback:b?.allow_rate_limit_fallback===true});
     }
     return{task_id:taskId,status:'failed',attempts,fallback_used:attempts.length>1};
   }));
   results.push(...batchResults);
 }
 const failed=results.filter((x:any)=>x.status!=='succeeded');
 return{status:failed.length?'failed':'succeeded',route_decision:decision,results,parallel_verified:true,max_parallel:decision.parallel_plan.max_parallel,metadata:{router_version:'aria-intelligent-router-v2.0.0',device_id:d.device_id}};
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

async function meditationTick(b:any,d:any){const sessionId=String(b?.session_id||'').trim();const deviceId=String(d.device_id||'').trim();const recovered=await recoverStale();const learning=await learnRecent();const goalSync=await syncGoalTerminalStates();const autonomyOnly=b?.autonomy_only===true;const manual=autonomyOnly?null:await processManualQueue(b,d);if(manual)return{ok:manual.status!=='failed'&&manual.status!=='blocked',status:manual.status,manual_queue:true,queue_id:manual.queue_id,active_mission_id:manual.mission_id,recovered,learning,goalSync,runtime:manual.runtime||null};let activeQuery=supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,metadata,updated_at').contains('metadata',{source:'meditation-ia-v1'}).in('status',['queued','planning','running','paused']).eq('metadata->>device_id',deviceId).order('updated_at',{ascending:false});
if(sessionId)activeQuery=activeQuery.eq('metadata->>meditation_session_id',sessionId);
const {data:active,error:ae}=await activeQuery.limit(1);if(ae)throw new Error(ae.message);if(active?.length){const m=active[0];const runtime=await runCanonicalMission(m.mission_id);if(runtime.status==='succeeded')await closeGoalOnMissionSuccess(m);return{ok:runtime.status!=='failed'&&runtime.status!=='blocked',status:runtime.status||'runtime_unknown',active_mission_id:m.mission_id,goal:m.goal||null,recovered,learning,goalSync,created:false,runtime}}const now=new Date().toISOString();const [goalsRes,failuresRes,gapsRes,learningsRes]=await Promise.all([supabase.schema('aria_internal').from('autonomy_goals').select('*').in('status',['queued','paused','running','blocked','completed']),supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,last_stderr,last_stdout,updated_at,created_at,metadata').in('status',['failed','blocked','timeout']).gt('updated_at',new Date(Date.now()-72*60*60*1000).toISOString()).order('updated_at',{ascending:false}).limit(12),supabase.schema('aria_internal').from('capability_matrix').select('model_id,capability_id,status,evidence_type,evidence_ref,verified_at,notes,metadata,updated_at').neq('status','verified').order('updated_at',{ascending:false}).limit(30),supabase.schema('aria_internal').from('autonomy_learnings').select('lesson_id,mission_id,goal_id,category,summary,evidence,confidence,reusable,created_at').eq('reusable',true).order('created_at',{ascending:false}).limit(30)]);for(const r of [goalsRes,failuresRes,gapsRes,learningsRes])if(r.error)throw new Error(r.error.message);const goals=goalsRes.data||[];const candidates=generateCandidates({goals,failures:failuresRes.data||[],capabilityGaps:gapsRes.data||[],learnings:learningsRes.data||[]},{now});const blockedIds=new Set(goals.filter((g:any)=>['blocked','completed'].includes(g.status)).map((g:any)=>g.goal_id));const activeIds=new Set(goals.filter((g:any)=>g.status==='running').map((g:any)=>g.goal_id));let generated=[] as string[];const fingerprints=new Set(goals.map((g:any)=>keyOf(g.goal)).filter(Boolean));for(const c of candidates.slice(0,15)){if(goals.some((g:any)=>g.goal_id===c.goal_id)||fingerprints.has(keyOf(c.goal)))continue;const {error}=await supabase.schema('aria_internal').from('autonomy_goals').insert({goal_id:c.goal_id,goal:c.goal,priority:Math.round(c.priority),status:'queued',next_run_at:now,attempts:0,max_attempts:3,source_type:c.source_type,source_ref:c.source_ref||null,dynamic_score:c.dynamic_score,metadata:{...(c.metadata||{}),dynamic:true,source:'meditation-ia-v1'}});if(error&&!String(error.message||'').toLowerCase().includes('duplicate'))throw new Error(error.message);if(!error)generated.push(c.goal_id)}const {data:eligible,error:er}=await supabase.schema('aria_internal').from('autonomy_goals').select('*').eq('status','queued').lte('next_run_at',now).order('dynamic_score',{ascending:false}).limit(30);if(er)throw new Error(er.message);const ranked=generateCandidates({goals:eligible||[]},{now});const selected=selectDynamicGoal(ranked,{blockedIds,activeIds});if(!selected)return{ok:true,status:'idle',recovered,learning,goalSync,candidate_count:candidates.length,generated_count:generated.length,mission_created:null};const claimedAt=new Date().toISOString();const {data:claimed,error:ce}=await supabase.schema('aria_internal').from('autonomy_goals').update({status:'running',attempts:Number(selected.attempts||0)+1,updated_at:claimedAt}).eq('goal_id',selected.goal_id).eq('status','queued').select('*').maybeSingle();if(ce)throw new Error(ce.message);if(!claimed)return{ok:true,status:'raced',recovered,learning,goalSync};let existingByGoalQuery=supabase.schema('aria_internal').from('mission_state').select('mission_id,status,goal,metadata').eq('metadata->>goal_id',selected.goal_id).eq('metadata->>device_id',deviceId).in('status',['queued','planning','running','waiting','paused']).order('updated_at',{ascending:false});
if(sessionId)existingByGoalQuery=existingByGoalQuery.eq('metadata->>meditation_session_id',sessionId);
const existingByGoal=await existingByGoalQuery.limit(1).maybeSingle();if(existingByGoal.error)throw new Error(existingByGoal.error.message);if(existingByGoal.data){const existingRuntime=await runCanonicalMission(String(existingByGoal.data.mission_id));return{ok:existingRuntime.status!=='failed'&&existingRuntime.status!=='blocked',status:existingRuntime.status||'runtime_unknown',mission_created:null,active_mission_id:String(existingByGoal.data.mission_id),goal:selected.goal,goal_id:selected.goal_id,dynamic_score:selected.dynamic_score,goal_source:selected.source_type,reused_existing_mission:true,recovered,learning,goalSync,runtime:existingRuntime}}const missionId=`mission_${crypto.randomUUID()}`;const {data:mission,error:me}=await supabase.rpc('aria_mission_create',{p_mission:{mission_id:missionId,status:'queued',goal:selected.goal,current_step:0,completed_steps:0,checkpoint:{dynamic_goal_selection:{goal_id:selected.goal_id,score:selected.dynamic_score,source_type:selected.source_type,source_ref:selected.source_ref}},metadata:{source:'meditation-ia-v1',meditation_session_id:b.session_id||null,device_id:d.device_id,goal_id:selected.goal_id,dynamic_goal:true,dynamic_score:selected.dynamic_score??null,goal_source:selected.source_type??null,human_gate_required:['HIGH_RISK_WRITE','destructive','production_merge'],human_gate:(/\\b(production|prod|merge|main|master|delete|destroy|destructive|credential|secret|api[_ -]?key|password|payment|billing|purchase|deploy)\\b/i.test(String(selected.goal||''))?{enabled:true,method:'manual_confirmation',instructions:'Revisar y confirmar manualmente cualquier acción sensible antes de continuar.',reason:'La misión autónoma toca una frontera sensible de producción, credenciales, pago o cambio destructivo.'}:{enabled:false})}}});if(me){const duplicateInflight=String(me.code||'')==='23505'||String(me.message||'').includes('mission_state_one_inflight_goal_idx');if(duplicateInflight){let existingInflightQuery=supabase.schema('aria_internal').from('mission_state').select('mission_id,status,goal,metadata').eq('metadata->>goal_id',selected.goal_id).eq('metadata->>device_id',deviceId).in('status',['queued','planning','running','waiting','paused']).order('updated_at',{ascending:false});
if(sessionId)existingInflightQuery=existingInflightQuery.eq('metadata->>meditation_session_id',sessionId);
const {data:existingInflight,error:ei}=await existingInflightQuery.limit(1).maybeSingle();if(ei)throw new Error(ei.message);if(existingInflight){const existingRuntime=await runCanonicalMission(String(existingInflight.mission_id));return{ok:existingRuntime.status!=='failed'&&existingRuntime.status!=='blocked',status:existingRuntime.status||'runtime_unknown',mission_created:null,active_mission_id:String(existingInflight.mission_id),goal:selected.goal,goal_id:selected.goal_id,dynamic_score:selected.dynamic_score,goal_source:selected.source_type,reused_existing_mission:true,race_recovered:true,recovered,learning,goalSync,runtime:existingRuntime};}}await supabase.schema('aria_internal').from('autonomy_goals').update({status:'queued',attempts:Math.max(0,Number(claimed.attempts||1)-1),updated_at:new Date().toISOString()}).eq('goal_id',selected.goal_id).eq('status','running');throw new Error(me.message)}const {error:ue}=await supabase.schema('aria_internal').from('autonomy_goals').update({last_mission_id:missionId,updated_at:new Date().toISOString()}).eq('goal_id',selected.goal_id).eq('status','running');if(ue)throw new Error(ue.message);const runtime=await runCanonicalMission(missionId);let postLearning=null;if(runtime.status==='succeeded'){postLearning=await learnMissionViaV3(missionId);await supabase.schema('aria_internal').from('autonomy_goals').update({status:'completed',updated_at:new Date().toISOString(),last_mission_id:missionId}).eq('goal_id',selected.goal_id).eq('status','running');}return{ok:runtime.status!=='failed'&&runtime.status!=='blocked',status:runtime.status||'runtime_unknown',mission_created:missionId,goal:selected.goal,goal_id:selected.goal_id,dynamic_score:selected.dynamic_score,goal_source:selected.source_type,reused_existing_mission:false,race_recovered:false,recovered,learning,postLearning,goalSync,runtime}}
async function autonomyServiceAuthorized(r:Request){
  const t=(r.headers.get('authorization')||'').replace(/^Bearer\\s+/i,'');
  if(t&&RUNTIME_SECRET&&await Promise.resolve(t===RUNTIME_SECRET))return true;
  const cron=r.headers.get('x-aria-autonomy-token');
  if(!cron)return false;
  const {data,error}=await supabase.rpc('aria_autonomy_cron_authorize',{p_token:cron});
  return !error&&data===true;
}
function autonomyCycleId(now=new Date()){const slot=new Date(Math.floor(now.getTime()/60000)*60000);return`autonomy-cycle-${slot.toISOString().replace(/[:.]/g,'-')}`;}

async function autonomySnapshot(){
  const [goalsRes,activeRes,failRes,gapRes,learnRes]=await Promise.all([
    supabase.schema('aria_internal').from('autonomy_goals').select('goal_id,goal,priority,status,next_run_at,attempts,max_attempts,last_mission_id,created_at,updated_at,source_type,source_ref,dynamic_score,metadata').in('status',['queued','paused','running','blocked','completed']).order('updated_at',{ascending:false}).limit(300),
    supabase.schema('aria_internal').from('mission_state').select('mission_id,status,metadata,updated_at').in('status',['queued','planning','running','waiting','paused']).limit(100),
    supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,last_stderr,checkpoint,metadata,updated_at,created_at').in('status',['failed','blocked','timeout']).gt('updated_at',new Date(Date.now()-72*3600000).toISOString()).order('updated_at',{ascending:false}).limit(100),
    supabase.schema('aria_internal').from('capability_matrix').select('model_id,capability_id,status,evidence_type,evidence_ref,verified_at,notes,metadata,updated_at').neq('status','verified').order('updated_at',{ascending:false}).limit(100),
    supabase.schema('aria_internal').from('autonomy_learnings').select('lesson_id,goal_id,category,summary,evidence,confidence,reusable,created_at').in('category',['operational_failure','verified_success','verified_procedure']).gt('created_at',new Date(Date.now()-7*86400000).toISOString()).order('created_at',{ascending:false}).limit(100)
  ]);
  for(const r of [goalsRes,activeRes,failRes,gapRes,learnRes])if(r.error)throw new Error(r.error.message);
  return{goals:goalsRes.data||[],active:activeRes.data||[],failures:failRes.data||[],capabilityGaps:gapRes.data||[],learnings:learnRes.data||[]};
}
async function autonomyEnsureCandidates(candidates:any[],cycleId:string){
  let inserted=0;
  for(const c of candidates.slice(0,25)){
    const {data:exists,error:lookup}=await supabase.schema('aria_internal').from('autonomy_goals').select('goal_id,status').eq('goal_id',c.goal_id).maybeSingle();
    if(lookup)throw new Error(lookup.message);
    if(exists)continue;
    const {error}=await supabase.schema('aria_internal').from('autonomy_goals').insert({
      goal_id:c.goal_id,goal:c.goal,priority:Math.round(Number(c.priority??50)),status:'queued',
      next_run_at:new Date().toISOString(),attempts:0,max_attempts:3,source_type:c.source_type??'dynamic',
      source_ref:c.source_ref??c.goal_id,dynamic_score:Number(c.dynamic_score??0),
      metadata:{...(c.metadata&&typeof c.metadata==='object'?c.metadata:{}),autonomy_cycle_id:cycleId,generated_by:'aria-autonomy-cycle-v1',governed:true}
    });
    if(error){
      if(String(error.message||'').toLowerCase().includes('duplicate'))continue;
      throw new Error(error.message);
    }
    inserted++;
  }
  return inserted;
}
async function autonomyCycle(b:any){
  const cycle_id=autonomyCycleId();
  const {data:existing}=await supabase.schema('aria_internal').from('autonomy_cycles').select('*').eq('cycle_id',cycle_id).maybeSingle();
  if(existing)return{ok:true,deduplicated:true,cycle:existing};
  const recover=await supabase.rpc('aria_autonomy_recover_stale_missions',{p_stale_after:'00:02:00'});
  if(recover.error)throw new Error(`recovery:${recover.error.message}`);
  const governance=await supabase.schema('aria_internal').rpc('reconcile_mission_queue_governance_v1');
  if(governance.error)throw new Error(`queue_governance:${governance.error.message}`);
  const snap=await autonomySnapshot();
  const now=new Date().toISOString();
  const candidates=generateCandidates(snap,{now});
  const inserted=await autonomyEnsureCandidates(candidates,cycle_id);
  const refreshed=await autonomySnapshot();
  const blockedIds=new Set(refreshed.goals.filter((g:any)=>['blocked','completed'].includes(g.status)).map((g:any)=>g.goal_id));
  const activeIds=new Set(refreshed.goals.filter((g:any)=>g.status==='running').map((g:any)=>g.goal_id));
  const eligible=refreshed.goals.filter((g:any)=>g.status==='queued'&&(!g.next_run_at||Date.parse(g.next_run_at)<=Date.now()));
  const ranked=generateCandidates({goals:eligible},{now});
  const selected=selectDynamicGoal(ranked,blockedIds,activeIds);
  await supabase.schema('aria_internal').from('autonomy_cycles').insert({
    cycle_id,cycle_slot:new Date(Math.floor(Date.now()/60000)*60000).toISOString(),
    trigger:String(b?.trigger||'manual'),status:'started',policy_version:'autonomy-post-plan-v1',
    active_missions_count:refreshed.active.length,goals_scanned:refreshed.goals.length,
    failures_scanned:refreshed.failures.length,capability_gaps_scanned:refreshed.capabilityGaps.length,
    learnings_scanned:refreshed.learnings.length,candidates_generated:candidates.length,candidates_inserted:inserted
  });
  if(!selected){
    const evidence={recovery:recover.data??0,queue_governance:governance.data??null,reason:'no_eligible_goal'};
    await supabase.schema('aria_internal').from('autonomy_cycles').update({status:'idle',evidence,updated_at:new Date().toISOString()}).eq('cycle_id',cycle_id);
    return{ok:true,deduplicated:false,cycle_id,status:'idle',policy_version:'autonomy-post-plan-v1',generated_candidates:candidates.length,inserted_candidates:inserted};
  }
  const {data:claimed,error:claimError}=await supabase.schema('aria_internal').from('autonomy_goals').update({status:'running',attempts:Number(selected.attempts||0)+1,updated_at:new Date().toISOString()}).eq('goal_id',selected.goal_id).eq('status','queued').select('*').maybeSingle();
  if(claimError)throw new Error(`goal_claim:${claimError.message}`);
  if(!claimed){
    await supabase.schema('aria_internal').from('autonomy_cycles').update({status:'raced',evidence:{reason:'goal_claim_lost_race'},updated_at:new Date().toISOString()}).eq('cycle_id',cycle_id);
    return{ok:true,deduplicated:false,cycle_id,status:'raced',policy_version:'autonomy-post-plan-v1'};
  }
  const {data:existingMission,error:existingError}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,status,goal,metadata').eq('metadata->>goal_id',selected.goal_id).in('status',['queued','planning','running','waiting','paused']).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(existingError)throw new Error(`existing_mission:${existingError.message}`);
  let missionId:string;
  let reused=false;
  if(existingMission){
    missionId=String(existingMission.mission_id);reused=true;
  }else{
    const missionPayload={mission_id:`auto_${crypto.randomUUID()}`,status:'queued',goal:String(selected.goal),current_step:0,completed_steps:0,
      checkpoint:{autonomy:{cycle_id,source_type:selected.source_type??null,source_ref:selected.source_ref??null,dynamic_score:selected.dynamic_score??null}},
      metadata:{source:'autonomy-loop-v1',autonomy_cycle_id:cycle_id,goal_id:selected.goal_id,device_id:b.device_id||null,dynamic_goal:true,dynamic_score:selected.dynamic_score??null,goal_source:selected.source_type??null,human_gate:/\\b(production|prod|merge|main|master|delete|destroy|destructive|credential|secret|api[_ -]?key|password|payment|billing|purchase|deploy)\\b/i.test(String(selected.goal||''))?{enabled:true,method:'manual_confirmation',instructions:'Revisar y confirmar manualmente cualquier acción sensible antes de continuar.',reason:'La misión autónoma toca una frontera sensible de producción, credenciales, pago o cambio destructivo.'}:{enabled:false}}};
    const {data:created,error:ce}=await supabase.rpc('aria_mission_create',{p_mission:missionPayload});
    if(ce){
      if(String(ce.code||'')==='23505'||String(ce.message||'').includes('mission_state_one_inflight_goal_idx')){
        const {data:race}=await supabase.schema('aria_internal').from('mission_state').select('mission_id,status,goal,metadata').eq('metadata->>goal_id',selected.goal_id).in('status',['queued','planning','running','waiting','paused']).order('created_at',{ascending:false}).limit(1).maybeSingle();
        if(!race)throw new Error(ce.message);
        missionId=String(race.mission_id);reused=true;
      }else{
        await supabase.schema('aria_internal').from('autonomy_goals').update({status:'queued',attempts:Math.max(0,Number(claimed.attempts||1)-1),updated_at:new Date().toISOString()}).eq('goal_id',selected.goal_id).eq('status','running');
        throw new Error(`mission_create:${ce.message}`);
      }
    }else{
      missionId=String(created.mission_id);
    }
  }
  await supabase.schema('aria_internal').from('autonomy_goals').update({status:'running',last_mission_id:missionId,updated_at:new Date().toISOString()}).eq('goal_id',selected.goal_id).eq('status','running');
  const runtime=await runCanonicalMission(missionId,'autonomy-7');
  let learningResult:any=null;
  if(runtime.status==='succeeded')learningResult=await learnMissionViaV3(missionId);
  const {data:finished}=await supabase.schema('aria_internal').from('mission_state').select('status,last_exit_code,last_stdout,last_stderr,checkpoint,metadata,finished_at').eq('mission_id',missionId).maybeSingle();
  const goalStatus=finished?.status==='succeeded'?'completed':(finished?.status==='failed'?'queued':'running');
  await supabase.schema('aria_internal').from('autonomy_goals').update({status:goalStatus,last_mission_id:missionId,updated_at:new Date().toISOString()}).eq('goal_id',selected.goal_id).eq('status','running');
  const status=finished?.status==='succeeded'?'completed':finished?.status==='failed'?'failed':finished?.status==='blocked'?'blocked':finished?.status==='paused'||finished?.status==='waiting'?'waiting':runtime.status||'processed';
  const evidence={recovery:recover.data??0,queue_governance:governance.data??null,selected,reused_mission:reused,runtime,finished,learning:learningResult};
  await supabase.schema('aria_internal').from('autonomy_cycles').update({
    status,selected_goal_id:selected.goal_id,created_mission_id:missionId,mission_status:finished?.status??null,
    learning_result:learningResult??{},evidence,updated_at:new Date().toISOString()
  }).eq('cycle_id',cycle_id);
  return{ok:status!=='failed'&&status!=='blocked',deduplicated:false,cycle_id,status,policy_version:'autonomy-post-plan-v1',selected_goal:selected,mission_id:missionId,reused_mission:reused,runtime,learning:learningResult};
}

async function githubAuditRead(operation:string,args:Record<string,unknown>){
  const r=await fetch(`${SUPABASE_URL}/functions/v1/aria-github-app-runtime-v1`,{
    method:'POST',
    headers:{'content-type':'application/json','x-aria-autonomy-token':RUNTIME_SECRET},
    body:JSON.stringify({operation,...args})
  });
  const b:any=await r.json().catch(()=>null);
  if(!r.ok||b?.ok!==true)throw new Error(String(b?.error||'github_audit_read_failed'));
  return b.data;
}
async function buildAllForOneSnapshot(){
  const now=new Date().toISOString();
  const [models,agents,devices,accounts,active,failures,cycles,security,tree,critical]=await Promise.all([
    supabase.schema('aria_internal').from('model_registry').select('model_id,display_name,provider_id,status,enabled,integration_status,interface_type,model_family,capabilities,updated_at').order('display_name'),
    supabase.schema('aria_internal').from('agent_catalog').select('agent_id,role,status,model_id,capabilities,max_risk,scope,updated_at').order('agent_id'),
    supabase.schema('aria_internal').from('device_registry').select('device_id,display_name,agent_type,status,capabilities,last_seen_at,updated_at').order('display_name'),
    supabase.schema('aria_internal').from('account_registry').select('account_id,provider_id,display_name,status,enabled,secret_present,interface_type,credential_type,models,capabilities').eq('enabled',true).order('provider_id'),
    supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,last_stderr,updated_at').in('status',['queued','planning','running','waiting','paused']).order('updated_at',{ascending:false}).limit(100),
    supabase.schema('aria_internal').from('mission_state').select('mission_id,goal,status,last_stderr,checkpoint,updated_at').in('status',['failed','blocked','timeout']).gt('updated_at',new Date(Date.now()-72*3600000).toISOString()).order('updated_at',{ascending:false}).limit(100),
    supabase.schema('aria_internal').from('autonomy_cycles').select('cycle_id,status,selected_goal_id,created_mission_id,mission_status,learning_result,created_at').order('created_at',{ascending:false}).limit(20),
    supabase.schema('aria_internal').rpc('get_all_for_one_security_snapshot'),
    githubAuditRead('tree_read',{owner:'Robvg9',repo:'aria-worker',branch:'main'}),
    Promise.all([
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'supabase/functions/aria-device-gateway/index.ts'}),
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'supabase/functions/aria-app-api-v3/index.ts'}),
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'supabase/functions/aria-autonomy-supervisor-v5/index.ts'}),
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'supabase/functions/aria-agent-runtime-v1/index.ts'}),
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'supabase/functions/aria-execution-runtime-v1/index.ts'}),
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'tools/registry.json'}),
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'autonomy/universal-execution/registry.json'}),
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'models/registry.json'}),
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'agents/catalog-adapter-v2.js'}),
      githubAuditRead('file_read',{owner:'Robvg9',repo:'aria-worker',branch:'main',path:'tests/all-for-one-forensic-audit.test.js'})
    ])
  ]);
  for(const x of [models,agents,devices,accounts,active,failures,cycles])if((x as any).error)throw new Error((x as any).error.message);
  const normalizeFiles=(items:any[])=>items.map((x:any)=>({path:x.path,content:typeof x.content==='string'?x.content.slice(0,8000):String(x.content??'')}));  
  return{
    generated_at:now,
    main_tree:{sha:tree?.sha??null,truncated:tree?.truncated===true,path_count:Array.isArray(tree?.paths)?tree.paths.length:0,paths:Array.isArray(tree?.paths)?tree.paths.slice(0,1200):[]},
    critical_files:normalizeFiles(critical||[]),
    supabase:{
      models:models.data||[],agents:agents.data||[],devices:devices.data||[],accounts:accounts.data||[],
      active_missions:active.data||[],recent_failures:failures.data||[],recent_autonomy_cycles:cycles.data||[],
      security:security?.data??security?.result??null
    },
    audit_rule:'evidence-first; root-cause over patch; no writes from first-pass auditors; every eligible agent/model attempted; unavailable surfaces preserved as gaps'
  };
}
function auditPrompt(scope:any,role:string,label:string){
  return [
    'ALL FOR ONE FORENSIC AUDIT v1.',
    'You are an independent ARIA auditor. This is READ-ONLY. Do not propose pretending a fix was executed.',
    'Your lens: '+role+' / '+label+'.',
    'Challenge both the implementation and the previous audit assumptions.',
    'Look for bugs, authority drift, duplicated paths, stale workflows, security issues, incorrect claims, missing observability, model routing failures, agent/resource mismatch, device gaps, PWA/API mismatches, and efficiency/reliability opportunities.',
    'For every finding classify CONFIRMED, HYPOTHESIS, or BLOCKED; include concrete evidence from the supplied snapshot.',
    'Prioritize root causes and identify what second test would prove or disprove the finding.',
    'Return: FINDINGS:, PRIORITY:, EVIDENCE:, ROOT_CAUSE:, RECOMMENDED_TEST:, VERDICT:.',
    'AUDIT SNAPSHOT:',
    JSON.stringify(scope).slice(0,65000)
  ].join('\n');
}
async function runAgentAuditor(runId:string,a:any,snapshot:any){
  const body={agent_id:a.agent_id,operation:'delegate',mission_id:'all-for-one-'+runId,step_id:'audit-agent-'+a.agent_id,risk:'READ',input:{message:auditPrompt(snapshot,String(a.role||'general'),String(a.agent_id))},policy:{tool_use:false,read_only:true,audit_protocol:'all-for-one-v1'}};
  const r=await fetch(`${SUPABASE_URL}/functions/v1/aria-agent-runtime-v1`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${RUNTIME_SECRET}`},body:JSON.stringify(body)});
  const b:any=await r.json().catch(()=>null);
  if(!r.ok||b?.status!=='succeeded')throw new Error(String(b?.error?.message||b?.error||`agent_runtime_${r.status}`));
  return {status:'succeeded',report:String(b?.response?.content??''),model_id:b?.model_id??a.model_id,metadata:b};
}
function classifyAllForOneProviderBlock(payload:any,httpStatus:number){
  const error=payload?.error&&typeof payload.error==='object'?payload.error:{};
  const providerStatus=Number(error?.provider_status??payload?.provider_status??httpStatus);
  const code=String(error?.code??payload?.code??'');
  const message=String(error?.message??payload?.message??'');
  if(providerStatus===429||code==='rate_limit'||/rate\s*limit|free-models-per-day/i.test(message)){
    return {reason:'rate_limit',provider_status:providerStatus||429,message};
  }
  if(providerStatus>=500||code==='provider_unavailable'||/currently experiencing high demand|spikes in demand|temporarily unavailable|service unavailable/i.test(message)){
    return {reason:'provider_unavailable',provider_status:providerStatus||503,message};
  }
  return null;
}
async function runModelAuditor(runId:string,m:any,account:any,snapshot:any){
  if(!account)throw new Error('model_account_unavailable');
  const selected={status:'selected',provider_id:account.provider_id,account_id:account.account_id,model_id:m.model_id,capability:'text_generation'};
  const r=await fetch(`${SUPABASE_URL}/functions/v1/aria-execution-runtime-v1`,{
    method:'POST',
    headers:{'content-type':'application/json',authorization:`Bearer ${RUNTIME_SECRET}`},
    body:JSON.stringify({
      execution_version:'1',
      request_id:'all-for-one:'+runId+':model:'+m.model_id+':'+crypto.randomUUID(),
      task_id:'all-for-one:'+runId,
      capability:'text_generation',
      selected_route:selected,
      authorization:{status:'approved',risk_class:'READ',evidence_ref:'all-for-one-v1'},
      input:{payload:{prompt:auditPrompt(snapshot,'independent model reviewer',String(m.model_id)).slice(0,16000),max_tokens:1400,temperature:0}},
      policy:{read_only:true},
      metadata:{executor_type:'model',audit_protocol:'all-for-one-v1',run_id:runId,model_id:m.model_id}
    })
  });
  const b:any=await r.json().catch(()=>null);
  if(!r.ok||b?.status!=='succeeded'){
    const blocked=classifyAllForOneProviderBlock(b,r.status);
    if(blocked){
      return {
        status:'blocked',
        reason:blocked.reason,
        report:'PROVIDER BLOCKED: '+blocked.reason+' — '+blocked.message,
        model_id:m.model_id,
        metadata:{classification:'blocked_provider',reason:blocked.reason,provider_status:blocked.provider_status,error:b?.error??null}
      };
    }
    throw new Error(String(b?.error?.message||b?.error||`model_runtime_${r.status}`));
  }
  return {status:'succeeded',report:String(b?.response?.content??''),model_id:m.model_id,metadata:b};
}
async function allForOneStart(){
  const {data:existing}=await supabase.schema('aria_internal').from('all_for_one_runs').select('*').order('updated_at',{ascending:false}).limit(1).maybeSingle();
  const currentTree=await githubAuditRead('tree_read',{owner:'Robvg9',repo:'aria-worker',branch:'main'});
  if(existing&&existing.target_commit===currentTree?.sha)return existing;
  const snapshot=await buildAllForOneSnapshot();
  const enabledModels=(snapshot.supabase.models||[]).filter((m:any)=>m.status==='available'&&m.enabled===true);
  const availableAgents=(snapshot.supabase.agents||[]).filter((a:any)=>a.status==='available');
  const accounts=snapshot.supabase.accounts||[];
  const hasAccount=(m:any)=>accounts.find((a:any)=>a.provider_id===m.provider_id&&a.status==='available'&&a.enabled===true&&Array.isArray(a.models)&&a.models.includes(m.model_id));
  const surfaces=[
    ...(snapshot.supabase.devices||[]).map((d:any)=>({type:'surface',key:'device:'+d.device_id,report:'DEVICE SURFACE: '+d.display_name+' status='+d.status+' last_seen='+String(d.last_seen_at)})),
    {type:'surface',key:'executor:connector',report:'EXECUTOR SURFACE: connector — inspect registry and configured connector status.'},
    {type:'surface',key:'executor:device',report:'EXECUTOR SURFACE: device — inspect Windows/Android device evidence and operation contracts.'},
    {type:'surface',key:'executor:agent',report:'EXECUTOR SURFACE: agent — inspect delegation/governance contracts.'},
    {type:'surface',key:'executor:model',report:'EXECUTOR SURFACE: model — inspect route selection and execution verification.'},
    {type:'surface',key:'executor:eas',report:'EXECUTOR SURFACE: eas — status is audited as unknown unless a live route exists.'},
    {type:'surface',key:'tool:tool_aria_context',report:'TOOL SURFACE: aria_context — contract/evidence audit only; no side effect.'},
    {type:'surface',key:'tool:tool_aria_memory_capture',report:'TOOL SURFACE: aria_memory_capture — contract audit only; no write is triggered.'},
    {type:'surface',key:'connection:supabase',report:'CONNECTION SURFACE: Supabase — live DB evidence collected.'},
    {type:'surface',key:'connection:github',report:'CONNECTION SURFACE: GitHub App — live tree and file evidence collected.'},
    {type:'surface',key:'connection:models',report:'CONNECTION SURFACE: model providers — audited by independent model executions.'}
  ];
  const {data:run,error:re}=await supabase.schema('aria_internal').from('all_for_one_runs').insert({status:'auditing',phase:'first_pass',target_ref:'main',target_commit:snapshot.main_tree.sha,scope:{eligible_agents:availableAgents.length,eligible_models:enabledModels.length,surfaces:surfaces.length},coverage:{},summary:{},snapshot}).select('*').single();
  if(re)throw new Error(re.message);
  const rows=[
    ...availableAgents.map((a:any)=>({run_id:run.run_id,auditor_type:'agent',auditor_key:a.agent_id,model_id:a.model_id,status:'queued',evidence_mode:'snapshot'})),
    ...enabledModels.map((m:any)=>({run_id:run.run_id,auditor_type:'model',auditor_key:m.model_id,model_id:m.model_id,status:hasAccount(m)?'queued':'blocked',evidence_mode:'snapshot',error:hasAccount(m)?null:'no_available_account_for_model'})),
    ...surfaces.map((s:any)=>({run_id:run.run_id,auditor_type:s.type,auditor_key:s.key,status:'completed',evidence_mode:'deterministic',report:s.report}))
  ];
  const {error:ae}=await supabase.schema('aria_internal').from('all_for_one_auditors').insert(rows);
  if(ae)throw new Error(ae.message);
  await supabase.schema('aria_internal').from('all_for_one_runs').update({coverage:{agents:{eligible:availableAgents.length,queued:availableAgents.length},models:{eligible:enabledModels.length,queued:enabledModels.filter(hasAccount).length,blocked:enabledModels.filter((m:any)=>!hasAccount(m)).length},surfaces:{total:surfaces.length,completed:surfaces.length}},updated_at:new Date().toISOString()}).eq('run_id',run.run_id);
  return run;
}
async function allForOneTick(){
  const runRes=await supabase.schema('aria_internal').from('all_for_one_runs').select('*').in('status',['auditing','reviewing']).order('updated_at',{ascending:false}).limit(1).maybeSingle();
  const run=runRes.data;
  if(!run)return{ok:true,status:'idle',reason:'no_active_all_for_one_run'};
  if(run.status==='auditing'){
    const {data:pending}=await supabase.schema('aria_internal').from('all_for_one_auditors').select('*').eq('run_id',run.run_id).eq('status','queued').order('created_at',{ascending:true}).limit(4);
    if((pending||[]).length){
      const results=await Promise.allSettled((pending||[]).map(async(a:any)=>{
        await supabase.schema('aria_internal').from('all_for_one_auditors').update({status:'running',attempt:Number(a.attempt||0)+1,started_at:new Date().toISOString()}).eq('auditor_id',a.auditor_id).eq('status','queued');
        try{
          let out:any;
          if(a.auditor_type==='agent'){
            const agent=(run.snapshot?.supabase?.agents||[]).find((x:any)=>x.agent_id===a.auditor_key);
            out=await runAgentAuditor(run.run_id,agent,run.snapshot);
          }else if(a.auditor_type==='model'){
            const model=(run.snapshot?.supabase?.models||[]).find((x:any)=>x.model_id===a.auditor_key);
            const account=(run.snapshot?.supabase?.accounts||[]).find((x:any)=>x.provider_id===model?.provider_id&&x.status==='available'&&x.enabled===true&&Array.isArray(x.models)&&x.models.includes(a.auditor_key));
            out=await runModelAuditor(run.run_id,model,account,run.snapshot);
          }else{
            out={status:'succeeded',report:String(a.report||'deterministic surface audit'),model_id:null};
          }
          const auditorStatus=out.status==='blocked'?'blocked':'completed';
          const auditorVerdict=out.status==='blocked'?'blocked_provider':'audited';
          await supabase.schema('aria_internal').from('all_for_one_auditors').update({status:auditorStatus,report:out.report,evidence:out.metadata??{},verdict:auditorVerdict,error:out.status==='blocked'?String(out.reason||'provider_blocked'):null,finished_at:new Date().toISOString()}).eq('auditor_id',a.auditor_id);
          return out;
        }catch(e){
          await supabase.schema('aria_internal').from('all_for_one_auditors').update({status:'failed',error:e instanceof Error?e.message:String(e),finished_at:new Date().toISOString()}).eq('auditor_id',a.auditor_id);
          return {status:'failed',error:e instanceof Error?e.message:String(e)};
        }
      }));
      return{ok:true,status:'auditing',run_id:run.run_id,processed:results.length};
    }
    const {data:auditors}=await supabase.schema('aria_internal').from('all_for_one_auditors').select('auditor_id,auditor_type,auditor_key,model_id,status,report,error').eq('run_id',run.run_id);
    const open=(auditors||[]).filter((a:any)=>a.status==='queued'||a.status==='running');
    if(open.length)return{ok:true,status:'auditing',run_id:run.run_id,pending:open.length};
    const reviewers=[
      {type:'agent',key:'aria-agent-verifier-gemini35-v1',model_id:'google/gemini-3.5-flash-lite-direct'},
      {type:'agent',key:'aria-agent-security-v1',model_id:'google/gemini-3.5-flash-lite-direct'}
    ];
    for(const reviewer of reviewers){
      await supabase.schema('aria_internal').from('all_for_one_reviews').upsert({run_id:run.run_id,reviewer_type:reviewer.type,reviewer_key:reviewer.key,model_id:reviewer.model_id,status:'queued'},{onConflict:'run_id,reviewer_type,reviewer_key'});
    }
    await supabase.schema('aria_internal').from('all_for_one_runs').update({status:'reviewing',phase:'second_pass',updated_at:new Date().toISOString()}).eq('run_id',run.run_id);
    return{ok:true,status:'reviewing',run_id:run.run_id,first_pass:'complete'};
  }
  if(run.status==='reviewing'){
    const {data:reviews}=await supabase.schema('aria_internal').from('all_for_one_reviews').select('*').eq('run_id',run.run_id);
    const queued=(reviews||[]).filter((r:any)=>r.status==='queued').slice(0,2);
    const reports=(await supabase.schema('aria_internal').from('all_for_one_auditors').select('auditor_type,auditor_key,model_id,status,report,error').eq('run_id',run.run_id)).data||[];
    const evidenceText=reports.map((r:any)=>'['+r.auditor_type+':'+r.auditor_key+'] '+String(r.report||r.error||'')).join('\n\n').slice(0,70000);
    if(queued.length){
      const out=await Promise.allSettled(queued.map(async(r:any)=>{
        const reviewerPrompt='SECOND-PASS ADVERSARIAL REVIEW. Challenge these first-pass findings. Confirm, reject, or mark unresolved. Identify duplicated claims and missing evidence. Do not make changes. Return CONFIRMED, REJECTED, UNRESOLVED and the strongest evidence.\\n\\nFIRST PASS REPORTS:\\n'+evidenceText;
        try{
          const body={agent_id:r.reviewer_key,operation:'delegate',mission_id:'all-for-one-review-'+run.run_id,step_id:'review-'+r.reviewer_key,risk:'READ',input:{message:reviewerPrompt},policy:{tool_use:false,read_only:true,audit_protocol:'all-for-one-v1-second-pass'}};
          const rr=await fetch(`${SUPABASE_URL}/functions/v1/aria-agent-runtime-v1`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${RUNTIME_SECRET}`},body:JSON.stringify(body)});
          const b:any=await rr.json().catch(()=>null);
          if(!rr.ok||b?.status!=='succeeded')throw new Error(String(b?.error?.message||b?.error||'review_failed'));
          await supabase.schema('aria_internal').from('all_for_one_reviews').update({status:'completed',review:String(b?.response?.content??''),verdict:'reviewed',updated_at:new Date().toISOString()}).eq('review_id',r.review_id);
          return b;
        }catch(e){
          await supabase.schema('aria_internal').from('all_for_one_reviews').update({status:'failed',review:String(e instanceof Error?e.message:String(e)),verdict:'failed',updated_at:new Date().toISOString()}).eq('review_id',r.review_id);
          return null;
        }
      }));
      return{ok:true,status:'reviewing',run_id:run.run_id,processed:out.length};
    }
    const counts=(reviews||[]).reduce((a:any,r:any)=>{a[r.status]=(a[r.status]||0)+1;return a},{});
    const auditRows=reports.reduce((a:any,r:any)=>{a[r.status]=(a[r.status]||0)+1;return a},{});
    const coverage={first_pass:{auditors:reports.length,completed:auditRows.completed||0,failed:auditRows.failed||0,blocked:auditRows.blocked||0},second_pass:{reviewers:reviews?.length||0,completed:counts.completed||0,failed:counts.failed||0}};
    const finalStatus=(coverage.first_pass.failed===0&&coverage.second_pass.completed===coverage.second_pass.reviewers)?'completed':'completed_with_gaps';
    await supabase.schema('aria_internal').from('all_for_one_runs').update({status:finalStatus,phase:'closed',coverage,summary:{protocol:'all-for-one-v1',double_review:true,evidence_only_surfaces:true},updated_at:new Date().toISOString(),completed_at:new Date().toISOString()}).eq('run_id',run.run_id);
    return{ok:true,status:finalStatus,run_id:run.run_id,coverage};
  }
  return{ok:true,status:'idle',run_id:run.run_id};
}
Deno.serve(async(req)=>{const u=new URL(req.url);const p=u.pathname.replace(/^\/aria-device-gateway/,'').replace(/\/+$/,'')||'/';const b=await body(req);if(req.method==='GET'&&p==='/health')return json({ok:true,service:'aria-device-gateway',version:'12',canonical_runtime:true,meditation_owned_missions:true,goal_completion_sync:true,recursive_failure_guard:true,idea_to_mission:true});if(req.method==='POST'&&p==='/v1/devices/enroll'){if(typeof b.device_id!=='string'||typeof b.token!=='string')return json({error:'device_id_and_token_required'},400);const {data,error}=await supabase.rpc('enroll_device',{p_device_id:b.device_id,p_token:b.token});if(error)return json({error:'enrollment_failed',code:error.code??null,message:error.message??null},409);return json(data)}if(req.method==='POST'&&p==='/v1/meditation/tick-service'){
 try{
  if(!await autonomyServiceAuthorized(req))return json({error:'unauthorized'},401);
  const {data:control,error:ce}=await supabase.schema('aria_internal').from('meditation_control').select('controller_id,owner_user_id,desired_mode,session_id,metadata').eq('controller_id','primary').maybeSingle();
  if(ce)return json({ok:false,status:'failed',error:ce.message},500);
  if(!control||control.desired_mode!=='active')return json({ok:true,status:'inactive',service_tick:true});
  let deviceId=String(b.device_id||'').trim();
  let device:any=null;
  if(deviceId){
   const {data}=await supabase.schema('aria_internal').from('device_registry').select('device_id,agent_type,status,capabilities,last_seen_at,metadata').eq('device_id',deviceId).maybeSingle();
   device=data||null;
   if(device&&device.agent_type!=='android-termux')return json({ok:false,status:'blocked',error:'android_device_required',service_tick:true},409);
  }else{
   const {data}=await supabase.schema('aria_internal').from('device_registry').select('device_id,agent_type,status,capabilities,last_seen_at,metadata').eq('agent_type','android-termux').eq('status','online').order('last_seen_at',{ascending:false}).limit(1);
   device=data?.[0]||null;deviceId=device?.device_id||'';
  }
  if(!device||device.status==='disabled')return json({ok:false,status:'blocked',error:'android_device_unavailable',service_tick:true},200);
  const tick=await meditationTick({session_id:b.session_id||control.session_id||null,autonomy_only:false,service_tick:true,source:String(b.source||'cloud-meditation-supervisor')},{device_id:device.device_id,agent_type:device.agent_type,capabilities:device.capabilities||[]});
  const metadata={...(control.metadata&&typeof control.metadata==='object'?control.metadata:{}),device_id:device.device_id,last_cloud_mission_id:tick.active_mission_id||null,last_cloud_tick_status:tick.status||null};
  await supabase.schema('aria_internal').from('meditation_control').update({metadata,last_cloud_tick_at:new Date().toISOString(),last_cloud_status:String(tick.status||'unknown'),updated_at:new Date().toISOString()}).eq('controller_id','primary');
  return json({ok:tick.ok!==false,status:tick.status||'unknown',service_tick:true,device_id:device.device_id,mission_id:tick.active_mission_id||null,tick});
 }catch(e){return json({ok:false,status:'failed',error:e instanceof Error?e.message:String(e),service_tick:true},200)}
}
if(req.method==='POST'&&p==='/v1/autonomy/cycle'){try{let serviceAuthorized=await autonomyServiceAuthorized(req);if(!serviceAuthorized){const deviceAuth=await auth(req,b.device_id);if(deviceAuth.error)return deviceAuth.error;b.device_id=deviceAuth.device.device_id;}return json(await autonomyCycle(b))}catch(e){return json({ok:false,status:'blocked',error:queueError(e),policy_version:'autonomy-post-plan-v1'},200)}}
if(req.method==='POST'&&p==='/v1/audit/all-for-one/start'){try{if(!await autonomyServiceAuthorized(req))return json({error:'unauthorized'},401);return json(await allForOneStart())}catch(e){return json({ok:false,status:'failed',error:queueError(e)},200)}}
if(req.method==='POST'&&p==='/v1/audit/all-for-one/tick'){try{if(!await autonomyServiceAuthorized(req))return json({error:'unauthorized'},401);return json(await allForOneTick())}catch(e){return json({ok:false,status:'failed',error:queueError(e)},200)}}
const a=await auth(req,b.device_id);if(a.error)return a.error;const d=a.device;if(req.method==='POST'&&p==='/v1/devices/heartbeat'){const agentType=String(b.agent_type||d.agent_type);const caps=new Set(Array.isArray(b.capabilities)?b.capabilities.map(String):Array.isArray(d.capabilities)?d.capabilities.map(String):[]);if(agentType==='android-termux')caps.add('computer.use.android');const {error}=await supabase.rpc('heartbeat_device_gateway',{p_device_id:d.device_id,p_capabilities:Array.from(caps),p_agent_type:agentType});if(error)return json({error:'heartbeat_failed'},500);return json({ok:true,device_id:d.device_id,capabilities:Array.from(caps)})}if(req.method==='POST'&&p==='/v1/router/decide'){try{return json(await intelligentRouterDecision({...b,device_id:d.device_id}))}catch(e){return json({status:'failed',error:queueError(e)},500)}}
if(req.method==='POST'&&p==='/v1/router/execute'){try{return json(await intelligentRouterExecute(b,d))}catch(e){return json({status:'failed',error:queueError(e)},200)}}
if(req.method==='POST'&&p==='/v1/router/parallel-execute'){try{return json(await intelligentRouterParallelExecute(b,d))}catch(e){return json({status:'failed',error:queueError(e)},200)}}
if(req.method==='POST'&&p==='/v1/meditation/tick'){try{return json(await meditationTick(b,d))}catch(e){return json({ok:false,status:'failed',error:e instanceof Error?e.message:String(e)},200)}}
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
if(req.method==='GET'&&ideaMatch){try{return json({ok:true,proposal:await meditationIdeaProposalById(d.device_id,decodeURIComponent(ideaMatch[1]))})}catch(e){return json({ok:false,error:queueError(e)},404)}}const sr=p.match(/^\/v1\/jobs\/([^/]+)\/resolve-secret$/);if(req.method==='POST'&&sr){try{const secretRef=typeof b.secret_ref==='string'?b.secret_ref:'';return json(await resolveRwhtSecret(decodeURIComponent(sr[1]),d,secretRef))}catch(e){return json({ok:false,error:queueError(e)},409)}}if(req.method==='POST'&&p==='/v1/jobs/claim'){const {data,error}=await supabase.rpc('claim_execution_job_gateway',{p_device_id:d.device_id});if(error)return json({error:'claim_failed'},500);return json({job:data??null})}const s=p.match(/^\/v1\/jobs\/([^/]+)\/start$/);if(req.method==='POST'&&s){const jobId=decodeURIComponent(s[1]);const {data,error}=await supabase.rpc('start_execution_job_gateway',{p_job_id:jobId,p_device_id:d.device_id});if(error)return json({error:'start_failed'},500);if(!data)return json({error:'job_not_owned_or_not_claimed'},409);return json({ok:true,job:data})}const z=p.match(/^\/v1\/jobs\/([^/]+)\/result$/);if(req.method==='POST'&&z){const jobId=decodeURIComponent(z[1]);if(!b.result||typeof b.result!=='object')return json({error:'result_required'},400);const r=b.result as Record<string,unknown>;const status=['succeeded','failed','timeout','cancelled'].includes(String(r.status))?String(r.status):'failed';const exitCode=Number.isInteger(r.exit_code)?Number(r.exit_code):null;const clean={status,exit_code:exitCode,stdout:typeof r.stdout==='string'?r.stdout:'',stderr:typeof r.stderr==='string'?r.stderr:'',duration_ms:Number.isFinite(Number(r.duration_ms))?Number(r.duration_ms):null,metadata:r.metadata&&typeof r.metadata==='object'?r.metadata:{}};const {data,error}=await supabase.rpc('complete_execution_job_gateway',{p_job_id:jobId,p_device_id:d.device_id,p_status:status,p_exit_code:exitCode,p_stdout:clean.stdout,p_stderr:clean.stderr,p_result:clean});if(error)return json({error:'result_failed'},500);if(!data)return json({error:'job_not_owned_or_already_finished'},409);return json({ok:true,job:{job_id:jobId,status}})}return json({error:'not_found'},404)})