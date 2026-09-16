import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL"),SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),SHARED_SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET");
if(!SUPABASE_URL||!SERVICE_ROLE_KEY||!SHARED_SECRET)throw new Error("ARIA runtime gateway is not configured");
const supabase=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const internal=supabase.schema("aria_internal");
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const eq=async(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};
const SAFE=new Set(["reliability","performance","documentation","observability","capability_gap","regression"]);
const classify=(s:Record<string,unknown>)=>{const risk=String(s.risk||"LOW").toUpperCase(),category=String(s.category||"capability_gap"),blocked=s.destructive===true||["HIGH","CRITICAL"].includes(risk)||s.production===true||s.external_authority===true||s.physical===true||!SAFE.has(category);return{executable:!blocked,category,risk,human_gate_required:blocked,reasons:blocked?[!SAFE.has(category)?"category_not_autonomous":"autonomy_frontier"]:[]}};
const sanitize=(job:Record<string,unknown>|null)=>{if(!job)return null;const allowed=["job_id","mission_id","device_id","operation","status","attempt","max_attempts","timeout_ms","created_at","started_at","completed_at","exit_code","stdout","stderr","result","metadata"];return Object.fromEntries(Object.entries(job).filter(([k])=>allowed.includes(k)))};
const SELF_IMPROVEMENT_FIELDS=["goal","category","risk","scope","proposed_changes","mission_id","step_id"];
const compactSelfImprovementSignal=(signal:Record<string,unknown>)=>{const compact:Record<string,unknown>={};for(const k of SELF_IMPROVEMENT_FIELDS)if(signal[k]!==undefined)compact[k]=signal[k];return compact};
const clean=(v:unknown,max:number)=>typeof v==="string"?v.trim().slice(0,max):"";
const isObject=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
async function sha256(text:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("")}
Deno.serve(async(req:Request)=>{if(req.method!=="POST")return json({error:"method_not_allowed"},405);const a=req.headers.get("authorization")||"";if(!a.startsWith("Bearer ")||!(await eq(a.slice(7),SHARED_SECRET)))return json({error:"unauthorized"},401);let body:Record<string,unknown>;try{body=await req.json()}catch{return json({error:"invalid_json"},400)};const action=body.action;
if(action==="vision_sync"){
  const payload=isObject(body.payload)?body.payload:{};
  const visionId=clean(payload.vision_id,120)||"aria-master-vision-v1";
  const sourceRef=clean(payload.source_ref,200);
  const sourceUpdatedAt=clean(payload.source_updated_at,80)||null;
  const sourceVersion=clean(payload.source_version,120)||null;
  const sourceContent=typeof payload.source_content==="string"?payload.source_content:"";
  const contentHash=clean(payload.content_hash,64)||(sourceContent?await sha256(sourceContent):null);
  const incoming=Array.isArray(payload.objectives)?payload.objectives:[];
  if(!sourceRef)return json({error:"source_ref_required"},400);
  if(incoming.length>100)return json({error:"too_many_objectives"},400);
  if(!contentHash)return json({error:"content_hash_required"},400);
  const{error:me}=await internal.from("vision_manifest").upsert({vision_id:visionId,source_type:"notion",source_ref:sourceRef,source_updated_at:sourceUpdatedAt,source_version:sourceVersion,content_hash:contentHash,snapshot_metadata:{compiler_status:"live",sync:"notion_to_manifest_to_goals",received_at:new Date().toISOString(),objective_count:incoming.length},active:true,updated_at:new Date().toISOString()},{onConflict:"vision_id"});
  if(me)return json({error:"manifest_upsert_failed",detail:me.message},500);
  let synced=0;
  for(const item of incoming){
    if(!isObject(item))continue;
    const objectiveId=clean(item.objective_id,160),objective=clean(item.objective,2000);if(!objectiveId||!objective)continue;
    const{data:existing,error:re}=await internal.from("vision_objectives").select("status,verifier,dependencies,metadata").eq("objective_id",objectiveId).maybeSingle();
    if(re)return json({error:"objective_lookup_failed",objective_id:objectiveId,detail:re.message},500);
    const incomingStatus=["queued","paused","blocked","completed","archived"].includes(String(item.status))?String(item.status):"queued";
    const effectiveStatus=existing?.status&&["completed","archived"].includes(String(existing.status))?String(existing.status):incomingStatus;
    const verifier=isObject(item.verifier)?item.verifier:(existing?.verifier&&isObject(existing.verifier)?existing.verifier:{type:"evidence_required",success_conditions:["reproducible_evidence"]});
    const dependencies=Array.isArray(item.dependencies)?item.dependencies.filter((x:any)=>typeof x==="string").slice(0,20):(Array.isArray(existing?.dependencies)?existing.dependencies:[]);
    const incomingMetadata=isObject(item.metadata)?item.metadata:{};
    const existingMetadata=isObject(existing?.metadata)?existing.metadata:{};
    const metadata={...existingMetadata,...incomingMetadata,synced_from:"notion",source_ref:sourceRef,source_version:sourceVersion,synced_at:new Date().toISOString(),status_reconciliation:effectiveStatus!==incomingStatus?"terminal_state_preserved":"source_status_applied"};
    const{error}=await internal.from("vision_objectives").upsert({objective_id:objectiveId,vision_id:visionId,objective,priority:Number.isFinite(Number(item.priority))?Math.max(0,Math.min(100,Number(item.priority))):50,status:effectiveStatus,source_section:clean(item.source_section,500)||null,acceptance:clean(item.acceptance,2000)||null,verifier,dependencies,content_hash:contentHash,metadata,updated_at:new Date().toISOString()},{onConflict:"objective_id"});
    if(error)return json({error:"objective_upsert_failed",objective_id:objectiveId,detail:error.message},500);
    synced++;
  }
  const{data:compiled,error:ce}=await internal.rpc("compile_all_active_vision_objectives");
  if(ce)return json({error:"compile_failed",detail:ce.message},500);
  return json({ok:true,action,status:"accepted",vision_id:visionId,source_ref:sourceRef,content_hash:contentHash,objectives_received:incoming.length,objectives_synced:synced,goals_compiled:Number(compiled||0),compiler:"vision-objective-compiler-v1",sync:"notion_to_manifest_to_goals",status_policy:"terminal_completed_archived_preserved"})
}
if(action==="self_improve"){const signal=body.signal&&typeof body.signal==="object"?body.signal as Record<string,unknown>:{};const goal=typeof signal.goal==="string"?signal.goal.trim().slice(0,1000):"";if(!goal)return json({error:"invalid_request",field:"signal.goal"},400);const classification=classify(signal);const approvals={promote:false,deploy:false};if(!classification.executable)return json({ok:true,action,status:"blocked",version:"self-improvement-runtime-v1",goal,classification,approvals,stop_reason:"autonomy_frontier"});const deviceId=typeof signal.device_id==="string"?signal.device_id.trim():"";if(!deviceId)return json({error:"invalid_request",field:"signal.device_id"},400);const missionId=typeof signal.mission_id==="string"?signal.mission_id.trim():"";const stepId=typeof signal.step_id==="string"?signal.step_id.trim():"";if(!missionId||!stepId)return json({error:"invalid_request",field:"signal.mission_id_step_id"},400);const jobId=`uo_${missionId.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,28)}_${stepId.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,28)}`;const queued=compactSelfImprovementSignal({...signal,goal,category:classification.category,risk:classification.risk,mission_id:missionId,step_id:stepId});const{data,error}=await supabase.rpc("enqueue_execution_job_gateway",{p_job_id:jobId,p_mission_id:missionId,p_device_id:deviceId,p_operation:"self.improve",p_command:JSON.stringify(queued),p_cwd:null,p_timeout_ms:120000,p_policy:{autonomy_frontier:classification},p_metadata:{runner:"aria-mission-runner-v22-universal",executor_type:"self_improvement",human_gate_required:false,promotion:"human_gate",deployment:"human_gate"}});if(error)return json({error:"enqueue_failed",detail:error.message},500);return json({ok:true,action,status:"accepted",version:"self-improvement-runtime-v1",goal,classification,approvals,pipeline:["observe","research","plan","build","test","security","evaluate","verify","learn"],promotion:"human_gate",deployment:"human_gate",execution:"governed_coordinator_job",job:sanitize(data)})}
if(action!=="enqueue_device_job"&&action!=="get_job")return json({error:"unsupported_action"},400);
if(action==="enqueue_device_job"){for(const k of ["job_id","mission_id","device_id","operation","command"])if(typeof body[k]!=="string"||!(body[k] as string).trim())return json({error:"invalid_request",field:k},400);const{data,error}=await supabase.rpc("enqueue_execution_job_gateway",{p_job_id:body.job_id,p_mission_id:body.mission_id,p_device_id:body.device_id,p_operation:body.operation,p_command:body.command,p_cwd:typeof body.cwd==="string"?body.cwd:null,p_timeout_ms:Number.isInteger(body.timeout_ms)?body.timeout_ms:120000,p_policy:body.policy&&typeof body.policy==="object"?body.policy:{},p_metadata:body.metadata&&typeof body.metadata==="object"?body.metadata:{}});if(error)return json({error:"enqueue_failed",detail:error.message},500);return json({ok:true,action,job:sanitize(data)})}
if(typeof body.job_id!=="string"||!body.job_id.trim())return json({error:"invalid_request",field:"job_id"},400);const{data,error}=await supabase.rpc("get_execution_job_gateway",{p_job_id:body.job_id});if(error)return json({error:"get_job_failed",detail:error.message},500);return json({ok:true,action,job:sanitize(data)})});
