// Runtime refresh checkpoint: redeploy unchanged canonical APP API v3 after transient Edge Function boot errors observed 2026-09-29.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyConversation } from "../_shared/fast-lane.ts";
import { shouldDebate, debatePrompt } from "../_shared/model-debate.ts";
import { buildIdeaMissionProposal, validateProposal } from "../_shared/idea-to-mission.mjs";
import { deriveOperationalDiagnostic } from "../_shared/operational-diagnostics.mjs";
import { inspectGithubSource, buildCapabilityIndex, buildAbsorptionPlan, buildAbsorptionIdentity, advanceAbsorptionPlan, evaluateAbsorptionCompletion } from "../_shared/absorb-engine.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const DIRECT = `${SUPABASE_URL}/functions/v1/aria-direct-v1`;
const MEMORY = `${SUPABASE_URL}/functions/v1/aria-memory-v2`;
const PLANNER = `${SUPABASE_URL}/functions/v1/aria-planner-v11`;
const EXEC = `${SUPABASE_URL}/functions/v1/aria-execution-runtime-v1`;
const DEVICE_GATEWAY = `${SUPABASE_URL}/functions/v1/aria-device-gateway`;
const EDGE_API_KEY = (() => { try { const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}"); return typeof keys?.default === "string" ? keys.default : ""; } catch { return ""; } })();
const MEDIA_BUCKET = "aria-app-media";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,apikey,x-client-info,x-aria-trace-id,x-aria-request-id,x-aria-pwa-build,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
const PROJECTS = Object.freeze([
  { id: "battlecruiser", name: "BattleCruiser", icon: "🏴‍☠️", context: "BattleCruiser es un proyecto operativo privado. Usa estado LIVE y ChatBending como contexto autorizado y no inventes estado técnico o de negocio." },
  { id: "cuevacoin", name: "CuevaCoin", icon: "🪙", context: "CuevaCoin es un proyecto financiero/operativo. Los cambios requieren verificación adicional antes de considerarse terminados." },
  { id: "aria", name: "ARIA", icon: "🧠", context: "ARIA es el sistema cognitivo operativo. Usa estado LIVE, main y evidencia persistida como fuentes prioritarias." },
] as const);
function getProject(value: unknown) {
  const id = String(value ?? "").trim().toLowerCase();
  return PROJECTS.find((p) => p.id === id) ?? null;
}
function normalizeProjectContext(body: any) {
  const project = getProject(body?.project_id ?? body?.project?.id);
  if (!project) return null;
  return { id: project.id, name: project.name, icon: project.icon, context: project.context };
}
function normalizeVisualContext(body: any) {
  const raw = body?.visual_context;
  if (!raw || typeof raw !== "object") return null;
  const instruction = typeof raw.instruction === "string" ? raw.instruction.slice(0, 4000) : "";
  const annotation_summary = typeof raw.annotation_summary === "string" ? raw.annotation_summary.slice(0, 12000) : "";
  const image_path = typeof raw.image_path === "string" ? raw.image_path.slice(0, 500) : null;
  const mime_type = typeof raw.mime_type === "string" ? raw.mime_type.slice(0, 100) : null;
  const annotations = Array.isArray(raw.annotations)
    ? raw.annotations.slice(0, 128).map((item: any) => ({
        tool: typeof item?.tool === "string" ? item.tool.slice(0, 32) : "unknown",
        color: typeof item?.color === "string" ? item.color.slice(0, 32) : "",
        size: Number.isFinite(Number(item?.size)) ? Math.max(1, Math.min(64, Number(item.size))) : 1,
        points: Array.isArray(item?.points)
          ? item.points.slice(0, 512).map((point: any) => ({
              x: Number.isFinite(Number(point?.x)) ? Number(point.x) : 0,
              y: Number.isFinite(Number(point?.y)) ? Number(point.y) : 0,
            }))
          : [],
        text: typeof item?.text === "string" ? item.text.slice(0, 120) : null,
      }))
    : [];
  if (!instruction && !annotation_summary && !image_path && !annotations.length) return null;
  return { instruction, annotation_summary, annotations, image_path, mime_type };
}
function normalizeAttachments(parts: any[]) {
  return parts.filter((p: any) => p?.type === "file").slice(0, 3).map((p: any) => ({
    path: typeof p.path === "string" ? p.path.slice(0, 500) : null,
    mimeType: typeof p.mimeType === "string" ? p.mimeType.slice(0, 100) : null,
    filename: typeof p.filename === "string" ? p.filename.slice(0, 200) : null,
  }));
}

const bearer = (req: Request) => { const value = req.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; };

function presentAbsorption(row:any){ return row ? { ...row, completion: evaluateAbsorptionCompletion(row) } : row; }
async function absorbRows(userId:string){
  const {data,error}=await serviceClient().schema("aria_internal").from("capability_absorptions")
    .select("absorption_id,source_type,source_ref,source_owner,source_repo,source_requested_ref,source_commit_sha,source_digest_sha256,resource_name,status,enabled,inventory,capabilities,absorption_plan,verification,runtime_binding,metadata,created_at,updated_at")
    .eq("user_id",userId).order("updated_at",{ascending:false}).limit(25);
  if(error) throw new Error("absorb_list_failed:"+error.message);
  return (data??[]).map(presentAbsorption);
}
async function absorbInspect(userId:string, body:any){
  const source=body?.source&&typeof body.source==="object"?body.source:body;
  const inventory=await inspectGithubSource(source,{maxEntries:10000});
  const capabilities=buildCapabilityIndex(inventory);
  const plan=advanceAbsorptionPlan(buildAbsorptionPlan({source:inventory.source,requestedCapabilities:Array.isArray(body?.requested_capabilities)?body.requested_capabilities:[]}),"INDEXED");
  const identity=await buildAbsorptionIdentity(inventory,capabilities);
  const sb=serviceClient();
  const {data:existing,error:lookupError}=await sb.schema("aria_internal").from("capability_absorptions")
    .select("absorption_id,status,source_owner,source_repo,source_requested_ref,source_commit_sha,source_digest_sha256,capabilities,absorption_plan,verification,enabled,runtime_binding,created_at,updated_at")
    .eq("user_id",userId).eq("source_type","github").eq("source_owner",inventory.source.owner).eq("source_repo",inventory.source.repo)
    .eq("source_requested_ref",inventory.source.ref).eq("source_commit_sha",inventory.source.commit_sha).limit(1).maybeSingle();
  if(lookupError) throw new Error("absorb_inspect_lookup_failed:"+lookupError.message);
  if(existing && existing.source_digest_sha256===inventory.inventory_digest_sha256){
    return existing;
  }
  const {data,error}=await sb.schema("aria_internal").from("capability_absorptions").insert({
    user_id:userId,source_type:"github",source_ref:inventory.source.canonical_url,source_owner:inventory.source.owner,
    source_repo:inventory.source.repo,source_requested_ref:inventory.source.ref,source_commit_sha:inventory.source.commit_sha,
    source_digest_sha256:inventory.inventory_digest_sha256,resource_name:inventory.repository.full_name,status:"INDEXED",enabled:false,
    inventory,capabilities,absorption_plan:plan,verification:{state:"NOT_VERIFIED",verification_level:"inventory_only",runtime_verified:false},
    runtime_binding:null,metadata:{absorption_identity:identity,created_via:"aria-app-api-v3/absorb",external_code_execution:false}
  }).select("absorption_id,status,source_owner,source_repo,source_requested_ref,source_commit_sha,source_digest_sha256,capabilities,absorption_plan,verification,enabled,created_at,updated_at").single();
  if(error) throw new Error("absorb_inspect_persist_failed:"+error.message);
  return data;
}
async function absorbVerify(userId:string, absorptionId:string){
  const sb=serviceClient();
  const {data:row,error}=await sb.schema("aria_internal").from("capability_absorptions").select("*").eq("absorption_id",absorptionId).eq("user_id",userId).maybeSingle();
  if(error) throw new Error("absorb_verify_lookup_failed:"+error.message);
  if(!row) throw Object.assign(new Error("absorb_not_found"),{status:404});
  const inventory=await inspectGithubSource({owner:row.source_owner,repo:row.source_repo,ref:row.source_requested_ref});
  if(inventory.source.commit_sha!==row.source_commit_sha||inventory.inventory_digest_sha256!==row.source_digest_sha256){
    await sb.schema("aria_internal").from("capability_absorptions").update({
      status:"REJECTED",enabled:false,verification:{state:"FAILED",verification_level:"source_drift",runtime_verified:false,reason:"source_commit_or_digest_changed"}
    }).eq("absorption_id",absorptionId).eq("user_id",userId);
    throw Object.assign(new Error("absorb_source_drift_detected"),{status:409});
  }
  const capabilities=buildCapabilityIndex(inventory);
  const identity=await buildAbsorptionIdentity(inventory,capabilities);
  if(String(row.metadata?.absorption_identity||"")!==identity) throw Object.assign(new Error("absorb_identity_mismatch"),{status:409});
  const verification={state:"VERIFIED",verification_level:"source_provenance_and_deterministic_inventory",runtime_verified:false,security_review:"pending",contract_test:"pending",evidence_persisted:true,verified_at:new Date().toISOString()};
  const {data,error:upError}=await sb.schema("aria_internal").from("capability_absorptions").update({status:"VERIFIED",verification,inventory,capabilities,absorption_plan:advanceAbsorptionPlan(row.absorption_plan,"VERIFIED"),enabled:false}).eq("absorption_id",absorptionId).eq("user_id",userId)
    .select("absorption_id,status,source_type,source_ref,source_owner,source_repo,source_requested_ref,source_commit_sha,source_digest_sha256,resource_name,enabled,inventory,capabilities,absorption_plan,verification,runtime_binding,metadata,created_at,updated_at").single();
  if(upError) throw new Error("absorb_verify_persist_failed:"+upError.message);
  return data;
}
function allowedAbsorbBinding(row:any,binding:any){
  return Boolean(
    row?.source_type==="github" &&
    row?.source_owner==="affaan-m" &&
    row?.source_repo==="ECC" &&
    row?.source_requested_ref==="v2.2.3" &&
    String(row?.status)==="VERIFIED" &&
    binding?.binding_id==="tool_ecc_operator"
  );
}
async function absorbRegister(userId:string, absorptionId:string, binding:any){
  const sb=serviceClient();
  const {data:row,error}=await sb.schema("aria_internal").from("capability_absorptions").select("*").eq("absorption_id",absorptionId).eq("user_id",userId).maybeSingle();
  if(error) throw new Error("absorb_register_lookup_failed:"+error.message);
  if(!row) throw Object.assign(new Error("absorb_not_found"),{status:404});
  if(!allowedAbsorbBinding(row,binding)) throw Object.assign(new Error("absorb_binding_not_allowlisted"),{status:403});
  const runtimeBinding={binding_id:"tool_ecc_operator",operation:"ecc.execute",underlying_operation:"shell.execute",mode:"existing_governed_aria_capability",enabled:false,registered_at:new Date().toISOString()};
  const {data,error:upError}=await sb.schema("aria_internal").from("capability_absorptions").update({status:"REGISTERED",runtime_binding:runtimeBinding,enabled:false,verification:{...row.verification,adapter_contract:"tool_ecc_operator",runtime_verified:false,security_review:"passed"}}).eq("absorption_id",absorptionId).eq("user_id",userId)
    .select("absorption_id,status,source_type,source_ref,source_owner,source_repo,source_requested_ref,source_commit_sha,source_digest_sha256,resource_name,enabled,inventory,capabilities,absorption_plan,verification,runtime_binding,metadata,created_at,updated_at").single();
  if(upError) throw new Error("absorb_register_persist_failed:"+upError.message);
  return data;
}
async function absorbEnable(userId:string, absorptionId:string){
  const sb=serviceClient();
  const {data:row,error}=await sb.schema("aria_internal").from("capability_absorptions").select("*").eq("absorption_id",absorptionId).eq("user_id",userId).maybeSingle();
  if(error) throw new Error("absorb_enable_lookup_failed:"+error.message);
  if(!row) throw Object.assign(new Error("absorb_not_found"),{status:404});
  if(String(row.status)!=="REGISTERED"||row.runtime_binding?.binding_id!=="tool_ecc_operator") throw Object.assign(new Error("absorb_enable_binding_required"),{status:409});
  const liveInventory=await inspectGithubSource({owner:row.source_owner,repo:row.source_repo,ref:row.source_requested_ref});
  if(liveInventory.source.commit_sha!==row.source_commit_sha||liveInventory.inventory_digest_sha256!==row.source_digest_sha256){
    await sb.schema("aria_internal").from("capability_absorptions").update({
      status:"REJECTED",enabled:false,verification:{...row.verification,state:"FAILED",verification_level:"source_drift",runtime_verified:false,reason:"source_commit_or_digest_changed_before_enable"}
    }).eq("absorption_id",absorptionId).eq("user_id",userId);
    throw Object.assign(new Error("absorb_source_drift_detected_before_enable"),{status:409});
  }
  const {data:missions,error:missionError}=await sb.schema("aria_internal").from("mission_state")
    .select("mission_id,status,goal,checkpoint,metadata,finished_at").eq("status","succeeded").ilike("mission_id","ecc-aria-live-e2e-%").order("finished_at",{ascending:false}).limit(20);
  if(missionError) throw new Error("absorb_enable_evidence_lookup_failed:"+missionError.message);
  const evidence=(missions||[]).filter((m:any)=>String(JSON.stringify(m.checkpoint||{})).includes("ecc.execute"));
  if(evidence.length<1) throw Object.assign(new Error("absorb_runtime_evidence_required"),{status:409});
  const verification={...row.verification,adapter_contract:"tool_ecc_operator",runtime_verified:true,runtime_evidence_count:evidence.length,runtime_evidence_refs:evidence.slice(0,8).map((m:any)=>String(m.mission_id)),contract_test:"passed",security_review:"passed",verification_level:"source_provenance_deterministic_inventory_and_runtime_evidence",enabled_at:new Date().toISOString()};
  const runtimeBinding={...row.runtime_binding,enabled:true,enabled_at:new Date().toISOString()};
  const nextMetadata={...(row.metadata&&typeof row.metadata==="object"?row.metadata:{}),absorption_scope:{...((row.metadata&&typeof row.metadata==="object"&&row.metadata.absorption_scope&&typeof row.metadata.absorption_scope==="object")?row.metadata.absorption_scope:{}),required_bindings:[{binding_id:"tool_ecc_operator"}]}};
  const {data,error:upError}=await sb.schema("aria_internal").from("capability_absorptions").update({status:"ENABLED",runtime_binding:runtimeBinding,enabled:true,verification,absorption_plan:advanceAbsorptionPlan(row.absorption_plan,"ENABLED"),metadata:nextMetadata}).eq("absorption_id",absorptionId).eq("user_id",userId)
    .select("absorption_id,status,source_owner,source_repo,source_requested_ref,source_commit_sha,source_digest_sha256,runtime_binding,verification,enabled,updated_at").single();
  if(upError) throw new Error("absorb_enable_persist_failed:"+upError.message);
  return data;
}

function serviceClient() { if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_not_configured"); return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false } }); }
async function requireUser(token: string) {
  if (!token) throw Object.assign(new Error("missing_authorization"), { status: 401 });
  const { data, error } = await serviceClient().auth.getClaims(token);
  const claims:any = data?.claims;
  if (error || !claims?.sub) throw Object.assign(new Error("invalid_or_expired_session"), { status: 401 });
  return { id: String(claims.sub), email: typeof claims.email === "string" ? claims.email : null };
}
async function internal(url: string, payload: unknown) { if (!SECRET) throw new Error("runtime_secret_not_configured"); const headers: Record<string,string> = { "content-type": "application/json", authorization: `Bearer ${SECRET}` }; if (EDGE_API_KEY) headers.apikey = EDGE_API_KEY; const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) }); const b = await r.json().catch(() => null); return { r, b }; }
async function persistConversationMessage(userId:string,conversationId:string,role:"user"|"assistant"|"system",content:string,parts:any[],traceId:string,visualState:string|null,providerId:string|null,modelId:string|null,title:string,project:any){
  const sb=serviceClient();
  const saved=await sb.rpc("aria_app_persist_message",{
    p_user_id:userId,
    p_conversation_id:conversationId,
    p_role:role,
    p_content:content,
    p_parts:parts??[],
    p_trace_id:traceId,
    p_visual_state:visualState,
    p_provider_id:providerId,
    p_model_id:modelId,
    p_title:title,
    p_project_id:project?.id ?? null,
    p_project_name:project?.name ?? null,
    p_project_icon:project?.icon ?? null,
    p_project_context:project?.context ?? null
  });
  if(saved.error)throw new Error("conversation_persist_rpc_failed:"+saved.error.message);
  return saved.data;
}

async function recall(text: string, userId: string) { try { const x = await internal(MEMORY, { action: "search", query: text, limit: 8, user_id: userId, "x-aria-user-id": userId }); return Array.isArray(x.b?.results) ? x.b.results : []; } catch { return []; } }
async function plan(text: string, context: unknown) { const x = await internal(PLANNER, { goal: `IA conversacional: responde al usuario de forma natural y útil. ${text}`, context }); if (!x.r.ok || x.b?.ok !== true || !x.b?.plan?.steps?.[0]) throw new Error(`planner_http_${x.r.status}_${x.b?.error ?? "invalid_plan"}`); return x.b.plan.steps[0]; }
let conversationRouteCache:{expiresAt:number;routes:any[]}|null=null;
let learnedContextCache:{expiresAt:number;key:string;value:any}|null=null;
async function learnedContext(project:any){
  const key=String(project?.id||'global'); const now=Date.now();
  if(learnedContextCache&&learnedContextCache.key===key&&learnedContextCache.expiresAt>now)return learnedContextCache.value;
  const sb=serviceClient(); const term=String(project?.name||'').replace(/[%_]/g,'');
  const [skills,world]=await Promise.all([
    sb.schema('aria_memory').from('memory_items').select('memory_id,title,content,confidence,metadata').eq('memory_type','skill').eq('status','active').gte('confidence',.9).or(term?'title.ilike.%'+term+'%,content.ilike.%'+term+'%':'memory_id.not.is.null').order('confidence',{ascending:false}).limit(8),
    project?sb.schema('aria_memory').from('world_entities').select('entity_id,entity_type,canonical_name,status,attributes,confidence,source_ref').eq('entity_type','project').eq('canonical_name',project.name).maybeSingle():Promise.resolve({data:null,error:null})
  ]);
  const value={skills:skills.error?[]:(skills.data??[]),world_model:world.error?null:world.data}; learnedContextCache={key,expiresAt:now+30000,value}; return value;
}

async function conversationRoutes() {
  if(conversationRouteCache && conversationRouteCache.expiresAt>Date.now()) {
    const localDevices=await serviceClient().schema("aria_internal").from("device_registry")
      .select("device_id,last_seen_at").eq("status","online").contains("capabilities",'["ollama.qwen3"]')
      .order("last_seen_at",{ascending:false}).limit(1);
    const cachedCloud=conversationRouteCache.routes.filter((route:any)=>route.provider_id!=="local_windows");
    const onlineLocal=localDevices.data?.[0];
    const refreshed=onlineLocal?.device_id ? [...cachedCloud,{
      model_id:"qwen3:0.6b",
      provider_id:"local_windows",
      account_id:String(onlineLocal.device_id),
      capability_status:"verified",
      evidence_type:"device_registry",
      evidence_ref:String(onlineLocal.device_id),
      score:80,
      device_id:String(onlineLocal.device_id)
    }] : cachedCloud;
    refreshed.sort((a:any,b:any)=>b.score-a.score || String(a.provider_id).localeCompare(String(b.provider_id)) || String(a.model_id).localeCompare(String(b.model_id)));
    return refreshed;
  }
  const [{data:models},{data:caps},{data:accounts}] = await Promise.all([
    serviceClient().schema("aria_internal").from("model_registry").select("model_id,provider_id,status,enabled"),
    serviceClient().schema("aria_internal").from("capability_matrix").select("model_id,status,evidence_type,evidence_ref").eq("capability_id","text_generation"),
    serviceClient().schema("aria_internal").from("account_registry").select("account_id,provider_id,status,enabled")
  ]);
  const routes=(models ?? []).filter((m:any)=>m.enabled && m.status==="available" && m.provider_id!=="local_windows").map((m:any)=>{
    const cap=(caps ?? []).find((x:any)=>x.model_id===m.model_id);
    const account=(accounts ?? []).find((a:any)=>a.provider_id===m.provider_id && a.enabled && ["available","active"].includes(String(a.status)));
    if(!account)return null;
    const providerBoost=m.provider_id==="google"?12:m.provider_id==="xai"?8:0;
    return {model_id:m.model_id,provider_id:m.provider_id,account_id:account.account_id,capability_status:cap?.status ?? "unknown",evidence_type:cap?.evidence_type ?? "unknown",evidence_ref:cap?.evidence_ref ?? null,score:(cap?.status==="verified"?100:50)+providerBoost};
  }).filter(Boolean);
  const localDevices=await serviceClient().schema("aria_internal").from("device_registry")
    .select("device_id,last_seen_at").eq("status","online").contains("capabilities",'["ollama.qwen3"]')
    .order("last_seen_at",{ascending:false}).limit(1);
  const onlineLocal=localDevices.data?.[0];
  if(onlineLocal?.device_id){
    routes.push({
      model_id:"qwen3:0.6b",
      provider_id:"local_windows",
      account_id:String(onlineLocal.device_id),
      capability_status:"verified",
      evidence_type:"device_registry",
      evidence_ref:String(onlineLocal.device_id),
      score:80,
      device_id:String(onlineLocal.device_id)
    });
  }
  routes.sort((a:any,b:any)=>b.score-a.score || String(a.provider_id).localeCompare(String(b.provider_id)) || String(a.model_id).localeCompare(String(b.model_id)));
  conversationRouteCache={expiresAt:Date.now()+30000,routes:routes.filter((route:any)=>route.provider_id!=="local_windows")};
  return routes;
}

async function execute(step: any, prompt: string, conversationId: string, visualContext:any=null, clientMessageId:string|null=null, waitForLocal:boolean=true) {
  const target = step?.target;
  if (!target?.provider_id || !target?.account_id || !target?.model_id) throw new Error("executor_contract_route_incomplete");
  if (target.provider_id === "local_windows") {
    let deviceId=String(target.device_id||"").trim();
    if(!deviceId && target.provider_id==="local_windows"){
      const route=(await conversationRoutes()).find((r:any)=>r.provider_id==="local_windows" && r.device_id);
      if(route?.device_id) deviceId=String(route.device_id);
    }
    if(!deviceId) throw new Error("local_windows_device_missing");
    const jobSeed=String(clientMessageId||crypto.randomUUID()).trim();
    const jobId=("chat_qwen_"+conversationId+"_"+jobSeed).replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,120);
    const runtimeMissionId=("chat-runtime:"+conversationId).slice(0,220);
    const sb=serviceClient();
    const {error:runtimeMissionError}=await sb.schema("aria_internal").from("mission_state").upsert({
      mission_id:runtimeMissionId,
      goal:"Internal Chat execution context",
      status:"succeeded",
      current_step:0,
      total_steps:0,
      completed_steps:0,
      attempt_count:0,
      next_action:null,
      finished_at:new Date().toISOString(),
      checkpoint:{source:"aria-app-api-v3",chat_execution_context:true},
      metadata:{source_application:"aria-app-api-v3",internal_only:true,chat_execution_context:true,conversation_id:conversationId}
    },{onConflict:"mission_id"});
    if(runtimeMissionError) throw new Error("chat_runtime_mission_context_failed:"+runtimeMissionError.message);
    const payload={prompt:String(prompt).slice(0,12000),model:String(target.model_id||"qwen3:0.6b"),timeout_ms:120000};
    let queued:any=null;
    let enqueueError:any=null;
    const enqueueDeadline=Date.now()+18000;
    do {
      const attempt=await sb.rpc("enqueue_execution_job_gateway",{
        p_job_id:jobId,p_mission_id:runtimeMissionId,p_device_id:deviceId,p_operation:"ollama.qwen3",
        p_command:JSON.stringify(payload),p_cwd:null,p_timeout_ms:120000,p_policy:{},
        p_metadata:{source_application:"aria-app-api-v3",conversation_id:conversationId,local_fallback:true,model:payload.model}
      });
      queued=attempt.data;
      enqueueError=attempt.error;
      // A successful gateway call is authoritative even when PostgREST returns no body:
      // the enqueue function may have committed the execution_jobs row but serialized null.
      if(!enqueueError){
        queued=queued ?? {job_id:jobId,status:"queued",provisional:true};
        break;
      }
      // Reconcile transport/RPC failures by checking the exact idempotent job before retrying.
      if(!queued){
        // Allow a brief visibility window after a committed INSERT before retrying the same job id.
        for(let reconcileAttempt=0;reconcileAttempt<5&&!queued;reconcileAttempt++){
          const confirmed=await sb.rpc("get_execution_job_gateway",{p_job_id:jobId});
          if(!confirmed.error&&confirmed.data){
            queued=confirmed.data;
            enqueueError=null;
            break;
          }
          if(reconcileAttempt<4) await new Promise(resolve=>setTimeout(resolve,500));
        }
        if(queued) break;
      }
      // HTTP 200 with null data is a valid ambiguous-commit result. The execution_jobs
      // row is the source of truth; continue to status polling for this exact job_id.
      if(!enqueueError && !queued){
        queued={job_id:jobId,status:"queued",provisional:true};
        break;
      }
      const message=String(enqueueError?.message||"");
      if(!/execution_backpressure_device/.test(message) || Date.now()>=enqueueDeadline) break;
      await new Promise(resolve=>setTimeout(resolve,1200));
    } while(Date.now()<enqueueDeadline);
    if(enqueueError||!queued) throw new Error("local_qwen_enqueue_failed:"+(enqueueError?.message||"empty"));
    if(!waitForLocal){
      return {
        status:"processing",
        response:{content:""},
        operation:"text_generation",
        provider_id:"local_windows",
        account_id:deviceId,
        model_id:payload.model,
        local_fallback_used:true,
        local_fallback_source:"windows_ollama",
        local_fallback_device_id:deviceId,
        job_id:jobId
      };
    }
    // Local Windows Qwen may legitimately take longer than the former 45s polling window; keep the API boundary below the 120s execution-job contract.\n    const deadline=Date.now()+110000;
    while(Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,1200));
      const {data:job,error:jobError}=await sb.rpc("get_execution_job_gateway",{p_job_id:jobId});
      if(jobError){
        // A transient PostgREST/RPC read failure must not spawn a second local job.
        // Keep polling the exact idempotent job before considering any fallback.
        await new Promise(resolve=>setTimeout(resolve,1500));
        continue;
      }
      const status=String(job?.status||"");
      if(status==="succeeded"){
        const content=String(job?.stdout??"").trim();
        if(!content) throw new Error("local_qwen_empty_response");
        return {status:"succeeded",response:{content},stdout:content,stderr:String(job?.stderr??""),
          exit_code:Number(job?.exit_code??0),operation:"text_generation",provider_id:"local_windows",
          account_id:deviceId,model_id:payload.model,local_fallback_used:true,
          local_fallback_source:"windows_ollama",local_fallback_device_id:deviceId,job_id:jobId};
      }
      if(["failed","timeout","cancelled","blocked"].includes(status)){
        throw new Error("local_qwen_job_"+status+":"+(job?.error||job?.stderr||"execution_failed"));
      }
    }
    throw new Error("local_qwen_job_timeout");
  }
  let payload:any={prompt,max_tokens:512,temperature:0.3};
  let multimodal=false;
  if(visualContext?.image_path && target.provider_id==="google"){
    const signed=await serviceClient().storage.from(MEDIA_BUCKET).createSignedUrl(String(visualContext.image_path),600);
    if(signed.error||!signed.data?.signedUrl) throw new Error("visual_signed_url_failed");
    const imageResponse=await fetch(signed.data.signedUrl);
    if(!imageResponse.ok) throw new Error("visual_download_failed_"+imageResponse.status);
    const bytes=new Uint8Array(await imageResponse.arrayBuffer());
    if(bytes.byteLength>4500000) throw new Error("visual_payload_too_large");
    let binary="";
    const chunk=32768;
    for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+chunk)));
    const base64=btoa(binary);
    payload={contents:[{role:"user",parts:[{text:prompt},{inlineData:{mimeType:String(visualContext.mime_type||"image/png"),data:base64}}]}],generationConfig:{maxOutputTokens:512,temperature:0.3}};
    multimodal=true;
  }
  const x=await internal(EXEC,{execution_version:"1",request_id:conversationId+":"+crypto.randomUUID(),task_id:"conversation:"+conversationId,capability:"text_generation",selected_route:{status:"selected",provider_id:target.provider_id,account_id:target.account_id,model_id:target.model_id,capability:"text_generation"},authorization:{status:"approved",risk_class:"READ",evidence_ref:"aria-app-api-v3"},input:{payload},policy:{},metadata:{conversation_id:conversationId,source_application:"aria-app-v1",executor_type:"model",multimodal}});
  if(!x.r.ok||x.b?.status!=="succeeded") throw new Error("executor_http_"+x.r.status+"_"+(x.b?.error?.code??x.b?.reason??"execution_failed"));
  return x.b;
}

async function executeDebate(step:any,prompt:string,conversationId:string,visualContext:any=null,clientMessageId:string|null=null,waitForLocal:boolean=true){
  const routes=await conversationRoutes();
  const first=step?.target||routes[0];
  const second=routes.find((route:any)=>String(route.model_id)!==String(first?.model_id)||String(route.provider_id)!==String(first?.provider_id));
  if(!first||!second) return null;
  const firstStep={...step,target:{...(step.target||{}),type:'model',provider_id:first.provider_id,account_id:first.account_id,model_id:first.model_id}};
  const proposal=await execute(firstStep,prompt,conversationId,visualContext,clientMessageId,waitForLocal);
  const proposalText=typeof proposal?.response?.content==='string'?proposal.response.content.trim():'';
  if(!proposalText) return null;
  const criticStep={...step,target:{type:'model',provider_id:second.provider_id,account_id:second.account_id,model_id:second.model_id}};
  const critique=await execute(criticStep,debatePrompt(prompt,proposalText),conversationId,visualContext,clientMessageId,waitForLocal);
  return {result:critique,proposal,first:{provider_id:first.provider_id,model_id:first.model_id},second:{provider_id:second.provider_id,model_id:second.model_id}};
}

async function completeLocalChatInBackground(userId:string,conversationId:string,jobId:string,traceId:string,providerId:string,modelId:string,title:string,project:any){
  const deadline=Date.now()+140000;
  let lastError:string|null=null;
  while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,1200));
    const {data:job,error}=await serviceClient().rpc("get_execution_job_gateway",{p_job_id:jobId});
    if(error){ lastError=error.message; continue; }
    const status=String(job?.status||"");
    if(status==="succeeded"){
      const content=String(job?.stdout??"").trim();
      if(!content){ lastError="local_qwen_empty_response"; break; }
      try{
        await persistConversationMessage(
          userId,
          conversationId,
          "assistant",
          content,
          [{type:"text",text:content}],
          traceId,
          "success",
          providerId,
          modelId,
          title,
          project
        );
      }catch(e){
        lastError=String((e as any)?.message??e);
        break;
      }
      return;
    }
    if(["failed","timeout","cancelled","blocked"].includes(status)){
      lastError="local_qwen_job_"+status+":"+(job?.error||job?.stderr||"execution_failed");
      break;
    }
  }
  try{
    const content="ARIA no pudo completar la respuesta local en el tiempo disponible. La ejecución quedó registrada para diagnóstico.";
    await persistConversationMessage(
      userId,
      conversationId,
      "assistant",
      content,
      [{type:"text",text:content}],
      traceId,
      "error",
      providerId,
      modelId,
      title,
      project
    );
  }catch{}
}
function isTransientModelFailure(error:any){const value=String(error instanceof Error?error.message:error||"").toLowerCase();return /429|quota|rate|resource_exhausted|temporarily|timeout|gateway|503|502/.test(value);}
async function executeConversationWithFallback(step:any, prompt:string, conversationId:string, visualContext:any=null, clientMessageId:string|null=null, waitForLocal:boolean=true) {
  const failures:any[]=[];
  if(step?.target){
    try{
      const result=await execute(step,prompt,conversationId,visualContext,clientMessageId,waitForLocal);
      return {result,route:{provider_id:step.target.provider_id,account_id:step.target.account_id,model_id:step.target.model_id},fallback_count:0,failures};
    }catch(error){
      failures.push({provider_id:step.target.provider_id,account_id:step.target.account_id,model_id:step.target.model_id,error:String(error instanceof Error?error.message:error)});
    }
  }

  const routes=await conversationRoutes();
  const seen=new Set<string>();
  if(step?.target) seen.add(String(step.target.provider_id)+"|"+String(step.target.account_id)+"|"+String(step.target.model_id));

  const localRoute=routes.find((route:any)=>route.provider_id==="local_windows") || null;
  const cloudFallbacks=routes.filter((route:any)=>route.provider_id!=="local_windows").slice(0,1);
  const candidateRoutes=[...cloudFallbacks,...(localRoute?[localRoute]:[])];

  for(const route of candidateRoutes){
    const key=String(route.provider_id)+"|"+String(route.account_id)+"|"+String(route.model_id);
    if(seen.has(key)) continue;
    seen.add(key);
    try{
      const candidate={...step,target:{...(step.target||{}),type:"model",provider_id:route.provider_id,account_id:route.account_id,model_id:route.model_id,...(route.device_id?{device_id:route.device_id}: {})}};
      const result=await execute(candidate,prompt,conversationId,visualContext,clientMessageId,waitForLocal);
      return {result,route,fallback_count:failures.length,failures};
    }catch(error){
      failures.push({provider_id:route.provider_id,account_id:route.account_id,model_id:route.model_id,error:String(error instanceof Error?error.message:error)});
      if(!isTransientModelFailure(error)) break;
    }
  }

  const error:any=new Error("conversation_all_routes_failed");
  error.failures=failures;
  throw error;
}

function missionPhase(m:any) {
  const status=String(m?.status||"");
  const done=Number(m?.completed_steps||0);
  const total=Number(m?.total_steps||0);
  const recovery=m?.checkpoint?.recovery?.status;
  const gate=m?.checkpoint?.human_gate;
  if (["succeeded","failed","cancelled"].includes(status)) return { index: 6, total: 6, label: "Finalizar misión" };
  if (status==="blocked" || gate?.status==="pending" || /human_gate|blocked|approval/i.test(String(m?.next_action||""))) return { index: 5, total: 6, label: "Human Gate / Bloqueo" };
  if (status==="queued") return { index: 1, total: 6, label: "Procesar misión" };
  if (status==="planning" || !Array.isArray(m?.checkpoint?.plan) || m.checkpoint.plan.length===0) return { index: 2, total: 6, label: "Separar en pasos" };
  const results=m?.checkpoint?.results&&typeof m.checkpoint.results==="object"?m.checkpoint.results:{};
  if (status==="running" && done===0 && Object.keys(results).length===0) return { index: 3, total: 6, label: "Revisar Human Gates y bloqueos" };
  if (status==="paused" && recovery==="waiting_for_async_executor") return { index: 4, total: 6, label: "Continuar con la misión" };
  if (status==="running" || status==="waiting") return { index: 4, total: 6, label: total>0 ? `Ejecutando · paso ${Math.min(done+1,total)} de ${total}` : "Continuar con la misión" };
  return { index: 4, total: 6, label: "Continuar con la misión" };
}

async function enrichMission(m:any, sb:any, includeEta=true) {
  const steps=rows(m);
  const tw=steps.reduce((a,s)=>a+s.weight,0);
  const dw=steps.filter(s=>s.status==="succeeded"||s.status==="skipped").reduce((a,s)=>a+s.weight,0);
  const progress=tw?Math.max(0,Math.min(100,Math.round(dw/tw*1000)/10)):(m.total_steps?Math.round((m.completed_steps||0)/m.total_steps*1000)/10:0);
  const eta=includeEta ? await etaFor(sb,steps) : {eta_seconds:null,basis:"overview_fast",samples:0};
  const md = m?.metadata && typeof m.metadata === "object" ? m.metadata : {};
  const queuePriority = Number(md.queue_priority);
  return {
    ...m,
    project_id: md.project_id ?? null,
    project_name: md.project_name ?? null,
    queue_priority: Number.isFinite(queuePriority) ? queuePriority : 0,
    progress_percent:progress,
    step_count:steps.length,
    steps,
    eta,
    terminal:terminal.has(String(m.status)),
    phase:missionPhase(m),
    block_details: missionBlockDetails(m)
  };
}

async function missionForUser(missionId: string, userId: string) {
  const sb=serviceClient();
  const {data:mission,error}=await sb.schema("aria_internal").from("mission_state")
    .select("mission_id,goal,status,current_step,total_steps,completed_steps,next_action,last_stdout,last_stderr,finished_at,checkpoint,metadata,created_at,updated_at,lease_owner,lease_until")
    .eq("mission_id",missionId).maybeSingle();
  if(error || !mission)return null;
  const md=mission?.metadata&&typeof mission.metadata==="object"?mission.metadata:{};
  const owner=md.user_id??md.owner_user_id??null;
  if(owner && owner!==userId)return null;
  return enrichMission(mission,sb);
}

async function liveAssistantContext(userId:string) {
  const sb=serviceClient();
  const {data:controller,error:ce}=await sb.schema("aria_internal").from("meditation_control")
    .select("desired_mode,session_id,last_cloud_tick_at,last_cloud_status")
    .eq("controller_id","primary").maybeSingle();
  if(ce)throw new Error(ce.message);
  const {data:all,error:me}=await sb.schema("aria_internal").from("mission_state")
    .select("mission_id,goal,status,current_step,total_steps,completed_steps,next_action,metadata,updated_at,finished_at,checkpoint,lease_owner,lease_until")
    .order("updated_at",{ascending:false}).limit(100);
  if(me)throw new Error(me.message);
  const sessionId=controller?.session_id?String(controller.session_id):"";
  const owned=(all??[]).filter((m:any)=>{
    const md=m?.metadata&&typeof m.metadata==="object"?m.metadata:{};
    return md.user_id===userId||md.owner_user_id===userId||(sessionId&&md.meditation_session_id===sessionId);
  });
  const latestUser=[...owned].filter((m:any)=>String(m?.metadata?.goal_source||"").toLowerCase()==="user").sort((a:any,b:any)=>new Date(String(b.updated_at||0)).getTime()-new Date(String(a.updated_at||0)).getTime())[0]??null;
  const hasLiveLease=(m:any)=>Boolean(m?.lease_owner&&m?.lease_until&&new Date(String(m.lease_until)).getTime()>Date.now());
  const activeRank=(m:any)=>{const s=String(m?.status||"");if(s==="running"&&hasLiveLease(m))return 60;if(s==="waiting"&&hasLiveLease(m))return 45;return 0;};
  const live=[...owned].sort((a:any,b:any)=>activeRank(b)-activeRank(a)||new Date(String(b.updated_at||0)).getTime()-new Date(String(a.updated_at||0)).getTime())[0]??null;
  const active=live;
const recent=owned.slice(0,8).map((m:any)=>({
    mission_id:String(m.mission_id),
    goal:String(m.goal||""),
    status:String(m.status||""),
    current_step:Number(m.current_step||0),
    total_steps:Number(m.total_steps||m.checkpoint?.plan?.length||0),
    completed_steps:Number(m.completed_steps||0),
    next_action:m.next_action??null,
    updated_at:m.updated_at??null
  }));
  const counts=owned.reduce((acc:any,m:any)=>{const k=String(m.status||"unknown");acc[k]=(acc[k]||0)+1;return acc},{} as Record<string,number>);
  return {
    autonomy_mode:String(controller?.desired_mode||"stopped"),
    last_cloud_tick_at:controller?.last_cloud_tick_at??null,
    last_cloud_status:controller?.last_cloud_status??null,
    active_mission:active?{
      mission_id:String(active.mission_id),
      goal:String(active.goal||""),
      status:String(active.status||""),
      current_step:Number(active.current_step||0),
      total_steps:Number(active.total_steps||active.checkpoint?.plan?.length||0),
      completed_steps:Number(active.completed_steps||0),
      next_action:active.next_action??null,
      phase:missionPhase(active)
    }:null,
    foreground_mission:latestUser?{
      mission_id:String(latestUser.mission_id),
      goal:String(latestUser.goal||""),
      status:String(latestUser.status||""),
      current_step:Number(latestUser.current_step||0),
      total_steps:Number(latestUser.total_steps||latestUser.checkpoint?.plan?.length||0),
      completed_steps:Number(latestUser.completed_steps||0),
      next_action:latestUser.next_action??null,
      phase:missionPhase(latestUser)
    }:null,
    counts,
    recent_missions:recent
  };
}
async function meditationStatus(userId: string) { const { data, error } = await serviceClient().schema("aria_internal").from("meditation_control").select("controller_id,owner_user_id,desired_mode,session_id,revision,last_command,last_command_at,last_cloud_tick_at,last_cloud_status,metadata,created_at,updated_at").eq("controller_id", "primary").maybeSingle(); if (error) throw new Error(error.message); if (data?.owner_user_id && data.owner_user_id !== userId) return { owned: false, desired_mode: "stopped", controller_id: "primary" }; return { owned: Boolean(data?.owner_user_id), controller: data }; }
async function meditationControl(userId: string, action: string) {
  const mode = action === "activate" || action === "start"
    ? "active"
    : action === "pause" || action === "paused"
      ? "paused"
      : action === "stop" || action === "stopped"
        ? "stopped"
        : "";
  if (!mode) throw Object.assign(new Error("action_required"), { status: 400 });

  const sb = serviceClient();
  const { data: current, error: ce } = await sb.schema("aria_internal").from("meditation_control")
    .select("*").eq("controller_id", "primary").maybeSingle();
  if (ce) throw new Error(ce.message);
  if (current?.owner_user_id && current.owner_user_id !== userId) {
    throw Object.assign(new Error("meditation_control_owned_by_another_user"), { status: 403 });
  }

  const existingMetadata = current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
    ? current.metadata
    : {};
  const next = {
    controller_id: "primary",
    owner_user_id: current?.owner_user_id || userId,
    desired_mode: mode,
    session_id: mode === "active" ? "med-" + Date.now() + "-" + crypto.randomUUID().slice(0, 8) : (current?.session_id || null),
    revision: Number(current?.revision || 0) + 1,
    last_command: mode,
    last_command_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: { ...existingMetadata, owner_user_id: userId, activation_source: "aria-pwa-v3" }
  };
  const { data, error } = await sb.schema("aria_internal").from("meditation_control")
    .upsert(next, { onConflict: "controller_id" }).select("*").single();
  if (error) throw new Error(error.message);

  if (mode !== "active") return data;

  let cloud_tick: any = null;
  try {
    const x = await internal(DEVICE_GATEWAY + "/v1/meditation/tick-service", {
      session_id: data.session_id,
      user_id: userId,
      source: "aria-pwa-v3-activation"
    });
    cloud_tick = { ok: x.r.ok, http_status: x.r.status, result: x.b };
  } catch (e) {
    cloud_tick = { ok: false, http_status: 503, result: { error: String(e instanceof Error ? e.message : e) } };
  }

  return { ...data, cloud_tick };
}
const terminal = new Set(["succeeded", "failed", "blocked", "cancelled"]);
const weightOf = (step:any) => { const explicit=Number(step?.weight); if(Number.isFinite(explicit)&&explicit>0)return explicit; const risk=String(step?.risk??"READ").toUpperCase(); const base=risk==="DESTRUCTIVE"?3:risk==="HIGH_RISK_WRITE"?2.2:risk==="LOW_RISK_WRITE"?1.4:1; const type=String(step?.executor_type||step?.target?.type||"").toLowerCase(); return base*((type==="device"||type==="self_improvement")?1.25:type==="agent"?1.15:1); };
const reasonType = (m:any) => { const raw=[m?.next_action,m?.last_stderr,m?.checkpoint?.recovery?.status,m?.checkpoint?.human_gate?.original_risk].filter(Boolean).join(" ").toLowerCase(); if(/credential|token|secret|auth|login|api key/.test(raw))return"credential"; if(/payment|billing|subscription|plan/.test(raw))return"payment"; if(/human_gate|approval|approve|authorize|permission/.test(raw))return"approval"; if(/device|windows|offline|agent/.test(raw))return"device"; return"execution"; };
const redactMissionDiagnostic = (value:any) => String(value ?? "")
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
  .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");

function missionBlockDetails(m:any) {
  const recovery = m?.checkpoint?.recovery && typeof m.checkpoint.recovery === "object" ? m.checkpoint.recovery : {};
  const gate = m?.checkpoint?.human_gate && typeof m.checkpoint.human_gate === "object" ? m.checkpoint.human_gate : null;
  const steps = rows(m);
  const failedStepId = String(recovery?.failed_step_id || "");
  const step = steps.find((x:any) => x.id === failedStepId) ?? steps.find((x:any) => ["blocked","failed"].includes(String(x.status))) ?? null;
  const result = step?.result && typeof step.result === "object" ? step.result : {};
  const recoveryStatus = String(recovery?.status || "");
  const status = String(m?.status || "");
  const verificationPending = recoveryStatus === "verification_pending" || gate?.status === "pending";
  const replanRequired = recoveryStatus === "replan_required";
  const recoverable = verificationPending || replanRequired || status === "waiting" || status === "paused" || status === "blocked" || status === "failed";
  const reason = redactMissionDiagnostic(gate?.reason || gate?.description || recovery?.block_details?.reason || m?.last_stderr || m?.next_action || recoveryStatus || "La misión necesita recuperación.");
  const category = String(gate?.risk || gate?.kind || reasonType(m));
  const explanation = redactMissionDiagnostic(
    gate?.description ||
    gate?.reason ||
    recovery?.block_details?.reason ||
    (category === "credential" ? "ARIA necesita que revises la credencial o la ruta de autenticación antes de poder verificar la misión." :
      category === "approval" || gate ? "ARIA necesita una aprobación humana antes de continuar con este paso." :
      "ARIA no pudo completar la estrategia actual. La causa está registrada en la evidencia de la misión.")
  );
  const remediation = redactMissionDiagnostic(
    gate?.remediation ||
    recovery?.block_details?.remediation ||
    (category === "credential" ? "Corrige o actualiza la credencial en el sistema correspondiente y vuelve a ejecutar la misión." :
      category === "approval" || gate ? "Completa la acción humana solicitada y luego vuelve a ejecutar la misión." :
      "Corrige la causa indicada por ARIA y vuelve a ejecutar la misión con la nueva situación.")
  );
  const guideSteps = Array.isArray(gate?.steps) && gate.steps.length
    ? gate.steps.map((x:any) => redactMissionDiagnostic(String(x)))
    : [explanation, remediation, "Cuando quede resuelto, pulsa «Reintentar misión»."];

  const evidence = {
    step_id: failedStepId || step?.id || null,
    executor_type: step?.executor_type || result?.executor_type || null,
    operation: step?.operation || result?.operation || null,
    result_status: result?.status || null,
    verification_status: recovery?.verification_status || result?.repair?.verification_status || result?.verification_status || null,
    pr_number: result?.repair?.pr?.number ?? result?.pr?.number ?? recovery?.block_details?.evidence?.pr_number ?? null,
    recovery_status: recoveryStatus || null,
    attempt_count: Number(m?.attempt_count || 0)
  };

  const directLink = gate?.url || gate?.link || gate?.resource_url ||
    result?.repair?.pr?.html_url || result?.pr?.html_url ||
    recovery?.block_details?.evidence?.url || null;
  const goal = String(m?.goal || "");
  let link = typeof directLink === "string" && /^https?:\/\//i.test(directLink) ? directLink : null;
  let link_label = "Abrir recurso relacionado";
  if (!link && /openrouter/i.test(goal + " " + reason)) { link = "https://openrouter.ai/keys"; link_label = "Abrir OpenRouter · Keys"; }
  else if (!link && /battlecruiser/i.test(goal + " " + reason)) { link = "https://github.com/Robvg9/battlecruiser"; link_label = "Abrir BattleCruiser en GitHub"; }
  else if (!link && /github/i.test(goal + " " + reason)) { link = "https://github.com/Robvg9"; link_label = "Abrir GitHub"; }

  return {
    kind: verificationPending ? "human_gate" : replanRequired ? "replan_required" : status === "blocked" ? "hard_block" : "recovery",
    recoverable,
    retry_ready: recoverable,
    category,
    reason,
    explanation,
    next_action: redactMissionDiagnostic(gate?.next_action || recovery?.block_details?.next_action || m?.next_action || "Revisar la misión y ejecutar la siguiente estrategia gobernada."),
    remediation,
    steps: guideSteps,
    link,
    link_label,
    verification_pending: verificationPending,
    evidence,
    updated_at: m?.updated_at || null,
  };
}
function rows(m:any){ const plan=Array.isArray(m?.checkpoint?.plan)?m.checkpoint.plan:[]; const done=new Set((Array.isArray(m?.checkpoint?.completed_steps)?m.checkpoint.completed_steps:[]).map(String)); const results=m?.checkpoint?.results&&typeof m.checkpoint.results==="object"?m.checkpoint.results:{}; const rec=m?.checkpoint?.recovery&&typeof m.checkpoint.recovery==="object"?m.checkpoint.recovery:{}; const failed=Array.isArray(rec.failed_step_ids)?rec.failed_step_ids.map(String):[]; return plan.map((s:any,i:number)=>{const id=String(s?.id??`step_${i+1}`);let st=done.has(id)?"succeeded":"pending"; if(!done.has(id)&&m?.status==="blocked"&&failed.includes(id))st="blocked"; if(!done.has(id)&&m?.status==="paused"&&rec.status==="waiting_for_async_executor")st=m?.checkpoint?.pending_jobs?.[id]?"waiting":"pending"; if(!done.has(id)&&m?.status==="running"&&Number(m?.current_step??0)===i)st="running"; if(!done.has(id)&&results[id]?.status==="failed")st="failed"; return {index:i+1,id,title:String(s?.title??s?.operation??`Paso ${i+1}`),status:st,risk:String(s?.risk??"READ"),executor_type:String(s?.executor_type||s?.target?.type||""),operation:String(s?.operation??""),depends_on:Array.isArray(s?.depends_on)?s.depends_on.map(String):[],weight:Number(weightOf(s).toFixed(3)),timeout_ms:Number.isFinite(Number(s?.timeout_ms))?Number(s.timeout_ms):null,result:results[id]??null};}); }
async function etaFor(sb:any, steps:any[]){const rem=steps.filter(s=>!['succeeded','skipped'].includes(s.status));if(!rem.length)return{eta_seconds:0,basis:"complete",samples:0};const ops=[...new Set(rem.map(s=>s.operation).filter(Boolean))];let hist:number[]=[];if(ops.length){const {data}=await sb.schema("aria_internal").from("mission_steps").select("operation,started_at,completed_at").in("operation",ops).not("started_at","is",null).not("completed_at","is",null).order("completed_at",{ascending:false}).limit(120);hist=(data??[]).map((r:any)=>{const a=Date.parse(r.started_at),b=Date.parse(r.completed_at),d=(Number.isFinite(a)&&Number.isFinite(b))?(b-a)/1000:NaN;return Number.isFinite(d)&&d>0&&d<86400?d:NaN}).filter(Number.isFinite);}const med=hist.length?[...hist].sort((a,b)=>a-b)[Math.floor(hist.length/2)]:null;const estimate=(s:any)=>{const t=Number(s.timeout_ms);if(Number.isFinite(t)&&t>0)return Math.max(5,Math.min(900,t/1000*.35));return String(s.executor_type).toLowerCase()==="device"?30:12;};const sec=rem.reduce((sum,s)=>sum+(Number(med??estimate(s))*s.weight),0);return{eta_seconds:Math.max(0,Math.round(sec)),basis:hist.length?"historical_operation_median":"step_estimate",samples:hist.length};}
async function missionDiagnosticForUser(missionId:string,userId:string){
  const mission=await missionForUser(missionId,userId);
  if(!mission)return null;
  const sb=serviceClient();
  const [{data:steps,error:se},{data:events,error:ee}]=await Promise.all([
    sb.schema('aria_internal').from('mission_steps').select('mission_id,step_index,status,operation,agent_id,attempt_count,started_at,completed_at,result').eq('mission_id',missionId).order('step_index',{ascending:true}),
    sb.schema('aria_internal').from('mission_events').select('event_id,mission_id,step_index,event_type,payload,created_at,trace_id,span_id,request_id,execution_id,error_code,runtime_version,source_sha').eq('mission_id',missionId).order('created_at',{ascending:true}).limit(300)
  ]);
  if(se)throw new Error('mission_diagnostics_steps:'+se.message);
  if(ee)throw new Error('mission_diagnostics_events:'+ee.message);
  const jobIds=Array.from(new Set((events??[]).map((e:any)=>String(e?.execution_id||e?.payload?.job_id||'')).filter(Boolean)));
  let jobs:any[]=[];let jobEvents:any[]=[];
  if(jobIds.length){
    const [{data:jobsData,error:je},{data:jobEventData,error:jve}]=await Promise.all([
      sb.schema('aria_internal').from('execution_jobs').select('job_id,mission_id,device_id,operation,status,timeout_ms,requested_at,started_at,completed_at,result,metadata,updated_at').in('job_id',jobIds).limit(100),
      sb.schema('aria_internal').from('execution_job_events').select('event_id,job_id,device_id,event_type,payload,created_at').in('job_id',jobIds).order('created_at',{ascending:true}).limit(200)
    ]);
    if(je)throw new Error('mission_diagnostics_jobs:'+je.message);
    if(jve)throw new Error('mission_diagnostics_job_events:'+jve.message);
    jobs=jobsData??[];jobEvents=jobEventData??[];
  }
  const lastEvent=(events??[])[(events??[]).length-1];
  const deviceId=String(lastEvent?.payload?.device_id||lastEvent?.device_id||jobs.find((j:any)=>j.device_id)?.device_id||'');
  let deviceHealth:any={status:'unknown',observed:false};
  if(deviceId){
    const {data:device}=await sb.schema('aria_internal').from('device_registry').select('device_id,status,last_seen_at,updated_at').eq('device_id',deviceId).maybeSingle();
    if(device){deviceHealth={status:String(device.status)==='online'?'healthy':String(device.status)==='pending'?'degraded':'unavailable',observed:true,device_id:device.device_id,last_seen_at:device.last_seen_at};}
  }
  const diagnostic=deriveOperationalDiagnostic({mission,steps:steps??[],events:events??[],jobs,jobEvents,health:{status:deviceHealth.status,observed:deviceHealth.observed,device:deviceHealth}});
  const now=new Date().toISOString();
  const {error:upsertError}=await sb.schema('aria_internal').from('mission_diagnostics').upsert({mission_id:missionId,diagnostic_version:diagnostic.version,correlation:diagnostic.correlation,classification:diagnostic.classification,diagnosis:diagnostic.diagnosis,versions:diagnostic.versions,attempts:diagnostic.attempts,evidence_chain:diagnostic.evidence_chain,health:diagnostic.health,generated_at:now,updated_at:now},{onConflict:'mission_id'});
  if(upsertError)throw new Error('mission_diagnostics_persist:'+upsertError.message);
  return diagnostic;
}

async function operationalHealth(userId:string){
  const sb=serviceClient();
  const {data,error}=await sb.rpc('get_operational_health_v1');
  if(error)throw new Error('diagnostic_health_rpc:'+error.message);
  return {...(data&&typeof data==='object'?data:{}),user_id:userId};
}
async function capabilityCatalog(userId:string){
  const sb=serviceClient();
  const [{data:models,error:modelError},{data:agents,error:agentError},{data:devices,error:deviceError}] = await Promise.all([
    sb.schema("aria_internal").from("model_registry").select("model_id,display_name,provider_id,status,enabled,integration_status,interface_type,model_family,capabilities,context_window,output_limit,updated_at").order("display_name"),
    sb.schema("aria_internal").from("agent_catalog").select("agent_id,role,status,model_id,capabilities,max_risk,updated_at,metadata").order("agent_id"),
    sb.schema("aria_internal").from("device_registry").select("device_id,display_name,agent_type,status,capabilities,last_seen_at,metadata").order("display_name")
  ]);
  if(modelError) throw new Error(`capabilities_models: ${modelError.message}`);
  if(agentError) throw new Error(`capabilities_agents: ${agentError.message}`);
  if(deviceError) throw new Error(`capabilities_devices: ${deviceError.message}`);
  const executors=[
    {id:"connector",type:"connector",status:"available",operations:["*"],purpose:"Conexiones externas gobernadas"},
    {id:"device",type:"device",status:"available",operations:["shell.execute","ollama.qwen3","computer.use","desktop.screenshot","desktop.input","desktop.open","desktop.focus"],purpose:"Dispositivos locales y remotos"},
    {id:"agent",type:"agent",status:"available",operations:["delegate"],purpose:"Delegación especializada entre agentes"},
    {id:"model",type:"model",status:"available",operations:["text_generation"],purpose:"Ejecución de modelos gobernada"},
    {id:"eas",type:"eas",status:"unknown",operations:["eas.connection_status","eas.workflow_definitions","eas.workflow_list","eas.workflow_info","eas.workflow_dispatch","eas.build_list","eas.build_info","eas.build_logs"],purpose:"Expo Application Services"}
  ];
  const providers=[...new Set((models??[]).map((m:any)=>String(m.provider_id||"")).filter(Boolean))].map(provider_id=>{
    const rows=(models??[]).filter((m:any)=>m.provider_id===provider_id);
    return {provider_id,status:rows.some((m:any)=>m.integration_status==="connected"&&m.enabled)? "connected":"degraded",model_count:rows.length};
  });
  const connections=[
    ...providers.map((p:any)=>({id:`model:${p.provider_id}`,type:"model_provider",name:p.provider_id,status:p.status,model_count:p.model_count})),
    ...(devices??[]).map((d:any)=>({id:`device:${d.device_id}`,type:"device",name:d.display_name||d.device_id,status:d.status,capabilities:d.capabilities||[]})),
    {id:"supabase",type:"core_database",name:"Supabase ARIA",status:"connected"},
    {id:"aria-app-api-v3",type:"api",name:"ARIA APP API v3",status:"connected"}
  ];
  return {
    version:"aria-capability-catalog-v1",
    user_id:userId,
    generated_at:new Date().toISOString(),
    executors,
    models:models??[],
    agents:agents??[],
    devices:devices??[],
    connections,
    summary:{
      executors:executors.length,
      models:(models??[]).length,
      models_available:(models??[]).filter((m:any)=>m.enabled&&m.status==="available").length,
      agents:(agents??[]).length,
      agents_available:(agents??[]).filter((a:any)=>a.status==="available").length,
      devices:(devices??[]).length,
      devices_online:(devices??[]).filter((d:any)=>d.status==="online").length,
      connections:connections.length
    }
  };
}
async function meditationOwnedMissionIds(userId:string){
  const sb=serviceClient();
  const {data:controller,error:ce}=await sb.schema("aria_internal").from("meditation_control").select("owner_user_id,session_id").eq("controller_id","primary").maybeSingle();
  if(ce)throw new Error(ce.message);
  if(controller?.owner_user_id&&controller.owner_user_id!==userId)return[];
  const {data:all,error:me}=await sb.schema("aria_internal").from("mission_state").select("mission_id,metadata").order("updated_at",{ascending:false}).limit(5000);
  if(me)throw new Error(me.message);
  const sessionId=controller?.session_id?String(controller.session_id):"";
  return (all??[]).filter((m:any)=>{
    const md=m?.metadata&&typeof m.metadata==="object"?m.metadata:{};
    return md.user_id===userId||md.owner_user_id===userId||(sessionId&&md.meditation_session_id===sessionId);
  }).map((m:any)=>String(m.mission_id)).filter(Boolean);
}
async function meditationNotificationsForUser(userId:string,unreadOnly=false,limit=50){
  const missionIds=await meditationOwnedMissionIds(userId);
  const empty={version:"aria-meditation-notifications-v1",notifications:[],unread_count:0,external_channels:{configured:false,channels:[]}};
  if(!missionIds.length)return empty;
  const safeLimit=Math.max(1,Math.min(100,Number(limit)||50));
  const sb=serviceClient().schema("aria_internal");
  let q=sb.from("meditation_notifications").select("notification_id,source_event_id,mission_id,kind,severity,title,message,action,metadata,read_at,created_at").in("mission_id",missionIds).order("created_at",{ascending:false}).limit(safeLimit);
  if(unreadOnly)q=q.is("read_at",null);
  const [{data,error},{count:unreadCount,error:countError}]=await Promise.all([
    q,
    sb.from("meditation_notifications").select("notification_id",{count:"exact",head:true}).in("mission_id",missionIds).is("read_at",null)
  ]);
  if(error)throw new Error(error.message);
  if(countError)throw new Error(countError.message);
  return{version:"aria-meditation-notifications-v1",notifications:data||[],unread_count:Number(unreadCount||0),external_channels:{configured:false,channels:[]}};
}
async function markMeditationNotificationsReadForUser(userId:string,body:any){
  const ids=Array.isArray(body?.notification_ids)?body.notification_ids.map(String).filter(Boolean):[];
  const all=body?.all===true;
  if(!ids.length&&!all)throw new Error("notification_ids_or_all_required");
  const missionIds=await meditationOwnedMissionIds(userId);
  if(!missionIds.length)return{ok:true,marked_read:0,notification_ids:[]};
  const sb=serviceClient().schema("aria_internal");
  let q=sb.from("meditation_notifications").update({read_at:new Date().toISOString()});
  if(all)q=q.in("mission_id",missionIds).is("read_at",null);
  else q=q.in("notification_id",ids).in("mission_id",missionIds);
  const {data,error}=await q.select("notification_id");
  if(error)throw new Error(error.message);
  return{ok:true,marked_read:Number(data?.length||0),notification_ids:(data||[]).map((x:any)=>String(x.notification_id))};
}

function presentMeditationIdeaProposal(row:any){
  return {
    proposal_id:String(row.proposal_id),
    fingerprint:String(row.fingerprint),
    schema_version:String(row.schema_version),
    status:String(row.status),
    input:{idea:String(row.idea)},
    classification:row.classification??{},
    objective:row.objective??{},
    subobjectives:row.subobjectives??[],
    missions:row.missions??[],
    blockers:row.blockers??[],
    queue_policy:row.metadata?.queue_policy??{mode:"manual_only",auto_enqueue:false,auto_execute:false,human_decision_required:true},
    closure:row.metadata?.closure??{required:true,rule:"inspectable_plan_without_auto_queue"},
    created_from:row.metadata?.created_from??{source:"meditation-idea-analyzer-v2",device_id:row.source_device_id??null,created_by:"aria-pwa"},
    summary:row.metadata?.summary??null,
    converted_missions:row.metadata?.converted_missions??[],
    auto_enqueued:Boolean(row.auto_enqueued),
    created_at:row.created_at,
    updated_at:row.updated_at
  };
}

async function createMeditationIdeaProposalForUser(userId:string, ideaInput:string){
  const idea=String(ideaInput??"").trim();
  if(!idea) throw Object.assign(new Error("idea_required"),{status:400});
  const proposal=await buildIdeaMissionProposal(idea,{created_by:userId});
  const validation=validateProposal(proposal);
  if(!validation.valid) throw Object.assign(new Error("proposal_invalid:"+String(validation.reason??"unknown")),{status:400});
  const sb=serviceClient().schema("aria_internal");
  const {data:existing,error:lookupError}=await sb.from("meditation_idea_proposals")
    .select("*").eq("fingerprint",proposal.fingerprint).maybeSingle();
  if(lookupError) throw new Error(lookupError.message);
  if(existing){
    if(existing.owner_user_id && String(existing.owner_user_id)!==String(userId)){
      throw Object.assign(new Error("idea_already_exists_for_another_owner"),{status:409});
    }
    if(!existing.owner_user_id){
      const {data:claimed,error:claimError}=await sb.from("meditation_idea_proposals")
        .update({owner_user_id:userId,updated_at:new Date().toISOString()})
        .eq("proposal_id",existing.proposal_id)
        .is("owner_user_id",null)
        .select("*").maybeSingle();
      if(claimError) throw new Error(claimError.message);
      if(claimed) return {ok:true,status:String(claimed.status),deduplicated:true,proposal:presentMeditationIdeaProposal(claimed)};
    }
    return {ok:true,status:String(existing.status),deduplicated:true,proposal:presentMeditationIdeaProposal(existing)};
  }
  const {data:row,error}=await sb.from("meditation_idea_proposals").insert({
    fingerprint:proposal.fingerprint,
    idea:proposal.input.idea,
    schema_version:proposal.schema_version,
    status:"proposed",
    owner_user_id:userId,
    classification:proposal.classification,
    objective:proposal.objective,
    subobjectives:proposal.subobjectives,
    missions:proposal.missions,
    blockers:proposal.classification.blockers??[],
    metadata:{
      created_from:{source:"meditation-idea-analyzer-v2",device_id:null,created_by:userId},
      summary:proposal.summary,
      queue_policy:proposal.queue_policy,
      closure:proposal.closure
    },
    auto_enqueued:false,
    source_device_id:null
  }).select("*").single();
  if(error){
    const duplicate=await sb.from("meditation_idea_proposals").select("*").eq("fingerprint",proposal.fingerprint).maybeSingle();
    if(!duplicate.error&&duplicate.data&&(!duplicate.data.owner_user_id||String(duplicate.data.owner_user_id)===String(userId))){
      return {ok:true,status:String(duplicate.data.status),deduplicated:true,proposal:presentMeditationIdeaProposal(duplicate.data)};
    }
    throw Object.assign(new Error(error.message),{status:String(error.code)==="23505"?409:500});
  }
  return {ok:true,status:"proposed",deduplicated:false,proposal:presentMeditationIdeaProposal(row)};
}

async function meditationIdeaProposalsForUser(userId:string,limit=50){
  const safe=Math.max(1,Math.min(100,Number(limit)||50));
  const {data,error}=await serviceClient().schema("aria_internal").from("meditation_idea_proposals")
    .select("proposal_id,fingerprint,idea,schema_version,status,owner_user_id,classification,objective,subobjectives,missions,blockers,metadata,auto_enqueued,source_device_id,created_at,updated_at")
    .eq("owner_user_id",userId)
    .order("created_at",{ascending:false}).limit(safe);
  if(error) throw new Error(error.message);
  return {
    version:"aria-meditation-idea-analyzer-v2",
    items:(data??[]).map(presentMeditationIdeaProposal),
    total:Number((data??[]).length),
    policy:{auto_enqueue:false,auto_execute:false,human_decision_required:true}
  };
}

async function meditationIdeaProposalForUser(userId:string,proposalId:string){
  const {data,error}=await serviceClient().schema("aria_internal").from("meditation_idea_proposals")
    .select("*").eq("proposal_id",proposalId).eq("owner_user_id",userId).maybeSingle();
  if(error) throw new Error(error.message);
  if(!data) throw Object.assign(new Error("proposal_not_found"),{status:404});
  return presentMeditationIdeaProposal(data);
}

async function meditationIdeaDecisionForUser(userId:string,proposalId:string,action:string,note:string|null){
  const sb=serviceClient().schema("aria_internal");
  const {data,error}=await sb.rpc("meditation_idea_proposal_decide",{
    p_proposal_id:proposalId,
    p_owner_user_id:userId,
    p_action:String(action??"").trim().toLowerCase(),
    p_note:note
  });
  if(error) throw Object.assign(new Error(error.message),{status:409});
  return {ok:true,proposal:presentMeditationIdeaProposal(data),action:String(action??"").toLowerCase()};
}

async function meditationIdeaConvertForUser(userId:string,proposalId:string,templateMissionId:string,requestedDeviceId:string|null){
  const sb=serviceClient().schema("aria_internal");
  let deviceId=String(requestedDeviceId??"").trim();
  if(deviceId){
    const {data,error}=await sb.from("device_registry").select("device_id,agent_type,status,last_seen_at")
      .eq("device_id",deviceId).eq("status","online").maybeSingle();
    if(error) throw new Error(error.message);
    if(!data) throw Object.assign(new Error("requested_device_not_online"),{status:409});
  } else {
    const {data,error}=await sb.from("device_registry").select("device_id,agent_type,status,last_seen_at")
      .eq("agent_type","android-termux").eq("status","online").order("last_seen_at",{ascending:false}).limit(1);
    if(error) throw new Error(error.message);
    deviceId=String(data?.[0]?.device_id??"");
  }
  if(!deviceId) throw Object.assign(new Error("android_device_unavailable"),{status:409});
  const {data,error}=await sb.rpc("meditation_idea_convert_mission",{
    p_proposal_id:proposalId,
    p_owner_user_id:userId,
    p_device_id:deviceId,
    p_template_mission_id:templateMissionId
  });
  if(error) throw Object.assign(new Error(error.message),{status:409});
  return {ok:true,device_id:deviceId,...data};
}

async function meditationOverview(userId:string){const sb=serviceClient();const {data:controller,error:ce}=await sb.schema("aria_internal").from("meditation_control").select("controller_id,owner_user_id,desired_mode,session_id,revision,last_command,last_command_at,last_cloud_tick_at,last_cloud_status,metadata,created_at,updated_at").eq("controller_id","primary").maybeSingle();if(ce)throw new Error(ce.message);const controllerOwnedByUser=String(controller?.owner_user_id||"")===userId;const scopedSessionId=controllerOwnedByUser&&controller?.session_id?String(controller.session_id):"";
const {data:all,error:me}=await sb.schema("aria_internal").from("mission_state").select("mission_id,goal,status,current_step,total_steps,completed_steps,next_action,finished_at,metadata,created_at,updated_at,lease_owner,lease_until").order("updated_at",{ascending:false}).limit(200);if(me)throw new Error(me.message);
const owned=(all??[]).filter((m:any)=>{const md=m?.metadata&&typeof m.metadata==="object"?m.metadata:{};return md.user_id===userId||md.owner_user_id===userId||(scopedSessionId&&md.meditation_session_id===scopedSessionId)});
const ranked=owned.map((m:any,i:number)=>({...m,display_title:String(m?.metadata?.display_title||('Misión #'+(owned.length-i))),description:String(m?.goal||"")}));
const latestUser=[...ranked].filter((m:any)=>String(m?.metadata?.goal_source||"").toLowerCase()==="user").sort((a:any,b:any)=>new Date(String(b.updated_at||0)).getTime()-new Date(String(a.updated_at||0)).getTime())[0]??null;
const hasLiveLease=(m:any)=>Boolean(m?.lease_owner&&m?.lease_until&&new Date(String(m.lease_until)).getTime()>Date.now());const activeRank=(m:any)=>{const s=String(m?.status||"");if(s==="running"&&hasLiveLease(m))return 60;if(s==="waiting"&&hasLiveLease(m))return 45;return 0;};const foregroundRank=(m:any)=>{const s=String(m?.status||"");if(s==="planning")return 30;if(s==="queued")return 20;if(s==="paused")return 10;if(s==="succeeded")return 5;if(["failed","blocked","cancelled"].includes(s))return 4;return 0;};
const rawLive=[...ranked].sort((a:any,b:any)=>activeRank(b)-activeRank(a)||foregroundRank(b)-foregroundRank(a)||new Date(String(b.updated_at||0)).getTime()-new Date(String(a.updated_at||0)).getTime())[0]??null;
const rawActive=rawLive;
const visibleIds=ranked.slice(0,20).map((m:any)=>String(m.mission_id));if(rawActive?.mission_id&&!visibleIds.includes(String(rawActive.mission_id)))visibleIds.push(String(rawActive.mission_id));
let detailed:any[]=[];if(visibleIds.length){const {data,error}=await sb.schema("aria_internal").from("mission_state").select("mission_id,goal,status,current_step,total_steps,completed_steps,next_action,last_stdout,last_stderr,finished_at,checkpoint,metadata,created_at,updated_at,lease_owner,lease_until").in("mission_id",visibleIds);if(error)throw new Error(error.message);detailed=data??[];}
const detailedById=new Map(detailed.map((m:any)=>[String(m.mission_id),m]));
const fastMissions=await Promise.all(ranked.slice(0,20).map((m:any)=>enrichMission({...m,...(detailedById.get(String(m.mission_id))||{})},sb,false)));
const activeSource=rawActive?{...rawActive,...(detailedById.get(String(rawActive.mission_id))||{})}:null;
const active=activeSource?await enrichMission(activeSource,sb,true):null;
const foregroundSource=latestUser?{...latestUser,...(detailedById.get(String(latestUser.mission_id))||{})}:null;
const foreground=foregroundSource?await enrichMission(foregroundSource,sb,false):null;
const queuedSources=[...ranked].filter((m:any)=>String(m?.status)==="queued").sort((a:any,b:any)=>Number(b?.metadata?.queue_priority??0)-Number(a?.metadata?.queue_priority??0)||new Date(String(a.updated_at||0)).getTime()-new Date(String(b.updated_at||0)).getTime());
const queuedMissionSources=queuedSources.slice(0,20);
const queuedMissions=queuedMissionSources.map((m:any)=>enrichMission({...m,...(detailedById.get(String(m.mission_id))||{})},sb,false));
const missions=fastMissions.map((m:any)=>m.mission_id===active?.mission_id?active:m);const byId=new Map(missions.map(m=>[m.mission_id,m]));const {data:ev,error:ee}=await sb.schema("aria_internal").from("mission_events").select("mission_id,step_index,event_type,payload,created_at").in("event_type",["human_gate_requested","self_improvement_human_gate"]).order("created_at",{ascending:false}).limit(100);if(ee)throw new Error(ee.message);const gates:any[]=[];for(const e of ev??[]){const m=byId.get(String(e.mission_id));if(!m||terminal.has(String(m.status)))continue;const p=e.payload&&typeof e.payload==='object'?e.payload:{};const step=m.steps.find((s:any)=>s.id===String(p.step_id??''))??null;gates.push({id:`${e.mission_id}:${e.created_at}`,mission_id:e.mission_id,step_id:p.step_id??null,event_type:e.event_type,reason:p.stop_reason??"human_gate_required",risk:step?.risk??m.metadata?.human_gate_required?.[0]??"HIGH_RISK_WRITE",mission_goal:m.goal,operation:step?.operation??null,target:step?{executor_type:step.executor_type,operation:step.operation}:null,instructions:[`Revisa la misión: ${m.goal}`,`Confirma el paso ${step?.index??p.step_id??"pendiente"} y su operación ${step?.operation??"indicada por el gate"}.`,`Verifica el riesgo declarado (${step?.risk??"HIGH_RISK_WRITE"}) y el objetivo antes de aprobar.`,`Usa el control Human Gate de ARIA para aprobar o rechazar la continuación.`],source:e.created_at});}for(const m of missions.filter(x=>!terminal.has(String(x.status)))){const req=m?.metadata?.human_gate_required;if(!Array.isArray(req)||!req.length||gates.some(g=>g.mission_id===m.mission_id))continue;gates.push({id:`${m.mission_id}:policy`,mission_id:m.mission_id,step_id:null,event_type:"policy_gate",reason:"human_gate_required",risk:String(req[0]),mission_goal:m.goal,operation:null,target:null,instructions:["Revisa la misión y el cambio propuesto.",`Confirma la categoría de riesgo: ${String(req[0])}.`,"Aprueba o rechaza la continuación desde Human Gate de ARIA."],source:m.updated_at});}const blocked=missions.filter(m=>String(m.status)==="blocked").map(m=>({mission_id:m.mission_id,goal:m.goal,status:m.status,reason_type:reasonType(m),...(m.block_details||{}),next_action:m.next_action,step:m.steps.find((s:any)=>['blocked','failed','running'].includes(s.status))??null,instructions:[m.block_details?.remediation||"Revisa el motivo indicado.",m.block_details?.next_action||m.next_action||"Determina qué recurso o autorización falta.","ARIA intentará una estrategia alternativa cuando exista una ruta gobernada disponible."],updated_at:m.updated_at}));const verification_pending=missions.filter(m=>String(m.status)==="waiting"&&m?.block_details?.verification_pending).map(m=>({mission_id:m.mission_id,goal:m.goal,status:m.status,...(m.block_details||{}),step:m.steps.find((s:any)=>String(s.id)===String(m?.checkpoint?.recovery?.failed_step_id||""))??null,updated_at:m.updated_at}));
let liveEvents:any[]=[];
if(active?.mission_id){
  const {data:liveEventRows,error:liveEventError}=await sb.schema("aria_internal").from("mission_events")
    .select("event_id,mission_id,step_index,event_type,payload,created_at")
    .eq("mission_id",String(active.mission_id))
    .order("created_at",{ascending:false})
    .limit(30);
  if(liveEventError) throw new Error(liveEventError.message);
  liveEvents=(liveEventRows??[]).reverse();
}
const liveSyncAt=new Date().toISOString();
const activeWithLive=active ? {...active,live_events:liveEvents,live_sync_at:liveSyncAt,live_event_count:liveEvents.length}:null;
return{version:"aria-meditation-dashboard-v5",mode:controllerOwnedByUser?String(controller?.desired_mode??"stopped"):"stopped",controller:controllerOwnedByUser?controller:null,active_mission:activeWithLive,foreground_mission:foreground,queued_missions:await Promise.all(queuedMissions),missions,human_gates:gates.slice(0,30),blocked:blocked.slice(0,30),verification_pending:verification_pending.slice(0,30),counts:{missions:missions.length,human_gates:gates.length,blocked:blocked.length,verification_pending:verification_pending.length,queued:queuedSources.length},source_of_truth:"aria_internal.mission_state"};
}

function looksLikeSimpleConversation(input:string) {
  const value=String(input||"").trim();
  if(!value || value.length>360) return false;
  if(/\b(analiza|compara|planifica|diseña|programa|c[oó]digo|debug|revisa|audita|investiga|pasos|paso|arquitectura|implementa|configura|misión|misi[oó]n)\b/i.test(value)) return false;
  return true;
}

function looksLikeMissionRequest(input: string) {
  const value = String(input || "").trim();
  if (!value) return false;

  const explanatory = /^(qu[eé] es|que es|c[oó]mo|como|por qu[eé]|porque|expl[ií]came|explica|dime qu[eé]|dime como)\b/i.test(value);
  if (/(?:haz|has)\s+que\b/i.test(value)) return true;
  const explicitTask = /\b(necesito que|quiero que|haz que|has que|hazlo|arreglalo|arr[eé]glalo|ejecuta esto|crea esto|implementa esto|dame una misi[oó]n|lanza una misi[oó]n|manda una misi[oó]n)\b/i.test(value);

  // Explicit task phrasing wins even when the action verb is conjugated
  // and therefore is not present in the finite action vocabulary below.
  if (explicitTask) return true;

  const action = /\b(misi[oó]n|ejecuta|ejecutar|haz|hacer|arregla|arreglar|arr[eé]glalo|corrige|corregir|crea|crear|implementa|implementar|modifica|modificar|actualiza|actualizar|despliega|desplegar|repara|reparar|soluciona|solucionar|construye|construir|prueba|probar|cambia|cambiar|mueve|mover|pon|poner|organiza|organizar|rediseña|rediseñar|ordena|ordenar|quita|quitar|elimina|eliminar|a[nñ]ade|a[nñ]adir|agrega|agregar|configura|configurar|ajusta|ajustar)\b/i.test(value);
  if (!action) return false;
  return !explanatory;
}


async function reorderMeditationQueue(userId:string, orderedMissionIds:string[]){
  const ids=Array.from(new Set((orderedMissionIds??[]).map(String).filter(Boolean))).slice(0,100);
  if(!ids.length) throw Object.assign(new Error("ordered_mission_ids_required"),{status:400});
  const sb=serviceClient();
  const {data:rows,error}=await sb.schema("aria_internal").from("mission_state")
    .select("mission_id,status,metadata")
    .in("mission_id",ids);
  if(error) throw new Error(error.message);
  if((rows??[]).length!==ids.length) throw Object.assign(new Error("queue_mission_not_found"),{status:404});
  for(const row of rows??[]){
    const md=row?.metadata&&typeof row.metadata==="object"&&!Array.isArray(row.metadata)?row.metadata:{};
    const owner=md.user_id??md.owner_user_id;
    if(owner!==userId) throw Object.assign(new Error("queue_mission_not_owned"),{status:403});
    if(String(row.status)!=="queued") throw Object.assign(new Error("queue_only_accepts_queued_missions"),{status:409});
  }
  const priorityBase=ids.length*1000;
  for(let i=0;i<ids.length;i++){
    const missionId=ids[i];
    const current=(rows??[]).find((x:any)=>String(x.mission_id)===missionId);
    const md=current?.metadata&&typeof current.metadata==="object"&&!Array.isArray(current.metadata)?current.metadata:{};
    const {error:updateError}=await sb.schema("aria_internal").from("mission_state")
      .update({metadata:{...md,queue_priority:priorityBase-i},updated_at:new Date().toISOString()})
      .eq("mission_id",missionId).eq("status","queued");
    if(updateError) throw new Error(updateError.message);
  }
  return {ordered_mission_ids:ids,queue_priorities:Object.fromEntries(ids.map((id,i)=>[id,priorityBase-i]))};
}

Deno.serve(async (req) => {
  const trace = req.headers.get("x-aria-trace-id") ?? crypto.randomUUID();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  let user: any;
  try { user = await requireUser(bearer(req)); }
  catch (e) { const status = (e as any)?.status === 401 ? 401 : 500; return json({ error: status === 401 ? "invalid_or_expired_session" : "gateway_auth_failure", stage: "auth", detail: String((e as any)?.message ?? e), trace_id: trace }, status); }
  try {
    const path = new URL(req.url).pathname.replace(/\/+$/, "");
    if (req.method === "GET" && path.endsWith("/session")) return json({ ok: true, service: "aria-app-api-v3", user: { id: user.id, email: user.email ?? null }, trace_id: trace });
    if (req.method === "GET" && path.endsWith("/system")) { const r = await fetch(DIRECT); const b = await r.json().catch(() => null); return json({ ok: r.ok, service: "aria-app-api-v3", user_id: user.id, aria: b, trace_id: trace }, r.ok ? 200 : 502); }
    if (req.method === "GET" && path.endsWith("/capabilities")) return json({ ok: true, capabilities: await capabilityCatalog(user.id), trace_id: trace });
    if (req.method === "GET" && path.endsWith("/absorb")) return json({ ok: true, version:"aria-absorb-v1", absorptions: await absorbRows(user.id), trace_id: trace });
    if (req.method === "POST" && path.endsWith("/absorb/inspect")) { const body=await req.json().catch(()=>({})); return json({ok:true,absorption:presentAbsorption(await absorbInspect(user.id,body)),trace_id:trace}); }
    if (req.method === "POST" && path.endsWith("/absorb/verify")) { const body=await req.json().catch(()=>({})); try { return json({ok:true,absorption:presentAbsorption(await absorbVerify(user.id,String(body?.absorption_id||""))),trace_id:trace}); } catch(e) { return json({error:String(e?.message||e),trace_id:trace},Number(e?.status)||409); } }
    if (req.method === "POST" && path.endsWith("/absorb/register")) { const body=await req.json().catch(()=>({})); try { return json({ok:true,absorption:presentAbsorption(await absorbRegister(user.id,String(body?.absorption_id||""),body?.binding||{})),trace_id:trace}); } catch(e) { return json({error:String(e?.message||e),trace_id:trace},Number(e?.status)||409); } }
    if (req.method === "POST" && path.endsWith("/absorb/enable")) { const body=await req.json().catch(()=>({})); try { return json({ok:true,absorption:presentAbsorption(await absorbEnable(user.id,String(body?.absorption_id||""))),trace_id:trace}); } catch(e) { return json({error:String(e?.message||e),trace_id:trace},Number(e?.status)||409); } }

    if (req.method === "GET" && path.endsWith("/projects")) {
      return json({ ok: true, projects: PROJECTS, trace_id: trace });
    }
    if (req.method === "GET" && path.endsWith("/conversation") && !path.includes("/projects/")) {
      const sb = serviceClient();
      // Global chat lookup uses a bounded security-definer RPC that returns only
      // the latest global conversation. Listing every historical conversation can
      // exceed the Edge Function latency budget on large histories.
      const lookup = await sb.rpc("aria_app_get_global_conversation", { p_user_id: user.id });
      if (lookup.error) return json({ error: "conversation_lookup_failed", trace_id: trace }, 502);
      const row = lookup.data && typeof lookup.data === "object" ? lookup.data : null;
      let conversationId = row?.conversation_id ? String(row.conversation_id) : crypto.randomUUID();
      if (!row) {
        const ensured = await sb.rpc("aria_app_ensure_conversation", {
          p_user_id: user.id,
          p_conversation_id: conversationId,
          p_title: "ARIA · Chat"
        });
        if (ensured.error) return json({ error: "conversation_create_failed", trace_id: trace }, 502);
      }
      const payload = await sb.rpc("aria_app_get_conversation", {
        p_user_id: user.id,
        p_conversation_id: conversationId
      });
      if (payload.error) return json({ error: "conversation_read_failed", trace_id: trace }, 502);
      return json({ ok: true, conversation_id: conversationId, conversation: payload.data, trace_id: trace });
    }
    if (req.method === "GET" && path.includes("/projects/") && path.endsWith("/conversation")) {
      const projectId=decodeURIComponent(path.split("/projects/")[1].replace(/\/conversation$/,"")).toLowerCase();
      const project=getProject(projectId);
      if(!project)return json({error:"project_not_found",trace_id:trace},404);
      const sb=serviceClient();
      const {data:projectConversation,error:lookupError}=await sb.rpc("aria_app_get_or_create_project_conversation",{
        p_user_id:user.id,
        p_project_id:project.id,
        p_project_name:project.name
      });
      if(lookupError) return json({error:"project_conversation_lookup_failed",detail:lookupError.message,trace_id:trace},502);
      if(!projectConversation?.conversation_id) return json({error:"project_conversation_lookup_failed",detail:"rpc_returned_no_conversation",trace_id:trace},502);
      const conversationId=String(projectConversation.conversation_id);
      const payload=await sb.rpc("aria_app_get_conversation",{p_user_id:user.id,p_conversation_id:conversationId});
      if(payload.error)return json({error:"project_conversation_read_failed",trace_id:trace},502);
      return json({ok:true,project,conversation_id:conversationId,conversation:payload.data,trace_id:trace});
    }
    if (req.method === "GET" && path.includes("/projects/") && path.endsWith("/missions")) {
      const partsPath = path.split("/projects/")[1].replace(/\/missions$/, "");
      const projectId = decodeURIComponent(partsPath).toLowerCase();
      const project = getProject(projectId);
      if (!project) return json({ error: "project_not_found", trace_id: trace }, 404);
      const url = new URL(req.url);
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 100)));
      const sb = serviceClient();
      const { data, error } = await sb.schema("aria_internal").from("mission_state")
        .select("mission_id,goal,status,current_step,total_steps,completed_steps,next_action,last_stdout,last_stderr,finished_at,checkpoint,metadata,created_at,updated_at")
        .eq("metadata->>project_id", project.id)
        .order("updated_at", { ascending: false }).limit(limit);
      if (error) return json({ error: "project_missions_failed", detail: error.message, trace_id: trace }, 502);
      const owned = (data ?? []).filter((m:any) => {
        const md = m?.metadata && typeof m.metadata === "object" ? m.metadata : {};
        return (md.user_id === user.id || md.owner_user_id === user.id) && String(md.project_id || "").toLowerCase() === project.id;
      });
      const missions = await Promise.all(owned.map((m:any) => enrichMission(m, sb, false)));
      return json({ ok: true, project: project, missions, queue: "canonical", trace_id: trace });
    }
    if (req.method === "GET" && path.endsWith("/missions")) { const overview = await meditationOverview(user.id); return json({ ok: true, source_of_truth: "aria_internal.mission_state", missions: overview.missions, active_mission: overview.active_mission, counts: overview.counts, trace_id: trace }); }
    if (req.method === "GET" && path.endsWith("/meditation/status")) return json({ ok: true, ...await meditationStatus(user.id), trace_id: trace });
    if (req.method === "POST" && path.endsWith("/meditation/control")) { const body = await req.json().catch(() => null); const controller = await meditationControl(user.id, String(body?.action || "").toLowerCase()); return json({ ok: true, controller, trace_id: trace }); }
    if (req.method === "GET" && path.endsWith("/meditation/overview")) return json({ ok: true, ...(await meditationOverview(user.id)), trace_id: trace });

    if (req.method === "POST" && path.endsWith("/meditation/idea-to-mission")) {
      const body = await req.json().catch(() => null);
      try {
        return json({ ok:true, ...(await createMeditationIdeaProposalForUser(user.id,String(body?.idea??""))), trace_id:trace });
      } catch(e) {
        const status=Number((e as any)?.status||500);
        return json({ error:String((e as any)?.message||e), trace_id:trace }, status);
      }
    }
    if (req.method === "GET" && path.endsWith("/meditation/ideas")) {
      const url=new URL(req.url);
      return json({ ok:true, ...(await meditationIdeaProposalsForUser(user.id,Number(url.searchParams.get("limit")||50))), trace_id:trace });
    }
    const ideaDecisionPath=path.match(/\/meditation\/ideas\/([^/]+)\/decision$/);
    if (req.method === "POST" && ideaDecisionPath) {
      const body=await req.json().catch(() => null);
      try {
        return json({
          ...(await meditationIdeaDecisionForUser(
            user.id,
            decodeURIComponent(ideaDecisionPath[1]),
            String(body?.action??""),
            typeof body?.note==="string"?body.note:null
          )),
          trace_id:trace
        });
      } catch(e) {
        const status=Number((e as any)?.status||500);
        return json({ error:String((e as any)?.message||e), trace_id:trace }, status);
      }
    }
    const ideaConvertPath=path.match(/\/meditation\/ideas\/([^/]+)\/convert$/);
    if (req.method === "POST" && ideaConvertPath) {
      const body=await req.json().catch(() => null);
      try {
        return json({
          ...(await meditationIdeaConvertForUser(
            user.id,
            decodeURIComponent(ideaConvertPath[1]),
            String(body?.template_mission_id??""),
            typeof body?.device_id==="string"?body.device_id:null
          )),
          trace_id:trace
        });
      } catch(e) {
        const status=Number((e as any)?.status||500);
        return json({ error:String((e as any)?.message||e), trace_id:trace }, status);
      }
    }
    const ideaReadPath=path.match(/\/meditation\/ideas\/([^/]+)$/);
    if (req.method === "GET" && ideaReadPath) {
      try {
        return json({ok:true,proposal:await meditationIdeaProposalForUser(user.id,decodeURIComponent(ideaReadPath[1])),trace_id:trace});
      } catch(e) {
        const status=Number((e as any)?.status||404);
        return json({error:String((e as any)?.message||e),trace_id:trace},status);
      }
    }
    if (req.method === "POST" && path.endsWith("/meditation/queue/reorder")) {
      const body = await req.json().catch(() => null);
      try {
        const result = await reorderMeditationQueue(user.id, Array.isArray(body?.ordered_mission_ids) ? body.ordered_mission_ids : []);
        return json({ ok:true, ...result, trace_id:trace });
      } catch (e) {
        const status=Number((e as any)?.status||500);
        return json({error:String((e as any)?.message||e),trace_id:trace},status);
      }
    }
    if (req.method === "GET" && path.endsWith("/meditation/notifications")) { const url = new URL(req.url); const unreadOnly = url.searchParams.get("unread_only") === "true"; const limit = Number(url.searchParams.get("limit") || 50); return json({ ok: true, ...(await meditationNotificationsForUser(user.id, unreadOnly, limit)), trace_id: trace }); }
    if (req.method === "POST" && path.endsWith("/meditation/notifications/read")) { const body = await req.json().catch(() => null); return json({ ...await markMeditationNotificationsReadForUser(user.id, body), trace_id: trace }); }
    if (req.method === "POST" && path.endsWith("/media/upload-url")) { const body = await req.json().catch(() => null); const fileName = typeof body?.fileName === "string" && body.fileName.trim() ? body.fileName.trim().replace(/[^A-Za-z0-9._-]/g, "_") : "upload.bin"; const objectPath=`${user.id}/${crypto.randomUUID()}/${fileName}`; const { data, error } = await serviceClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(objectPath); if (error || !data?.signedUrl) return json({ error: "media_upload_url_failed", stage: "media", trace_id: trace }, 502); return json({ ok: true, bucket: MEDIA_BUCKET, path: objectPath, signedUrl: data.signedUrl, trace_id: trace }); }
    if (req.method === "POST" && path.endsWith("/conversation")) {
      const body = await req.json().catch(() => null);
      const parts = Array.isArray(body?.parts) ? body.parts : [];
      const text = parts.filter((p:any)=>p?.type==="text").map((p:any)=>String(p.text??"").trim()).filter(Boolean).join("\n");
      const project = normalizeProjectContext(body);
      const visual_context = normalizeVisualContext(body);
      const attachments = normalizeAttachments(parts);
      const clientMessageId = typeof body?.clientMessageId === "string" && body.clientMessageId.trim() ? body.clientMessageId.trim() : null;
      if (!text) return json({ error: "text_or_attachment_required", stage: "input", trace_id: trace }, 400);
      const requestStartedAt = Date.now();
      let conversationId = typeof body?.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : crypto.randomUUID();
      let persistenceWarning: string | null = null;
      let initialPersistenceMs: number | null = null;
      const initialPersistStartedAt = Date.now();
      try {
        const persistedUserMessage = await persistConversationMessage(user.id,conversationId,"user",text,parts,trace,null,null,null,project?.name ? project.name+" · Chat" : "ARIA · Chat",project);
        if (persistedUserMessage?.conversation_id) conversationId = String(persistedUserMessage.conversation_id);
      } catch(e) {
        initialPersistenceMs = Date.now() - initialPersistStartedAt;
        persistenceWarning = String((e as any)?.message ?? e);
      }
      if (initialPersistenceMs === null) initialPersistenceMs = Date.now() - initialPersistStartedAt;

      let assistantPersistenceMs: number | null = null;
      const missionAction = String(body?.mission_action ?? '').trim().toLowerCase();
      const confirmedMissionGoal = missionAction === "confirm_mission" && typeof body?.mission_goal === "string"
        ? body.mission_goal.trim()
        : "";
      const missionCandidate = looksLikeMissionRequest(text);

      if (missionCandidate && !confirmedMissionGoal) {
        const confirmationText = `Entiendo esto como una solicitud para que ARIA realice trabajo. ¿Quieres que comience una misión para: «${text}»? Si solo querías preguntar o conversar, no iniciaré ninguna misión.`;
        const assistantPersistStartedAt = Date.now();
        try {
          await persistConversationMessage(
            user.id,
            conversationId,
            "assistant",
            confirmationText,
            [{type:"text",text:confirmationText}],
            trace,
            "mission_confirmation_required",
            null,
            null,
            project?.name ? project.name+" · Chat" : "ARIA · Chat",
            project
          );
          assistantPersistenceMs = Date.now() - assistantPersistStartedAt;
        } catch(e) {
          persistenceWarning = persistenceWarning || String((e as any)?.message ?? e);
          assistantPersistenceMs = Date.now() - assistantPersistStartedAt;
        }
        return json({
          ok: true,
          conversationId,
          visualState: "mission_confirmation_required",
          mission_confirmation_required: true,
          pending_mission: { goal: text, conversationId },
          parts: [{ type: "text", text: confirmationText }],
          cognitive: {
            recall_count: 0,
            provider_id: null,
            model_id: null,
            fallback_count: 0,
            routed_to_mission: false,
            confirmation_required: true,
            processing_ms: Date.now() - requestStartedAt,
            input_persistence_ms: initialPersistenceMs,
            assistant_persistence_ms: assistantPersistenceMs ?? null,
            persistence_warning: persistenceWarning
          },
          trace_id: trace
        });
      }

      if (confirmedMissionGoal) {
        const direct = await internal(DIRECT, {
          goal: confirmedMissionGoal,
          mission_id: undefined,
          metadata: {
            source_application: "aria-pwa-chat",
            user_id: user.id,
            project_id: project?.id ?? null,
            project_name: project?.name ?? null,
            project_context: project?.context ?? null,
            visual_context,
            attachments,
            goal_source: "chat",
            execution_requested: true,
            mission_confirmation: true,
            conversation_id: conversationId,
            trace_id: trace,
            request_id: req.headers.get("x-aria-request-id") ?? trace,
            pwa_build: req.headers.get("x-aria-pwa-build") ?? null,
            source_sha: (() => { const v=req.headers.get("x-aria-pwa-build"); return v && /^[0-9a-f]{40}$/i.test(v) ? v : null; })(),
            runtime_version: "aria-mission-runner-v22-universal",
            diagnostic_contract_version: "aria-operational-diagnostics-v1.0.0",
            chat_handoff: "canonical-direct-v1",
          },
          "x-aria-user-id": user.id,
        });
        if (!direct.r.ok) {
          return json({
            error: "mission_enqueue_failed",
            stage: "canonical_mission_intake",
            detail: String(direct.b?.error ?? "aria_direct_failed"),
            upstream_status: direct.r.status,
            trace_id: trace
          }, direct.r.status >= 500 ? 503 : direct.r.status);
        }
        const mission = direct.b?.mission ?? direct.b?.result ?? null;
        if (!mission?.mission_id) {
          return json({
            error: "mission_enqueue_failed",
            stage: "canonical_mission_intake",
            detail: "canonical_direct_returned_no_mission_id",
            trace_id: trace
          }, 502);
        }
        const ackText="Confirmado. La misión entró en la cola de Meditación IA. ARIA ejecutará los pasos mediante sus executors autorizados y solo podrá cerrarla cuando exista evidencia real de ejecución y verificación.";
        const assistantPersistStartedAt = Date.now();
        try {
          await persistConversationMessage(user.id,conversationId,"assistant",ackText,[{type:"text",text:ackText}],trace,"mission_queued",null,null,project?.name ? project.name+" · Chat" : "ARIA · Chat",project);
          assistantPersistenceMs = Date.now() - assistantPersistStartedAt;
        } catch(e) {
          persistenceWarning = persistenceWarning || String((e as any)?.message ?? e);
          assistantPersistenceMs = Date.now() - assistantPersistStartedAt;
        }
        return json({
          ok: true,
          conversationId,
          visualState: "mission_queued",
          mission,
          parts: [{ type: "text", text: ackText }],
          cognitive: {
            recall_count: 0,
            provider_id: null,
            model_id: null,
            fallback_count: 0,
            routed_to_mission: true,
            canonical_intake: true,
            confirmation_used: true,
            processing_ms: Date.now() - requestStartedAt,
            input_persistence_ms: initialPersistenceMs,
            assistant_persistence_ms: assistantPersistenceMs ?? null,
            persistence_warning: persistenceWarning
          },
          trace_id: trace
        });
      }

      const lane = classifyConversation(text);
      const cognitiveSources = lane.lane === "deep" ? await Promise.all([recall(text,user.id), learnedContext(project)]) : [[], { skills: [], world_model: null }];
      const memory = cognitiveSources[0] as any[];
      const learned = cognitiveSources[1] as any;
      let step: any;
      if (lane.lane === "fast" || looksLikeSimpleConversation(text)) {
        const routes=await conversationRoutes();
        if(routes[0]) step={target:{type:"model",provider_id:routes[0].provider_id,account_id:routes[0].account_id,model_id:routes[0].model_id}};
      }
      if (!step?.target) {
        try {
          step = await plan(text, { version: "cognitive-loop-v2", user_id: user.id, memory: memory.slice(0, 6), memory_available: memory.length > 0, learned_skills: learned.skills.slice(0, 6), world_model: learned.world_model, project, visual_context, attachments });
        } catch (e) {
          return json({ error: "conversation_planner_failed", stage: "planner", detail: String((e as any)?.message ?? e), processing_ms: Date.now() - requestStartedAt, input_persistence_ms: initialPersistenceMs, persistence_warning: persistenceWarning, trace_id: trace }, 503);
        }
      }
      const context = memory.slice(0, 6).map((m:any)=>String(m?.content??"").trim()).filter(Boolean).join("\n\n");
      const runtimeQuery = /\b(estado|misi[oó]n|misiones|ejecuci[oó]n|bloquead|completad|online|capacidad|capacidades|dispositivo|meditaci[oó]n|verificaci[oó]n|runtime|aria)\b/i.test(text);
      const live = runtimeQuery ? await liveAssistantContext(user.id).catch(() => null) : null;
      const liveText = live ? "Estado LIVE del sistema ARIA (fuente operativa):\n" + JSON.stringify(live) : "";
      const prompt = [
        "Eres ARIA, la IA operativa del sistema.",
        "REGLA PRINCIPAL: responde primero y exactamente a la última frase del usuario. No conviertas el contexto técnico o el historial del sistema en la pregunta del usuario.",
        "El estado LIVE, memoria y contexto visual son fuentes auxiliares. Solo úsalos cuando ayuden a contestar la petición real.",
        "Para una conversación casual, saludo, confirmación o pregunta simple, responde de forma directa y natural; no hables de misiones o Meditación IA salvo que el usuario lo haya pedido.",
        "No digas que careces de acceso a herramientas, persistencia o ejecución si el contexto demuestra lo contrario.",
        "No inventes acciones ejecutadas. Distingue siempre entre en cola, ejecutando, bloqueada, completada o fallida.",
        project ? "PROYECTO ACTIVO: " + JSON.stringify(project) + ". Mantén la conversación dentro de este proyecto y no la desvíes al estado global de ARIA salvo que el usuario lo pida." : "",
        visual_context ? "DISEÑO VISUAL Y ANOTACIONES: " + JSON.stringify(visual_context) : "",
        attachments.length ? "ADJUNTOS DE ESTA CONVERSACIÓN: " + JSON.stringify(attachments) : "",
        liveText,
        learned.skills.length ? "HABILIDADES APRENDIDAS Y VERIFICADAS RELEVANTES:\n" + JSON.stringify(learned.skills.slice(0, 6)) : "",
        learned.world_model ? "WORLD MODEL DEL PROYECTO:\n" + JSON.stringify(learned.world_model) : "",
        context ? "MEMORIA CONTEXTUAL AUTORIZADA:\n" + context : "",
        "MENSAJE DEL USUARIO — RESPONDE A ESTO DIRECTAMENTE:\n" + text
      ].filter(Boolean).join("\n\n");
      const modelStartedAt = Date.now();
      let execution:any;
      let debate:any = null;
      try {
        if (shouldDebate(text, lane.lane)) {
          try { debate = await executeDebate(step, prompt, conversationId, visual_context, clientMessageId, true); } catch { debate = null; }
        }
        execution = debate ? { result: debate.result, route: debate.second, fallback_count: 0, failures: [], debate: true } : await executeConversationWithFallback(step, prompt, conversationId, visual_context, clientMessageId, false);
      } catch (e) {
        return json({ error: "conversation_model_execution_failed", stage: "model_execution", detail: String((e as any)?.message ?? e), fallback_attempts: Array.isArray((e as any)?.failures) ? (e as any).failures.map((x:any)=>({provider_id:x.provider_id,model_id:x.model_id,error:x.error})) : [], processing_ms: Date.now() - requestStartedAt, model_ms: Date.now() - modelStartedAt, input_persistence_ms: initialPersistenceMs, persistence_warning: persistenceWarning, trace_id: trace }, 502);
      }
      const result=execution.result;
      if(result?.status==="processing" && result?.job_id){
        const title=project?.name ? project.name+" · Chat" : "ARIA · Chat";
        EdgeRuntime.waitUntil(
          completeLocalChatInBackground(
            user.id,
            conversationId,
            String(result.job_id),
            trace,
            String(result.provider_id||"local_windows"),
            String(result.model_id||"qwen3:0.6b"),
            title,
            project
          )
        );
        return json({
          ok:true,
          conversationId,
          visualState:"processing",
          processing:true,
          job_id:String(result.job_id),
          parts:[],
          cognitive:{
            recall_count:memory.length,
            provider_id:result.provider_id,
            model_id:result.model_id,
            fallback_count:execution.fallback_count,
            fast_lane:lane.lane,
            fast_lane_reason:lane.reason,
            debate_used:false,
            processing_ms:Date.now()-requestStartedAt,
            input_persistence_ms:initialPersistenceMs,
            assistant_persistence_ms:null,
            persistence_warning:persistenceWarning
          },
          trace_id:trace
        });
      }
      const content = typeof result?.response?.content === "string" ? result.response.content.trim() : "";
      if (!content) {
        return json({ error: "conversation_model_execution_failed", stage: "model_execution", detail: "empty_conversation_response", processing_ms: Date.now() - requestStartedAt, model_ms: Date.now() - modelStartedAt, trace_id: trace }, 502);
      }
      const assistantPersistStartedAt = Date.now();
      try {
        await persistConversationMessage(user.id,conversationId,"assistant",content,[{type:"text",text:content}],trace,"success",execution.route.provider_id,execution.route.model_id,project?.name ? project.name+" · Chat" : "ARIA · Chat",project);
        assistantPersistenceMs = Date.now() - assistantPersistStartedAt;
      } catch(e) {
        persistenceWarning = persistenceWarning || String((e as any)?.message ?? e);
        assistantPersistenceMs = Date.now() - assistantPersistStartedAt;
      }
      return json({
        ok: true,
        conversationId,
        visualState: "success",
        parts: [{ type: "text", text: content }],
        cognitive: {
          recall_count: memory.length,
          provider_id: execution.route.provider_id,
          model_id: execution.route.model_id,
          fallback_count: execution.fallback_count,
          fast_lane: lane.lane,
          fast_lane_reason: lane.reason,
          debate_used: Boolean(execution.debate),
          debate_models: execution.debate ? [execution.route?.model_id, debate?.first?.model_id] : [],
          processing_ms: Date.now() - requestStartedAt,
          model_ms: Date.now() - modelStartedAt,
          input_persistence_ms: initialPersistenceMs,
          assistant_persistence_ms: assistantPersistenceMs,
          persistence_warning: persistenceWarning
        },
        trace_id: trace
      });
    }
    if (req.method === "POST" && path.endsWith("/missions")) {
      const body = await req.json().catch(() => null);
      const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
      if (!goal) return json({ error: "goal_required", stage: "input", trace_id: trace }, 400);
      const requestId = req.headers.get("x-aria-request-id") ?? trace;
      const pwaBuild = req.headers.get("x-aria-pwa-build") ?? null;
      const project = normalizeProjectContext(body);
      const visual_context = normalizeVisualContext(body);
      const direct = await internal(DIRECT, {
        goal,
        mission_id: typeof body?.missionId === "string" ? body.missionId : undefined,
        metadata: {
          source_application: "aria-app-v1",
          user_id: user.id,
          goal_source: "user",
          project_id: project?.id ?? null,
          project_name: project?.name ?? null,
          project_context: project?.context ?? null,
          visual_context,
          trace_id: trace,
          request_id: requestId,
          pwa_build: pwaBuild,
          runtime_version: "aria-mission-runner-v22-universal",
          diagnostic_contract_version: "aria-operational-diagnostics-v1.0.0",
        },
        "x-aria-user-id": user.id
      });
      if (!direct.r.ok) return json({ error: direct.b?.error ?? "aria_direct_failed", trace_id: trace }, direct.r.status);
      return json({ ok: true, ...direct.b, trace_id: trace });
    }
    if (req.method === "POST" && path.includes("/missions/") && path.endsWith("/retry")) {
      const missionId = decodeURIComponent(path.split("/missions/")[1].replace(/\/retry$/,""));
      const original = await missionForUser(missionId, user.id);
      if (!original) return json({ error: "mission_not_found", trace_id: trace }, 404);
      const status = String(original.status || "");
      if (!["blocked","failed","waiting","paused","cancelled"].includes(status)) {
        return json({ error: "mission_not_retryable", detail: "Solo se pueden reintentar misiones detenidas por bloqueo, Human Gate o fallo.", trace_id: trace }, 409);
      }

      const sb = serviceClient();
      const { data: activeRetries, error: retryLookupError } = await sb.schema("aria_internal").from("mission_state")
        .select("mission_id,status,metadata")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (retryLookupError) return json({ error: "mission_retry_lookup_failed", detail: retryLookupError.message, trace_id: trace }, 502);

      const activeRetry = (activeRetries ?? []).find((m:any) => {
        const md = m?.metadata && typeof m.metadata === "object" ? m.metadata : {};
        return md.user_id === user.id &&
          md.retry_of === missionId &&
          ["queued","planning","running","waiting","paused"].includes(String(m.status || ""));
      });
      if (activeRetry) return json({ error: "mission_retry_already_active", mission_id: activeRetry.mission_id, trace_id: trace }, 409);

      const md = original.metadata && typeof original.metadata === "object" ? original.metadata : {};
      const retryCount = Number(md.retry_count || 0) + 1;
      const retryRequestId = req.headers.get("x-aria-request-id") ?? trace;
      const retryPwaBuild = req.headers.get("x-aria-pwa-build") ?? null;
      const direct = await internal(DIRECT, {
        goal: String(original.goal || ""),
        metadata: {
          ...md,
          trace_id: trace,
          request_id: retryRequestId,
          pwa_build: retryPwaBuild,
          source_sha: retryPwaBuild && /^[0-9a-f]{40}$/i.test(retryPwaBuild) ? retryPwaBuild : null,
          runtime_version: "aria-mission-runner-v22-universal",
          diagnostic_contract_version: "aria-operational-diagnostics-v1.0.0",
          source_application: "aria-pwa-retry",
          user_id: user.id,
          retry_of: missionId,
          retry_count: retryCount,
          retry_source_status: status,
          execution_requested: true,
        },
        "x-aria-user-id": user.id,
      });
      if (!direct.r.ok) return json({ error: "mission_retry_enqueue_failed", detail: String(direct.b?.error || "aria_direct_failed"), trace_id: trace }, direct.r.status >= 500 ? 503 : direct.r.status);
      const mission = direct.b?.mission ?? direct.b?.result ?? null;
      if (!mission?.mission_id) return json({ error: "mission_retry_enqueue_failed", detail: "canonical_direct_returned_no_mission_id", trace_id: trace }, 502);
      return json({ ok: true, mission, retry_of: missionId, retry_count: retryCount, trace_id: trace });
    }
    if (req.method === "POST" && path.includes("/missions/") && path.endsWith("/cancel")) {
      const missionId = decodeURIComponent(path.split("/missions/")[1].replace(/\/cancel$/,""));
      const original = await missionForUser(missionId, user.id);
      if (!original) return json({ error: "mission_not_found", trace_id: trace }, 404);
      const status = String(original.status || "");
      const terminalStatuses = new Set(["succeeded","failed","blocked","cancelled"]);
      if (terminalStatuses.has(status)) {
        return json({
          error: status === "cancelled" ? "mission_already_cancelled" : "mission_not_cancellable",
          detail: status === "cancelled" ? "La misión ya estaba cancelada." : "La misión ya terminó y no puede cancelarse.",
          trace_id: trace
        }, 409);
      }

      const sb = serviceClient();
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await sb.schema("aria_internal")
        .from("mission_state")
        .update({
          status: "cancelled",
          next_action: "cancelled_by_user",
          finished_at: now,
          lease_owner: null,
          lease_until: null,
          updated_at: now
        })
        .eq("mission_id", missionId)
        .in("status", ["queued","planning","running","waiting","paused"])
        .select("mission_id,goal,status,current_step,total_steps,completed_steps,next_action,finished_at,updated_at,metadata")
        .maybeSingle();

      if (updateError) {
        return json({ error: "mission_cancel_failed", detail: updateError.message, trace_id: trace }, 502);
      }
      if (!updated) {
        return json({
          error: "mission_cancel_race",
          detail: "La misión cambió de estado antes de poder cancelarse. Actualiza y vuelve a intentarlo.",
          trace_id: trace
        }, 409);
      }

      const { error: eventError } = await sb.schema("aria_internal").from("mission_events").insert({
        mission_id: missionId,
        event_type: "mission_cancelled",
        payload: {
          reason: "user_requested",
          cancelled_by: user.id,
          cancelled_at: now
        },
        created_at: now
      });
      const mission = await enrichMission(updated, sb, true);
      if (eventError) {
        return json({
          ok: true,
          mission,
          cancelled: true,
          evidence_warning: "La misión fue cancelada, pero ARIA no pudo persistir el evento de cancelación.",
          evidence_error: eventError.message,
          trace_id: trace
        });
      }
      return json({
        ok: true,
        mission,
        cancelled: true,
        trace_id: trace
      });
    }
    if (req.method === "GET" && path.endsWith("/diagnostics/health")) {
      try {
        return json({ok:true,health:await operationalHealth(user.id),trace_id:trace});
      } catch {
        return json({
          ok: true,
          health: {
            version: "aria-operational-diagnostics-v1.0.0",
            status: "unavailable",
            observed: false,
            scope: "system",
            user_id: user.id,
            reason: "diagnostic_unavailable",
            next_actions: ["Restaurar el diagnóstico operativo antes de considerar el núcleo saludable."]
          },
          trace_id: trace
        });
      }
    }
    if (req.method === "GET" && path.includes("/missions/") && path.endsWith("/diagnostic")) {
      const missionId=decodeURIComponent(path.split("/missions/")[1].replace(/\/diagnostic$/,""));
      const diagnostic=await missionDiagnosticForUser(missionId,user.id);
      if(!diagnostic)return json({error:"mission_not_found",trace_id:trace},404);
      return json({ok:true,diagnostic,trace_id:trace});
    }
    if (req.method === "GET" && path.includes("/missions/") && path.endsWith("/events")) {
      const missionId=decodeURIComponent(path.split("/missions/")[1].replace(/\/events$/,""));
      const mission=await missionForUser(missionId,user.id);
      if(!mission) return json({error:"mission_not_found",trace_id:trace},404);
      const {data,error}=await serviceClient().schema("aria_internal").from("mission_events").select("event_id,mission_id,step_index,event_type,payload,created_at,trace_id,span_id,request_id,execution_id,error_code,runtime_version,source_sha").eq("mission_id",missionId).order("created_at",{ascending:true}).limit(200);
      if(error) return json({error:"mission_events_failed",detail:error.message,trace_id:trace},502);
      return json({ok:true,events:data??[],trace_id:trace});
    }
    if (req.method === "GET" && path.includes("/missions/")) { const missionId = decodeURIComponent(path.split("/missions/")[1]); const mission = await missionForUser(missionId, user.id); if (!mission) return json({ error: "mission_not_found", trace_id: trace }, 404); return json({ mission, trace_id: trace }); }
    if (req.method === "POST" && path.endsWith("/memory/search")) { const body = await req.json().catch(() => null); const text = typeof body?.query === "string" ? body.query.trim() : ""; if (!text) return json({ error: "query_required", stage: "input", trace_id: trace }, 400); const results = await recall(text, user.id); return json({ ok: true, query: text, result_count: results.length, results, scope: "user", trace_id: trace }); }
    return json({ error: "not_found", stage: "routing", trace_id: trace }, 404);
  } catch (e) { return json({ error: "internal_error", stage: "gateway", detail: String((e as any)?.message ?? e), trace_id: trace }, 500); }
});
