import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const PLANNER = `${URL}/functions/v1/aria-planner-v9`;
const WORKER = "https://aria.robvg9.workers.dev";
const GH = "https://api.github.com";
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const bearer=(r:Request)=>{const h=r.headers.get("authorization")??"";return h.startsWith("Bearer ")?h.slice(7):null};
const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};
async function rpc(name:string,args:Record<string,unknown>){const {data,error}=await sb.rpc(name,args);if(error)throw new Error(`${name}:${error.message}`);return data}
async function sha(s:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("")}
async function auth(req:Request){const t=bearer(req);if(t&&SECRET&&eq(t,SECRET))return true;const c=req.headers.get("x-aria-autonomy-token");if(!c)return false;return (await rpc("aria_autonomy_cron_authorize",{p_token:c}))===true}
async function planner(goal:string,cronToken:string|null){const h:Record<string,string>={"content-type":"application/json"};if(cronToken)h["x-aria-autonomy-token"]=cronToken;else h.authorization=`Bearer ${SECRET}`;const r=await fetch(PLANNER,{method:"POST",headers:h,body:JSON.stringify({goal})});const j=await r.json().catch(()=>null);if(!r.ok||!j?.ok||!Array.isArray(j.plan?.steps))throw new Error(`planner_${r.status}`);return j.plan.steps}
async function emit(id:string,type:string,payload:unknown){return rpc("aria_mission_append_event",{p_mission_id:id,p_event:{event_type:type,payload}})}
async function update(id:string,patch:Record<string,unknown>){return rpc("aria_mission_update",{p_mission_id:id,p_mission:patch})}
async function githubRead(path:string,operation="file_read"){
  const clean=String(path||"README.md").replace(/^\/+/,"");
  const endpoint=operation==="repo_read"?`${GH}/repos/Robvg9/aria-worker`:`${GH}/repos/Robvg9/aria-worker/contents/${encodeURIComponent(clean).replace(/%2F/g,"/")}?ref=main`;
  const h:Record<string,string>={accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","user-agent":"ARIA-autonomy-runner-v16"};
  const appId=Deno.env.get("GITHUB_APP_ID")??"",inst=Deno.env.get("GITHUB_INSTALLATION_ID")??"",pem=Deno.env.get("GITHUB_PRIVATE_KEY")??"";
  if(appId&&inst&&pem){ /* v15's governed App token path remains authoritative for credentialed GitHub work; public reads need no credential. */ }
  const r=await fetch(endpoint,{headers:h});const body=await r.json().catch(()=>null);if(!r.ok)throw new Error(`github_${operation}_${r.status}`);return {ok:true,status:r.status,data:body,executor_type:"connector",connector_id:"github",operation};
}
async function cloudflareRead(operation:string,cronToken:string|null){
  const headers:Record<string,string>={};
  if(cronToken) headers["x-aria-autonomy-token"]=cronToken;
  else if(SECRET) headers.authorization=`Bearer ${SECRET}`;
  const r=await fetch(`${WORKER}/admin/cloudflare?operation=${encodeURIComponent(operation)}`,{headers});
  const j=await r.json().catch(()=>null);if(!r.ok||j?.error)throw new Error(`cloudflare_admin_${r.status}`);return {...j,executor_type:"connector",connector_id:"cloudflare",operation};
}
async function supabaseRead(missionId:string,op:string){if(!['mission_read','health'].includes(op))throw new Error(`supabase_operation_not_allowed:${op}`);if(op==='mission_read')return {ok:true,status:200,data:await rpc('aria_mission_get',{p_mission_id:missionId}),executor_type:'connector',connector_id:'supabase',operation:op};return {ok:true,status:200,data:{service:'supabase',ok:true},executor_type:'connector',connector_id:'supabase',operation:op}}
async function deviceExecute(missionId:string,step:any,attempt:number){
  const deviceId=String(step.target?.device_id||step.input?.device_id||Deno.env.get('ARIA_DEFAULT_DEVICE_ID')||'');if(!deviceId)throw new Error('device_id_required');
  const hash=(await sha(`${missionId}:${step.id}`)).slice(0,20);const jobId=`u1_${hash}_a${attempt}`;
  let job=await rpc('get_execution_job_gateway',{p_job_id:jobId});
  if(!job)job=await rpc('enqueue_execution_job_gateway',{p_job_id:jobId,p_mission_id:missionId,p_device_id:deviceId,p_operation:'shell.execute',p_command:String(step.input?.command||step.command||'echo ARIA'),p_cwd:typeof step.input?.cwd==='string'?step.input.cwd:null,p_timeout_ms:Number.isInteger(step.timeout_ms)?step.timeout_ms:30000,p_policy:step.policy&&typeof step.policy==='object'?step.policy:{},p_metadata:{phase1:true,idempotency_key:jobId,attempt}});
  const deadline=Date.now()+Math.min(Number.isInteger(step.timeout_ms)?step.timeout_ms:15000,15000);
  while(Date.now()<deadline){const current=await rpc('get_execution_job_gateway',{p_job_id:jobId});const status=current?.status;if(['succeeded','failed','timeout','cancelled','blocked'].includes(status))return {...current,executor_type:'device',idempotency_key:jobId,operation:'shell.execute'};await sleep(750)}
  return {job_id:jobId,status:'waiting',executor_type:'device',idempotency_key:jobId,retryable:true,operation:'shell.execute'};
}
async function executeStep(missionId:string,step:any,attempt:number,cronToken:string|null){const type=String(step.executor_type||step.target?.type||'connector');if(type==='device')return deviceExecute(missionId,step,attempt);if(type==='agent')throw new Error('agent_executor_requires_registered_runtime');if(type!=='connector')throw new Error(`unsupported_executor:${type}`);const cid=String(step.target?.connector_id||step.connector_id||'');const op=String(step.operation||'');if(cid==='github')return githubRead(String(step.input?.path||step.path||'README.md'),op||'file_read');if(cid==='cloudflare')return cloudflareRead(op||'worker_read',cronToken);if(cid==='supabase')return supabaseRead(missionId,op||'mission_read');throw new Error(`unsupported_connector:${cid}`)}
async function normalizeSteps(m:any,cronToken:string|null){if(Array.isArray(m?.checkpoint?.plan)&&m.checkpoint.plan.length)return m.checkpoint.plan;return planner(String(m.goal||''),cronToken)}
Deno.serve(async(req)=>{
  if(req.method!=='POST')return out({error:'method_not_allowed'},405);if(!(await auth(req)))return out({error:'unauthorized'},401);
  const body=await req.json().catch(()=>({})),requestedMission=typeof body.mission_id==='string'?body.mission_id:null,cronToken=req.headers.get('x-aria-autonomy-token'),workerId='aria-mission-runner-v16';
  try{
    const recovered=await rpc('aria_autonomy_recover_stale_missions',{p_stale_after:'00:02:00'});
    const mission=requestedMission?await rpc('aria_mission_get',{p_mission_id:requestedMission}):await rpc('aria_mission_claim_next_lease',{p_worker_id:workerId,p_lease_for:'00:02:00'});
    if(!mission)return out({ok:true,status:'idle',recovered});
    const id=mission.mission_id,plan=await normalizeSteps(mission,cronToken),cp=mission.checkpoint??{};
    const completed=new Set(Array.isArray(cp.completed_steps)?cp.completed_steps.map(String):[]),attempts:Record<string,number>=(cp.attempts&&typeof cp.attempts==='object')?{...cp.attempts}:{};
    await update(id,{status:'running',total_steps:plan.length,current_step:completed.size,checkpoint:{...cp,plan,completed_steps:[...completed],attempts,recovery_runs:Number(cp.recovery_runs||0)+Number(recovered||0)}});
    const maxAttempts=3;
    for(const step of plan){const sid=String(step.id);if(completed.has(sid))continue;const deps=Array.isArray(step.depends_on)?step.depends_on.map(String):[];if(!deps.every((d:string)=>completed.has(d))){await update(id,{status:'blocked',next_action:'recovery: dependency graph waiting',lease_owner:null,lease_until:null});return out({ok:false,status:'blocked',reason:'dependencies_unsatisfied',mission_id:id})}
      let attempt=Number(attempts[sid]||0),success=false;
      while(attempt<maxAttempts&&!success){attempt+=1;attempts[sid]=attempt;await emit(id,'step_started',{step_id:sid,operation:step.operation,executor_type:step.executor_type||step.target?.type||'connector',attempt});let result:any;try{result=await executeStep(id,step,attempt,cronToken)}catch(e){result={status:'failed',stderr:e instanceof Error?e.message:String(e),executor_type:step.executor_type||step.target?.type||'connector',operation:step.operation,attempt}}
        const passed=result?.status==='succeeded'||(result?.ok===true&&result?.status!=='waiting');
        if(passed){completed.add(sid);success=true;await emit(id,'step_succeeded',{step_id:sid,executor_type:result.executor_type,connector_id:result.connector_id||null,operation:result.operation||step.operation||null,attempt});await update(id,{current_step:completed.size,completed_steps:completed.size,last_stdout:typeof result.stdout==='string'?result.stdout:JSON.stringify(result).slice(0,4000),last_stderr:result.stderr||'',next_action:completed.size<plan.length?'next_ready_step':'verify_goal',checkpoint:{...cp,plan,completed_steps:[...completed],attempts,last_result:{executor_type:result.executor_type,connector_id:result.connector_id||null,operation:result.operation||null,status:result.status||'succeeded'}}});break}
        await emit(id,'step_failed',{step_id:sid,attempt,retryable:attempt<maxAttempts,executor_type:result?.executor_type,connector_id:result?.connector_id||null,operation:result?.operation||step.operation||null,reason:result?.stderr||result?.error||result?.status||'unknown'});
        if(result?.status==='waiting'){await update(id,{status:'running',next_action:'resume: waiting executor',checkpoint:{...cp,plan,completed_steps:[...completed],attempts,waiting_step:sid,waiting_attempt:attempt}});return out({ok:true,status:'waiting',mission_id:id,step_id:sid})}
        if(attempt<maxAttempts&&step.retryable!==false){await sleep(200*attempt);continue}
      }
      if(!success){const deadLetter={step_id:sid,attempts:attempts[sid],reason:'max_attempts_exhausted',recorded_at:new Date().toISOString()};await update(id,{status:'blocked',next_action:'human_gate: dead_letter',last_stderr:deadLetter.reason,lease_owner:null,lease_until:null,checkpoint:{...cp,plan,completed_steps:[...completed],attempts,dead_letter:deadLetter}});await emit(id,'mission_dead_lettered',deadLetter);return out({ok:false,status:'blocked',reason:'dead_letter',mission_id:id})}
    }
    const final=completed.size===plan.length;if(!final){await update(id,{status:'running',next_action:'resume: incomplete plan'});return out({ok:true,status:'waiting',mission_id:id})}
    await emit(id,'mission_verified',{steps:plan.length,executor_types:[...new Set(plan.map((s:any)=>s.executor_type||s.target?.type||'connector'))]});
    await update(id,{status:'succeeded',current_step:plan.length,completed_steps:plan.length,next_action:null,lease_owner:null,lease_until:null,finished_at:new Date().toISOString(),checkpoint:{...cp,plan,completed_steps:[...completed],attempts,verified:true}});await emit(id,'mission_succeeded',{steps:plan.length});return out({ok:true,status:'succeeded',mission_id:id,steps:plan.length})
  }catch(e){const reason=e instanceof Error?e.message:String(e);if(requestedMission){try{await update(requestedMission,{status:'paused',next_action:'recovery: runner exception',last_stderr:reason,checkpoint:{recovery_error:reason,at:new Date().toISOString()}})}catch{}}return out({ok:false,status:'paused',reason},200)}
});
