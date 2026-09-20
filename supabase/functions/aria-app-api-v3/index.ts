import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const DIRECT = `${SUPABASE_URL}/functions/v1/aria-direct-v1`;
const MEMORY = `${SUPABASE_URL}/functions/v1/aria-memory-v2`;
const PLANNER = `${SUPABASE_URL}/functions/v1/aria-planner-v11`;
const EXEC = `${SUPABASE_URL}/functions/v1/aria-execution-runtime-v1`;
const MEDIA_BUCKET = "aria-app-media";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization,apikey,x-client-info,x-aria-trace-id,content-type", "access-control-allow-methods": "GET,POST,OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS } });
const bearer = (req: Request) => { const value = req.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; };
function serviceClient() { if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("service_role_not_configured"); return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false } }); }
async function requireUser(token: string) {
  if (!token) throw Object.assign(new Error("missing_authorization"), { status: 401 });
  const { data, error } = await serviceClient().auth.getClaims(token);
  const claims:any = data?.claims;
  if (error || !claims?.sub) throw Object.assign(new Error("invalid_or_expired_session"), { status: 401 });
  return { id: String(claims.sub), email: typeof claims.email === "string" ? claims.email : null };
}
async function internal(url: string, payload: unknown) { if (!SECRET) throw new Error("runtime_secret_not_configured"); const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` }, body: JSON.stringify(payload) }); const b = await r.json().catch(() => null); return { r, b }; }
async function recall(text: string, userId: string) { try { const x = await internal(MEMORY, { action: "search", query: text, limit: 8, user_id: userId, "x-aria-user-id": userId }); return Array.isArray(x.b?.results) ? x.b.results : []; } catch { return []; } }
async function plan(text: string, context: unknown) { const x = await internal(PLANNER, { goal: `IA conversacional: responde al usuario de forma natural y útil. ${text}`, context }); if (!x.r.ok || x.b?.ok !== true || !x.b?.plan?.steps?.[0]) throw new Error(`planner_http_${x.r.status}_${x.b?.error ?? "invalid_plan"}`); return x.b.plan.steps[0]; }
let conversationRouteCache:{expiresAt:number;routes:any[]}|null=null;

async function conversationRoutes() {
  if(conversationRouteCache && conversationRouteCache.expiresAt>Date.now()) return conversationRouteCache.routes;
  const [{data:models},{data:caps},{data:accounts}] = await Promise.all([
    serviceClient().schema("aria_internal").from("model_registry").select("model_id,provider_id,status,enabled"),
    serviceClient().schema("aria_internal").from("capability_matrix").select("model_id,status,evidence_type,evidence_ref").eq("capability_id","text_generation"),
    serviceClient().schema("aria_internal").from("account_registry").select("account_id,provider_id,status,enabled")
  ]);
  const routes=(models ?? []).filter((m:any)=>m.enabled && m.status==="available").map((m:any)=>{
    const cap=(caps ?? []).find((x:any)=>x.model_id===m.model_id);
    const account=(accounts ?? []).find((a:any)=>a.provider_id===m.provider_id && a.enabled && ["available","active"].includes(String(a.status)));
    if(!account)return null;
    const providerBoost=m.provider_id==="google"?12:m.provider_id==="xai"?8:0;
    return {model_id:m.model_id,provider_id:m.provider_id,account_id:account.account_id,capability_status:cap?.status ?? "unknown",evidence_type:cap?.evidence_type ?? "unknown",evidence_ref:cap?.evidence_ref ?? null,score:(cap?.status==="verified"?100:50)+providerBoost};
  }).filter(Boolean).sort((a:any,b:any)=>b.score-a.score);
  conversationRouteCache={expiresAt:Date.now()+30000,routes};
  return routes;
}

async function execute(step: any, prompt: string, conversationId: string) {
  const target = step?.target;
  if (!target?.provider_id || !target?.account_id || !target?.model_id) throw new Error("executor_contract_route_incomplete");
  const x = await internal(EXEC, { execution_version: "1", request_id: conversationId + ":" + crypto.randomUUID(), task_id: "conversation:" + conversationId, capability: "text_generation", selected_route: { status: "selected", provider_id: target.provider_id, account_id: target.account_id, model_id: target.model_id, capability: "text_generation" }, authorization: { status: "approved", risk_class: "READ", evidence_ref: "aria-app-api-v3" }, input: { payload: { messages: [{ role: "user", content: [{ type: "text", text: prompt }] }], max_tokens: 512, temperature: 0.3 } }, policy: {}, metadata: { conversation_id: conversationId, source_application: "aria-app-v1", executor_type: "model", multimodal: false } });
  if (!x.r.ok || x.b?.status !== "succeeded") throw new Error("executor_http_" + x.r.status + "_" + (x.b?.error?.code ?? x.b?.reason ?? "execution_failed"));
  return x.b;
}

async function executeConversationWithFallback(step:any, prompt:string, conversationId:string) {
  const failures:any[]=[];
  if(step?.target){
    try{
      const result=await execute(step,prompt,conversationId);
      return {result,route:{provider_id:step.target.provider_id,account_id:step.target.account_id,model_id:step.target.model_id},fallback_count:0,failures};
    }catch(error){
      failures.push({provider_id:step.target.provider_id,account_id:step.target.account_id,model_id:step.target.model_id,error:String(error instanceof Error?error.message:error)});
    }
  }

  const routes=await conversationRoutes();
  const seen=new Set<string>();
  if(step?.target) seen.add(String(step.target.provider_id)+"|"+String(step.target.account_id)+"|"+String(step.target.model_id));

  for(const route of routes.slice(0,4)){
    const key=String(route.provider_id)+"|"+String(route.account_id)+"|"+String(route.model_id);
    if(seen.has(key)) continue;
    seen.add(key);
    try{
      const candidate={...step,target:{...(step.target||{}),type:"model",provider_id:route.provider_id,account_id:route.account_id,model_id:route.model_id}};
      const result=await execute(candidate,prompt,conversationId);
      return {result,route,fallback_count:failures.length,failures};
    }catch(error){
      failures.push({provider_id:route.provider_id,account_id:route.account_id,model_id:route.model_id,error:String(error instanceof Error?error.message:error)});
    }
  }

  const error:any=new Error("conversation_all_routes_failed");
  error.failures=failures;
  throw error;
}

async function missionForUser(missionId: string, userId: string) { const x = await internal(`${DIRECT}/missions/get`, { mission_id: missionId, user_id: userId, "x-aria-user-id": userId }); if (!x.r.ok) return null; const mission = x.b?.mission ?? x.b?.data?.mission ?? null; const owner = mission?.metadata?.user_id ?? mission?.metadata?.owner_user_id ?? null; return owner && owner !== userId ? null : mission; }
async function meditationStatus(userId: string) { const { data, error } = await serviceClient().schema("aria_internal").from("meditation_control").select("controller_id,owner_user_id,desired_mode,session_id,revision,last_command,last_command_at,last_cloud_tick_at,last_cloud_status,metadata,created_at,updated_at").eq("controller_id", "primary").maybeSingle(); if (error) throw new Error(error.message); if (data?.owner_user_id && data.owner_user_id !== userId) return { owned: false, desired_mode: "stopped", controller_id: "primary" }; return { owned: Boolean(data?.owner_user_id), controller: data }; }
async function meditationControl(userId: string, action: string) { const mode = action === "activate" || action === "start" ? "active" : action === "pause" || action === "paused" ? "paused" : action === "stop" || action === "stopped" ? "stopped" : ""; if (!mode) throw Object.assign(new Error("action_required"), { status: 400 }); const sb = serviceClient(); const { data: current, error: ce } = await sb.schema("aria_internal").from("meditation_control").select("*").eq("controller_id", "primary").maybeSingle(); if (ce) throw new Error(ce.message); if (current?.owner_user_id && current.owner_user_id !== userId) throw Object.assign(new Error("meditation_control_owned_by_another_user"), { status: 403 }); const next = { controller_id: "primary", owner_user_id: current?.owner_user_id || userId, desired_mode: mode, session_id: mode === "active" ? `med-${Date.now()}-${crypto.randomUUID().slice(0, 8)}` : (current?.session_id || null), revision: Number(current?.revision || 0) + 1, last_command: mode, last_command_at: new Date().toISOString(), updated_at: new Date().toISOString() }; const { data, error } = await sb.schema("aria_internal").from("meditation_control").upsert(next, { onConflict: "controller_id" }).select("*").single(); if (error) throw new Error(error.message); return data; }
const terminal = new Set(["succeeded", "failed", "blocked", "cancelled"]);
const weightOf = (step:any) => { const explicit=Number(step?.weight); if(Number.isFinite(explicit)&&explicit>0)return explicit; const risk=String(step?.risk??"READ").toUpperCase(); const base=risk==="DESTRUCTIVE"?3:risk==="HIGH_RISK_WRITE"?2.2:risk==="LOW_RISK_WRITE"?1.4:1; const type=String(step?.executor_type||step?.target?.type||"").toLowerCase(); return base*((type==="device"||type==="self_improvement")?1.25:type==="agent"?1.15:1); };
const reasonType = (m:any) => { const raw=[m?.next_action,m?.last_stderr,m?.checkpoint?.recovery?.status,m?.checkpoint?.human_gate?.original_risk].filter(Boolean).join(" ").toLowerCase(); if(/credential|token|secret|auth|login|api key/.test(raw))return"credential"; if(/payment|billing|subscription|plan/.test(raw))return"payment"; if(/human_gate|approval|approve|authorize|permission/.test(raw))return"approval"; if(/device|windows|offline|agent/.test(raw))return"device"; return"execution"; };
function rows(m:any){ const plan=Array.isArray(m?.checkpoint?.plan)?m.checkpoint.plan:[]; const done=new Set((Array.isArray(m?.checkpoint?.completed_steps)?m.checkpoint.completed_steps:[]).map(String)); const results=m?.checkpoint?.results&&typeof m.checkpoint.results==="object"?m.checkpoint.results:{}; const rec=m?.checkpoint?.recovery&&typeof m.checkpoint.recovery==="object"?m.checkpoint.recovery:{}; const failed=Array.isArray(rec.failed_step_ids)?rec.failed_step_ids.map(String):[]; return plan.map((s:any,i:number)=>{const id=String(s?.id??`step_${i+1}`);let st=done.has(id)?"succeeded":"pending"; if(!done.has(id)&&m?.status==="blocked"&&failed.includes(id))st="blocked"; if(!done.has(id)&&m?.status==="paused"&&rec.status==="waiting_for_async_executor")st=m?.checkpoint?.pending_jobs?.[id]?"waiting":"pending"; if(!done.has(id)&&m?.status==="running"&&Number(m?.current_step??0)===i)st="running"; if(!done.has(id)&&results[id]?.status==="failed")st="failed"; return {index:i+1,id,title:String(s?.title??s?.operation??`Paso ${i+1}`),status:st,risk:String(s?.risk??"READ"),executor_type:String(s?.executor_type||s?.target?.type||""),operation:String(s?.operation??""),depends_on:Array.isArray(s?.depends_on)?s.depends_on.map(String):[],weight:Number(weightOf(s).toFixed(3)),timeout_ms:Number.isFinite(Number(s?.timeout_ms))?Number(s.timeout_ms):null,result:results[id]??null};}); }
async function etaFor(sb:any, steps:any[]){const rem=steps.filter(s=>!['succeeded','skipped'].includes(s.status));if(!rem.length)return{eta_seconds:0,basis:"complete",samples:0};const ops=[...new Set(rem.map(s=>s.operation).filter(Boolean))];let hist:number[]=[];if(ops.length){const {data}=await sb.schema("aria_internal").from("mission_steps").select("operation,started_at,completed_at").in("operation",ops).not("started_at","is",null).not("completed_at","is",null).order("completed_at",{ascending:false}).limit(120);hist=(data??[]).map((r:any)=>{const a=Date.parse(r.started_at),b=Date.parse(r.completed_at),d=(Number.isFinite(a)&&Number.isFinite(b))?(b-a)/1000:NaN;return Number.isFinite(d)&&d>0&&d<86400?d:NaN}).filter(Number.isFinite);}const med=hist.length?[...hist].sort((a,b)=>a-b)[Math.floor(hist.length/2)]:null;const estimate=(s:any)=>{const t=Number(s.timeout_ms);if(Number.isFinite(t)&&t>0)return Math.max(5,Math.min(900,t/1000*.35));return String(s.executor_type).toLowerCase()==="device"?30:12;};const sec=rem.reduce((sum,s)=>sum+(Number(med??estimate(s))*s.weight),0);return{eta_seconds:Math.max(0,Math.round(sec)),basis:hist.length?"historical_operation_median":"step_estimate",samples:hist.length};}
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
async function meditationOverview(userId:string){const sb=serviceClient();const {data:controller,error:ce}=await sb.schema("aria_internal").from("meditation_control").select("controller_id,owner_user_id,desired_mode,session_id,revision,last_command,last_command_at,last_cloud_tick_at,last_cloud_status,metadata,created_at,updated_at").eq("controller_id","primary").maybeSingle();if(ce)throw new Error(ce.message);if(controller?.owner_user_id&&controller.owner_user_id!==userId)return{version:"aria-meditation-dashboard-v1",mode:"stopped",controller:null,active_mission:null,missions:[],human_gates:[],blocked:[],counts:{missions:0,human_gates:0,blocked:0}};const {data:all,error:me}=await sb.schema("aria_internal").from("mission_state").select("mission_id,goal,status,current_step,total_steps,completed_steps,next_action,last_stdout,last_stderr,finished_at,checkpoint,metadata,created_at,updated_at").order("updated_at",{ascending:false}).limit(100);if(me)throw new Error(me.message);const owned=(all??[]).filter((m:any)=>{const md=m?.metadata&&typeof m.metadata==="object"?m.metadata:{};return md.user_id===userId||md.owner_user_id===userId||(controller?.session_id&&md.meditation_session_id===controller.session_id)});const missions=await Promise.all(owned.slice(0,30).map(async(m:any)=>{const steps=rows(m),tw=steps.reduce((a,s)=>a+s.weight,0),dw=steps.filter(s=>s.status==='succeeded'||s.status==='skipped').reduce((a,s)=>a+s.weight,0),progress=tw?Math.max(0,Math.min(100,Math.round(dw/tw*1000)/10)):(m.total_steps?Math.round((m.completed_steps||0)/m.total_steps*1000)/10:0),eta=await etaFor(sb,steps);return{...m,progress_percent:progress,step_count:steps.length,steps,eta,terminal:terminal.has(String(m.status))};}));const active=missions.find(m=>['running','queued','planning','paused','waiting'].includes(String(m.status)))??null;const byId=new Map(missions.map(m=>[m.mission_id,m]));const {data:ev,error:ee}=await sb.schema("aria_internal").from("mission_events").select("mission_id,step_index,event_type,payload,created_at").in("event_type",["human_gate_requested","self_improvement_human_gate"]).order("created_at",{ascending:false}).limit(100);if(ee)throw new Error(ee.message);const gates:any[]=[];for(const e of ev??[]){const m=byId.get(String(e.mission_id));if(!m||terminal.has(String(m.status)))continue;const p=e.payload&&typeof e.payload==='object'?e.payload:{};const step=m.steps.find((s:any)=>s.id===String(p.step_id??''))??null;gates.push({id:`${e.mission_id}:${e.created_at}`,mission_id:e.mission_id,step_id:p.step_id??null,event_type:e.event_type,reason:p.stop_reason??"human_gate_required",risk:step?.risk??m.metadata?.human_gate_required?.[0]??"HIGH_RISK_WRITE",mission_goal:m.goal,operation:step?.operation??null,target:step?{executor_type:step.executor_type,operation:step.operation}:null,instructions:[`Revisa la misión: ${m.goal}`,`Confirma el paso ${step?.index??p.step_id??"pendiente"} y su operación ${step?.operation??"indicada por el gate"}.`,`Verifica el riesgo declarado (${step?.risk??"HIGH_RISK_WRITE"}) y el objetivo antes de aprobar.`,`Usa el control Human Gate de ARIA para aprobar o rechazar la continuación.`],source:e.created_at});}for(const m of missions.filter(x=>!terminal.has(String(x.status)))){const req=m?.metadata?.human_gate_required;if(!Array.isArray(req)||!req.length||gates.some(g=>g.mission_id===m.mission_id))continue;gates.push({id:`${m.mission_id}:policy`,mission_id:m.mission_id,step_id:null,event_type:"policy_gate",reason:"human_gate_required",risk:String(req[0]),mission_goal:m.goal,operation:null,target:null,instructions:["Revisa la misión y el cambio propuesto.",`Confirma la categoría de riesgo: ${String(req[0])}.`,"Aprueba o rechaza la continuación desde Human Gate de ARIA."],source:m.updated_at});}const blocked=missions.filter(m=>String(m.status)==="blocked").map(m=>({mission_id:m.mission_id,goal:m.goal,status:m.status,reason_type:reasonType(m),reason:m.last_stderr||m.next_action||m.checkpoint?.recovery?.status||"La misión quedó bloqueada.",next_action:m.next_action,step:m.steps.find((s:any)=>['blocked','failed','running'].includes(s.status))??null,instructions:["Revisa el motivo indicado.",m.next_action?`Siguiente acción: ${m.next_action}`:"Determina qué recurso o autorización falta.","Corrige el bloqueo y vuelve a ejecutar la misión desde el checkpoint."],updated_at:m.updated_at}));return{version:"aria-meditation-dashboard-v1",mode:String(controller?.desired_mode??"stopped"),controller,active_mission:active,missions,human_gates:gates.slice(0,30),blocked:blocked.slice(0,30),counts:{missions:missions.length,human_gates:gates.length,blocked:blocked.length}};}

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
    if (req.method === "GET" && path.endsWith("/meditation/status")) return json({ ok: true, ...await meditationStatus(user.id), trace_id: trace });
    if (req.method === "POST" && path.endsWith("/meditation/control")) { const body = await req.json().catch(() => null); const controller = await meditationControl(user.id, String(body?.action || "").toLowerCase()); return json({ ok: true, controller, trace_id: trace }); }
    if (req.method === "GET" && path.endsWith("/meditation/overview")) return json({ ok: true, ...(await meditationOverview(user.id)), trace_id: trace });
    if (req.method === "GET" && path.endsWith("/meditation/notifications")) { const url = new URL(req.url); const unreadOnly = url.searchParams.get("unread_only") === "true"; const limit = Number(url.searchParams.get("limit") || 50); return json({ ok: true, ...(await meditationNotificationsForUser(user.id, unreadOnly, limit)), trace_id: trace }); }
    if (req.method === "POST" && path.endsWith("/meditation/notifications/read")) { const body = await req.json().catch(() => null); return json({ ...await markMeditationNotificationsReadForUser(user.id, body), trace_id: trace }); }
    if (req.method === "POST" && path.endsWith("/media/upload-url")) { const body = await req.json().catch(() => null); const fileName = typeof body?.fileName === "string" && body.fileName.trim() ? body.fileName.trim().replace(/[^A-Za-z0-9._-]/g, "_") : "upload.bin"; const objectPath=`${user.id}/${crypto.randomUUID()}/${fileName}`; const { data, error } = await serviceClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(objectPath); if (error || !data?.signedUrl) return json({ error: "media_upload_url_failed", stage: "media", trace_id: trace }, 502); return json({ ok: true, bucket: MEDIA_BUCKET, path: objectPath, signedUrl: data.signedUrl, trace_id: trace }); }
    if (req.method === "POST" && path.endsWith("/conversation")) { const body = await req.json().catch(() => null); const parts = Array.isArray(body?.parts) ? body.parts : []; const text = parts.filter((p:any)=>p?.type==="text").map((p:any)=>String(p.text??"").trim()).filter(Boolean).join("\n"); if (!text) return json({ error: "text_or_attachment_required", stage: "input", trace_id: trace }, 400); const conversationId = typeof body?.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : crypto.randomUUID(); const memory = await recall(text,user.id); let step: any; try { step = await plan(text, { version: "cognitive-loop-v2", user_id: user.id, memory: memory.slice(0, 6), memory_available: memory.length > 0 }); } catch (e) { return json({ error: "conversation_planner_failed", stage: "planner", detail: String((e as any)?.message ?? e), trace_id: trace }, 503); } const context = memory.slice(0, 6).map((m:any)=>String(m?.content??"").trim()).filter(Boolean).join("\n\n"); const prompt = ["Eres ARIA. Responde directamente al usuario.","No inventes acciones ejecutadas.",context ? "Memoria contextual autorizada:\n" + context : "","Usuario: " + text].filter(Boolean).join("\n\n"); try { const execution = await executeConversationWithFallback(step, prompt, conversationId); const result=execution.result; const content = typeof result?.response?.content === "string" ? result.response.content.trim() : ""; if (!content) throw new Error("empty_conversation_response"); return json({ ok: true, conversationId, visualState: "success", parts: [{ type: "text", text: content }], cognitive: { recall_count: memory.length, provider_id: execution.route.provider_id, model_id: execution.route.model_id, fallback_count: execution.fallback_count }, trace_id: trace }); } catch (e) { return json({ error: "conversation_model_execution_failed", stage: "model_execution", detail: String((e as any)?.message ?? e), fallback_attempts: Array.isArray((e as any)?.failures) ? (e as any).failures.map((x:any)=>({provider_id:x.provider_id,model_id:x.model_id,error:x.error})) : [], trace_id: trace }, 502); } }
    if (req.method === "POST" && path.endsWith("/missions")) { const body = await req.json().catch(() => null); const goal = typeof body?.goal === "string" ? body.goal.trim() : ""; if (!goal) return json({ error: "goal_required", stage: "input", trace_id: trace }, 400); const direct = await internal(DIRECT, { goal, mission_id: typeof body?.missionId === "string" ? body.missionId : undefined, metadata: { source_application: "aria-app-v1", user_id: user.id, goal_source: "user" }, "x-aria-user-id": user.id }); if (!direct.r.ok) return json({ error: direct.b?.error ?? "aria_direct_failed", trace_id: trace }, direct.r.status); return json({ ok: true, ...direct.b, trace_id: trace }); }
    if (req.method === "GET" && path.includes("/missions/") && path.endsWith("/events")) {
      const missionId=decodeURIComponent(path.split("/missions/")[1].replace(/\/events$/,""));
      const mission=await missionForUser(missionId,user.id);
      if(!mission) return json({error:"mission_not_found",trace_id:trace},404);
      const {data,error}=await serviceClient().schema("aria_internal").from("mission_events").select("event_id,mission_id,step_index,event_type,payload,created_at").eq("mission_id",missionId).order("created_at",{ascending:true}).limit(200);
      if(error) return json({error:"mission_events_failed",detail:error.message,trace_id:trace},502);
      return json({ok:true,events:data??[],trace_id:trace});
    }
    if (req.method === "GET" && path.includes("/missions/")) { const missionId = decodeURIComponent(path.split("/missions/")[1]); const mission = await missionForUser(missionId, user.id); if (!mission) return json({ error: "mission_not_found", trace_id: trace }, 404); return json({ mission, trace_id: trace }); }
    if (req.method === "POST" && path.endsWith("/memory/search")) { const body = await req.json().catch(() => null); const text = typeof body?.query === "string" ? body.query.trim() : ""; if (!text) return json({ error: "query_required", stage: "input", trace_id: trace }, 400); const results = await recall(text, user.id); return json({ ok: true, query: text, result_count: results.length, results, scope: "user", trace_id: trace }); }
    return json({ error: "not_found", stage: "routing", trace_id: trace }, 404);
  } catch (e) { return json({ error: "internal_error", stage: "gateway", detail: String((e as any)?.message ?? e), trace_id: trace }, 500); }
});
