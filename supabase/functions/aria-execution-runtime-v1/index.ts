import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { m22Gate3HumanGateActionHash, m22Gate3RouteAllowed, m22MissionWonder2ScopedProbeAllowed } from "../_shared/mission-wonder-2-gate3-scope-v1.mjs";
import { parseOpenRouterFreeDailyQuota, extractProviderUsage, parseQuotaReservation } from "./quota-accounting-v1.mjs";
import { isCloudflarePlanPreviewRequest } from "../_shared/cloudflare-plan-preview-auth-v1.mjs";
const MISSION_EXECUTION_PAUSED = true;
const URL=Deno.env.get("SUPABASE_URL")!;const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")??"";const GOOGLE_API_KEY=Deno.env.get("GOOGLE_API_KEY")??"";
const sb=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const bearer=(r:Request)=>{const h=r.headers.get("authorization")??"";return h.startsWith("Bearer ")?h.slice(7):null};
const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};
async function auth(r:Request){const b=bearer(r);if(b&&SECRET&&eq(b,SECRET))return true;const t=r.headers.get("x-aria-autonomy-token");if(!t)return false;const {data,error}=await sb.rpc("aria_autonomy_cron_authorize",{p_token:t});return !error&&data===true}
async function secret(name:string){const {data,error}=await sb.rpc("read_aria_credential_secret",{p_name:name});if(error||typeof data!=="string"||!data)return null;return data}
const sanitize=(m:unknown)=>String(m??"error").replace(/Bearer\s+[A-Za-z0-9._-]+/g,"[redacted]").replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,"[redacted]").replace(/AIza[A-Za-z0-9_-]{20,}/g,"[redacted]").replace(/\bor-v1-[A-Za-z0-9_-]{8,}\b/g,"[redacted]").replace(/\bxai-[A-Za-z0-9_-]{8,}\b/g,"[redacted]");
async function reserveModelQuota(route:any, requestId:string, suppliedOpenRouterKey:string|null=null, quotaSnapshotTimeoutMs=8000) {
  const reservationKey=String(requestId||"").trim();
  if(!reservationKey||reservationKey.length>240) return {allowed:false,reason:"quota_reservation_identity_missing"};
  let providerUsed:number|null=null;
  let providerLimit:number|null=null;
  let providerSecret=suppliedOpenRouterKey;

  if(route?.provider_id==="openrouter"&&String(route?.model_id||"").endsWith(":free")){
    if(route?.account_id!=="acct_openrouter_primary") return {allowed:false,reason:"openrouter_free_account_not_allowlisted"};
    if(!providerSecret) providerSecret=await secret("aria_openrouter_primary");
    if(!providerSecret) return {allowed:false,reason:"provider_credential_unavailable"};
    let snapshot:Response;
    try {
      snapshot=await fetch("https://openrouter.ai/api/v1/key",{
        method:"GET",
        headers:{Authorization:`Bearer ${providerSecret}`},
        signal:AbortSignal.timeout(Math.max(1000,Math.min(8000,Number(quotaSnapshotTimeoutMs)||8000))),
      });
    } catch {
      return {allowed:false,reason:"provider_quota_snapshot_unavailable"};
    }
    if(!snapshot.ok) return {allowed:false,reason:"provider_quota_snapshot_http_"+snapshot.status};
    const snapshotBody=await snapshot.json().catch(()=>null);
    const daily=parseOpenRouterFreeDailyQuota(snapshotBody);
    if(!daily) return {allowed:false,reason:"provider_free_daily_quota_unverified"};
    providerUsed=daily.used;
    providerLimit=daily.limit;
  }

  const {data,error}=await sb.schema("aria_internal").rpc("quota_reserve_model_request_v1",{
    p_reservation_key:reservationKey,
    p_provider_id:String(route?.provider_id||""),
    p_account_id:String(route?.account_id||""),
    p_model_id:String(route?.model_id||""),
    p_provider_used:providerUsed,
    p_provider_limit:providerLimit,
  });
  if(error) return {allowed:false,reason:"quota_reservation_database_error"};
  const parsed=parseQuotaReservation(data);
  if(!parsed.allowed) return parsed;
  return {allowed:true,reservation_key:parsed.reservation_key,provider_secret:providerSecret};
}

async function settleModelQuota(reservationKey:string,outcome:string,providerStatus:number|null,payload:any,providerResponseId:string|null=null) {
  if(!reservationKey) return false;
  const usage=extractProviderUsage(payload);
  const {data,error}=await sb.schema("aria_internal").rpc("quota_settle_model_request_v1",{
    p_reservation_key:reservationKey,
    p_outcome:outcome,
    p_provider_status:providerStatus,
    p_prompt_tokens:usage.prompt_tokens,
    p_completion_tokens:usage.completion_tokens,
    p_total_tokens:usage.total_tokens,
    p_provider_response_id:providerResponseId,
  });
  return !error&&data?.settled===true;
}

async function directGemini(route:any,input:any,requestId:string,providerTimeoutMs:number|null=null){
  if(route.capability!=="text_generation")return out({status:"blocked",reason:"capability_missing"});
  if(route.account_id!=="acct_google_gemini_free")return out({status:"blocked",reason:"route_not_selectable"});
  const googleModels:Record<string,string>={
    // Only routes present in the LIVE agent/resource registry and backed by
    // verified capability evidence. Keep the public ARIA route id mapped to
    // the concrete Google Generative Language model id.
    "google/gemini-3.5-flash-lite-direct":"gemini-3.5-flash-lite",
    "google/gemini-3.5-flash-direct":"gemini-3.5-flash",
    "google/gemini-3.1-flash-lite-direct":"gemini-3.1-flash-lite"
  };
  const model=googleModels[route.model_id];
  if(!model)return out({status:"blocked",reason:"model_not_verified"});
  if(!GOOGLE_API_KEY)return out({status:"failed",error:{code:"credential_unavailable",message:"google credential unavailable"}});
  const p=input?.payload??{};const contents=Array.isArray(p.contents)&&p.contents.length?p.contents:(typeof p.prompt==="string"&&p.prompt.length?[{role:"user",parts:[{text:p.prompt}]}]:null);
  if(!contents)return out({status:"blocked",reason:"input_missing"});
  const reservation=await reserveModelQuota(route,requestId,null,providerTimeoutMs?Math.min(3000,providerTimeoutMs):8000);
  if(!reservation.allowed)return out({status:"blocked",reason:reservation.reason},reservation.reason.includes("exhausted")?429:503);
  const reservationKey=reservation.reservation_key;
  const body:any={contents};if(p.systemInstruction)body.systemInstruction=p.systemInstruction;if(p.generationConfig)body.generationConfig={...p.generationConfig};
  if(body.generationConfig?.temperature!==undefined){const {temperature,...rest}=body.generationConfig;body.generationConfig=rest;}
  if(body.generationConfig?.topP!==undefined){const {topP,...rest}=body.generationConfig;body.generationConfig=rest;}
  if(body.generationConfig?.topK!==undefined){const {topK,...rest}=body.generationConfig;body.generationConfig=rest;}
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),providerTimeoutMs??20000);
  let res:Response;let json:any=null;
  try{
    res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":GOOGLE_API_KEY},body:JSON.stringify(body),signal:controller.signal});
    json=await res.json().catch((error:any)=>{if(error?.name==="AbortError")throw error;return null;});
  }catch(error){
    await settleModelQuota(reservationKey,"unknown",null,null);
    const timedOut=error instanceof Error&&error.name==="AbortError";
    return out({status:"failed",error:{code:timedOut?"transport_timeout":"transport_error",message:timedOut?"provider request timed out":"transport failure"}});
  }finally{clearTimeout(timeout)}if(!res.ok){await settleModelQuota(reservationKey,"failed",res.status,json);return out({status:"failed",error:{code:"provider_error",message:sanitize(json?.error?.message||`provider returned HTTP ${res.status}`),provider_status:res.status}});}
  const parts=json?.candidates?.[0]?.content?.parts;const text=Array.isArray(parts)?parts.filter((x:any)=>typeof x?.text==="string").map((x:any)=>x.text).join(""):"";
  if(!text){await settleModelQuota(reservationKey,"failed",res.status,json);return out({status:"failed",error:{code:"invalid_response",message:"no text content in provider response"}});}
  const settled=await settleModelQuota(reservationKey,"succeeded",res.status,json);
  return out({status:"succeeded",response:{modality:"text",content:text,provider_response_id:null,finish_reason:json?.candidates?.[0]?.content?.finishReason??json?.candidates?.[0]?.finishReason??null,provider_model:route.model_id},usage:json?.usageMetadata?{status:"known",prompt_tokens:json.usageMetadata.promptTokenCount??null,completion_tokens:json.usageMetadata.candidatesTokenCount??null,total_tokens:json.usageMetadata.totalTokenCount??null}:{status:"unknown"},metadata:{runtime:"aria-execution-runtime-v1",adapter_id:"google_gemini_generate_content",provider_id:"google",route_type:"direct",attempt:1,quota_accounting:settled?"settled":"reserved_settlement_pending",canonical_write:false,memory_authority:"none"}});
}
async function xaiResponses(route:any,input:any,requestId:string,providerTimeoutMs:number|null=null){
  if(route.capability!=="text_generation")return out({status:"blocked",reason:"capability_missing"});
  if(route.account_id!=="acct_xai_primary")return out({status:"blocked",reason:"route_not_selectable"});
  if(route.model_id!=="xai/grok-4.6")return out({status:"blocked",reason:"model_not_verified"});
  const sec=await secret("xai/acct_xai_primary");
  if(!sec)return out({status:"failed",error:{code:"credential_unavailable",message:"xai credential unavailable"}});
  const p=input?.payload??{};
  let reqInput:any=null;
  if(Array.isArray(p.input)&&p.input.length)reqInput=p.input;
  else if(Array.isArray(p.messages)&&p.messages.length)reqInput=p.messages.map((m:any)=>({role:typeof m?.role==="string"?m.role:"user",content:typeof m?.content==="string"?m.content:""}));
  else if(typeof p.prompt==="string"&&p.prompt.length)reqInput=[{role:"user",content:p.prompt}];
  else if(typeof p.input==="string"&&p.input.length)reqInput=p.input;
  if(reqInput===null)return out({status:"blocked",reason:"input_missing"});
  const body:any={model:"grok-4.6",input:reqInput};
  if(typeof p.temperature==="number")body.temperature=p.temperature;
  if(typeof p.max_tokens==="number")body.max_output_tokens=p.max_tokens;
  if(typeof p.max_output_tokens==="number")body.max_output_tokens=p.max_output_tokens;
  if(Array.isArray(p.tools)&&p.tools.length){
    const tools=p.tools.filter((t:any)=>t&&typeof t==="object"&&t.type==="mcp"&&typeof t.server_url==="string"&&t.server_url.trim()).map((t:any)=>{
      const e:any={type:"mcp",server_url:t.server_url.trim()};
      if(typeof t.server_label==="string"&&t.server_label.trim())e.server_label=t.server_label.trim();
      if(typeof t.authorization==="string"&&t.authorization.trim())e.authorization=t.authorization.trim();
      if(t.headers&&typeof t.headers==="object"&&!Array.isArray(t.headers))e.headers={...t.headers};
      if(Array.isArray(t.allowed_tools)&&t.allowed_tools.length)e.allowed_tools=t.allowed_tools.filter((n:any)=>typeof n==="string");
      return e;
    });
    if(tools.length)body.tools=tools;
  }
  const reservation=await reserveModelQuota(route,requestId,null,providerTimeoutMs?Math.min(3000,providerTimeoutMs):8000);
  if(!reservation.allowed)return out({status:"blocked",reason:reservation.reason},reservation.reason.includes("exhausted")?429:503);
  const reservationKey=reservation.reservation_key;
  let res:Response;
  const controller=providerTimeoutMs?new AbortController():null;
  const timeout=controller?setTimeout(()=>controller.abort(),providerTimeoutMs):null;
  let json:any=null;
  try{
    res=await fetch("https://api.x.ai/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${sec}`,"Content-Type":"application/json"},body:JSON.stringify(body),...(controller?{signal:controller.signal}:{})});
    json=await res.json().catch((error:any)=>{if(error?.name==="AbortError")throw error;return null;});
  }catch(error){
    await settleModelQuota(reservationKey,"unknown",null,null);
    const timedOut=controller&&(error as any)?.name==="AbortError";
    return out({status:"failed",error:{code:timedOut?"transport_timeout":"transport_error",message:timedOut?"provider request timed out":"transport failure"}});
  }finally{
    if(timeout)clearTimeout(timeout);
  }if(!res.ok){await settleModelQuota(reservationKey,"failed",res.status,json);return out({status:"failed",error:{code:"provider_error",message:sanitize(json?.error?.message||`provider returned HTTP ${res.status}`),provider_status:res.status}});}
  const parts=Array.isArray(json?.output)?json.output:[];const text=parts.flatMap((item:any)=>item?.type==="message"&&Array.isArray(item?.content)?item.content:[]).filter((c:any)=>typeof c?.text==="string").map((c:any)=>c.text).join("")|| (typeof json?.output_text==="string"?json.output_text:"");
  if(!text){await settleModelQuota(reservationKey,"failed",res.status,json);return out({status:"failed",error:{code:"invalid_response",message:"no text content in provider response"}});}
  const u=json?.usage;const inTok=typeof u?.input_tokens==="number"?u.input_tokens:null;const outTok=typeof u?.output_tokens==="number"?u.output_tokens:null;const total=typeof u?.total_tokens==="number"?u.total_tokens:(inTok!==null&&outTok!==null?inTok+outTok:null);
  const settled=await settleModelQuota(reservationKey,"succeeded",res.status,json,typeof json?.id==="string"?json.id:null);
  return out({status:"succeeded",response:{modality:"text",content:text,provider_response_id:typeof json?.id==="string"?json.id:null,finish_reason:typeof json?.status==="string"?json.status:null,provider_model:typeof json?.model==="string"?json.model:route.model_id},usage:{status:"reported",prompt_tokens:inTok,completion_tokens:outTok,total_tokens:total},metadata:{runtime:"aria-execution-runtime-v1",adapter_id:"xai_responses",provider_id:"xai",route_type:"direct",attempt:1,quota_accounting:settled?"settled":"reserved_settlement_pending",canonical_write:false,memory_authority:"none"}});
}
Deno.serve(async r=>{if(r.method!=="POST")return out({error:"method_not_allowed"},405);if(!(await auth(r)))return out({error:"unauthorized"},401);const body=await r.json().catch(()=>({}));const route=body?.selected_route;const input=body?.input;const az=body?.authorization;const policy=body?.policy;const rawVoiceTimeout=Number(body?.metadata?.voice_provider_timeout_ms);const voiceProviderTimeoutMs=body?.metadata?.voice_mode===true?Math.max(1000,Math.min(8000,Number.isFinite(rawVoiceTimeout)&&rawVoiceTimeout>0?rawVoiceTimeout:6000)):null;
const conversationOnlyAllowed=
  body?.metadata?.conversation_only===true&&
  body?.metadata?.source_application==="aria-app-v1"&&
  body?.metadata?.executor_type==="model"&&
  typeof body?.metadata?.conversation_id==="string"&&
  body?.metadata?.conversation_id.length>0&&
  body?.execution_version==="1"&&
  body?.task_id==="conversation:"+body?.metadata?.conversation_id&&
  !body?.metadata?.mission_id&&!body?.metadata?.step_id&&!body?.metadata?.job_id&&
  body?.capability==="text_generation"&&route?.capability==="text_generation"&&
  body?.policy?.conversation_only===true&&
  ["google","xai","openrouter"].includes(String(route?.provider_id||""))&&
  body?.authorization?.status==="approved"&&
  body?.authorization?.risk_class==="READ"&&
  body?.authorization?.evidence_ref==="aria-app-conversation-v1"&&
  !Array.isArray(input?.payload?.tools)&&
  (typeof input?.payload?.prompt==="string"&&input.payload.prompt.length<=12000||
   Array.isArray(input?.payload?.contents)&&input.payload.contents.length<=3&&
   input.payload.contents.every((item:any)=>item?.role==="user"&&Array.isArray(item?.parts)&&item.parts.length<=3));
let gate3ScopedProbeAllowed=false;
let cloudflarePlanPreviewAllowed=false;
if(MISSION_EXECUTION_PAUSED){
  const missionId=String(body?.metadata?.mission_id||"");
  const stepId=String(body?.metadata?.step_id||"");
  if(missionId&&stepId&&policy?.mission_wonder_2_gate3_probe===true&&policy?.human_gate_required===true&&az?.human_gate_verified===true&&m22Gate3RouteAllowed(route)){
    try{
      const {data:probeMission,error:probeError}=await sb.schema("aria_internal").from("mission_state").select("mission_id,status,checkpoint,metadata").eq("mission_id",missionId).maybeSingle();
      const probeStep=Array.isArray(probeMission?.checkpoint?.plan)?probeMission.checkpoint.plan.find((candidate:any)=>String(candidate?.id||"")===stepId):null;
      const probeHash=probeStep?await m22Gate3HumanGateActionHash(probeStep):"";
      gate3ScopedProbeAllowed=!probeError&&m22MissionWonder2ScopedProbeAllowed(probeMission,probeStep,probeHash);
    }catch{
      gate3ScopedProbeAllowed=false;
    }
  }

  // One narrowly scoped, read-only model call is allowed to produce a plan.
  // It cannot create missions/jobs, dispatch tools, access devices or perform
  // workspace mutations. All ordinary model execution remains frozen.
  try{
    const prompt=String(body?.input?.payload?.prompt||"");
    const requestId=String(body?.request_id||"");
    cloudflarePlanPreviewAllowed=
      await isCloudflarePlanPreviewRequest(r,SECRET) &&
      body?.execution_version==="1" &&
      requestId.startsWith("aria-cloudflare-plan-preview-v1:") &&
      body?.task_id==="cloudflare_workspace_plan_preview" &&
      body?.metadata?.purpose==="aria-cloudflare-plan-preview-v1" &&
      policy?.aria_cloudflare_plan_preview===true &&
      policy?.read_only===true &&
      policy?.tool_use===false &&
      az?.status==="approved" &&
      az?.risk_class==="READ" &&
      az?.evidence_ref==="aria-cloudflare-plan-preview-v1" &&
      route?.provider_id==="openrouter" &&
      route?.account_id==="acct_openrouter_primary" &&
      route?.model_id==="nvidia/nemotron-3.5-lightning:free" &&
      route?.capability==="text_generation" &&
      prompt.length>=20 &&
      prompt.length<=16000 &&
      Number(body?.input?.payload?.max_tokens||0)>0 &&
      Number(body?.input?.payload?.max_tokens||0)<=700 &&
      Number(body?.input?.payload?.temperature)===0 &&
      !Array.isArray(body?.input?.payload?.tools) &&
      !body?.metadata?.mission_id &&
      !body?.metadata?.step_id;
  }catch{
    cloudflarePlanPreviewAllowed=false;
  }
  if(!gate3ScopedProbeAllowed&&!cloudflarePlanPreviewAllowed&&!conversationOnlyAllowed){
    return out({status:"paused",error:{code:"mission_execution_paused"},execution_enabled:false},423);
  }
}if(!route||typeof route!=="object")return out({status:"blocked",reason:"route_missing"});if(!az||az.status!=="approved")return out({status:"blocked",reason:"authorization_not_approved"});if(policy?.human_gate_required===true){if(az.human_gate_verified!==true)return out({status:"blocked",reason:"human_gate_required"});if(typeof az.human_gate_mission_id!=="string"||typeof az.human_gate_step_id!=="string"||typeof az.human_gate_action_hash!=="string"||typeof az.human_gate_approval_token!=="string")return out({status:"blocked",reason:"human_gate_evidence_missing"});const {data:gateOk,error:gateError}=await sb.rpc("human_gate_authorize_execution",{p_mission_id:az.human_gate_mission_id,p_step_id:az.human_gate_step_id,p_action_hash:az.human_gate_action_hash,p_approval_token:az.human_gate_approval_token});if(gateError||gateOk!==true)return out({status:"blocked",reason:"human_gate_authorization_invalid"});}
// LIVE resilience fault injection: auth already required; gated by evidence_ref prefix only.
// Produces the SAME error shapes as real upstream failures so recovery paths can be exercised end-to-end.
const _fault=body?.metadata?.fault_injection;const _eref=String(az?.evidence_ref||"");
if(typeof _fault==="string"&&_eref.startsWith("live-resilience-inject:")){
  if(_fault==="timeout")return out({status:"failed",error:{code:"transport_timeout",message:"provider request timed out",injected:true},metadata:{runtime:"aria-execution-runtime-v1",fault_injection:"timeout"}});
  if(_fault==="http_429")return out({status:"failed",error:{code:"provider_error",message:"provider returned HTTP 429",provider_status:429,injected:true},metadata:{runtime:"aria-execution-runtime-v1",fault_injection:"http_429"}});
  if(_fault==="http_503")return out({status:"failed",error:{code:"provider_error",message:"provider returned HTTP 503",provider_status:503,injected:true},metadata:{runtime:"aria-execution-runtime-v1",fault_injection:"http_503"}});
  if(_fault==="http_500")return out({status:"failed",error:{code:"provider_error",message:"provider returned HTTP 500",provider_status:500,injected:true},metadata:{runtime:"aria-execution-runtime-v1",fault_injection:"http_500"}});
  if(_fault==="invalid_response")return out({status:"failed",error:{code:"invalid_response",message:"no text content in provider response",injected:true},metadata:{runtime:"aria-execution-runtime-v1",fault_injection:"invalid_response"}});
  if(_fault==="partial_empty")return out({status:"failed",error:{code:"invalid_response",message:"no text content in provider response",injected:true,partial:true},metadata:{runtime:"aria-execution-runtime-v1",fault_injection:"partial_empty"}});
}
async function openRouterChat(route:any,input:any,requestId:string,providerTimeoutMs:number|null=null){
  if(route.capability!=="text_generation")return out({status:"blocked",reason:"capability_missing"});
  if(route.account_id!=="acct_openrouter_primary")return out({status:"blocked",reason:"route_not_selectable"});
  const freeOpenRouterModels=new Set([
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "poolside/laguna-s-2.1:free",
    "inclusionai/ling-3.0-flash-fin:free",
    "nvidia/nemotron-3.5-lightning:free",
    "dots-studio/dots3-note-preview:free",
    "inclusionai/ling-3.0-flash-vl:free",
    "nex-agi/nex-n2.5-pro:free",
    "thinking-machines/inkling:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "deepseek/deepseek-v4-flash-0731:free",
    "inclusionai/ling-3.0-flash-sante:free",
    "thinking-machines/inkling-small:free",
    "cohere/north-mini-code:free",
    "nex-agi/nex-n2.5-mini:free",
    "poolside/laguna-xs-2.1:free",
    "nvidia/nemotron-3-nano-omni:free"
  ]);
  if(!freeOpenRouterModels.has(route.model_id))return out({status:"blocked",reason:"model_not_verified"});
  const p=input?.payload;
  const messages=Array.isArray(p?.messages)&&p.messages.length?p.messages:(typeof p?.prompt==="string"&&p.prompt.length?[{role:"user",content:p.prompt}]:null);
  if(!messages)return out({status:"blocked",reason:"input_missing"});
  const requestedCompletion=Number.isFinite(Number(p.max_completion_tokens))?Number(p.max_completion_tokens):(Number.isFinite(Number(p.max_tokens))?Number(p.max_tokens):1200);
  const boundedCompletion=Math.max(1,Math.min(Math.floor(requestedCompletion),4000));
  const reqBody:any={model:route.model_id,messages,max_completion_tokens:boundedCompletion,reasoning:{effort:'none'}};
  if(typeof p.temperature==="number")reqBody.temperature=p.temperature;

  const providerKey=await secret("aria_openrouter_primary");
  if(!providerKey)return out({status:"failed",error:{code:"credential_unavailable",message:"credential unavailable"}});
  const reservation=await reserveModelQuota(route,requestId,providerKey,providerTimeoutMs?Math.min(3000,providerTimeoutMs):8000);
  if(!reservation.allowed)return out({status:"blocked",reason:reservation.reason},reservation.reason.includes("exhausted")?429:503);
  const reservationKey=reservation.reservation_key;

  let res:Response;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),providerTimeoutMs??25000);
  let json:any=null;
  try{
    res=await fetch("https://openrouter.ai/api/v1/chat/completions",{
      method:"POST",
      headers:{Authorization:`Bearer ${providerKey}`,"Content-Type":"application/json"},
      body:JSON.stringify(reqBody),
      signal:controller.signal
    });
    json=await res.json().catch((error:any)=>{if(error?.name==="AbortError")throw error;return null;});
  }catch(error){
    await settleModelQuota(reservationKey,"unknown",null,null);
    const timedOut=error instanceof Error&&error.name==="AbortError";
    return out({status:"failed",error:{code:timedOut?"transport_timeout":"transport_error",message:timedOut?"provider request timed out":"transport failure"}});
  }finally{clearTimeout(timeout)}
  if(!res.ok){
    await settleModelQuota(reservationKey,"failed",res.status,json);
    return out({status:"failed",error:{code:"provider_error",message:sanitize(json?.error?.message||`provider returned HTTP ${res.status}`),provider_status:res.status}});
  }
  const content=json?.choices?.[0]?.message?.content;
  if(typeof content!=="string"){
    await settleModelQuota(reservationKey,"failed",res.status,json);
    return out({status:"failed",error:{code:"invalid_response",message:"no text content in provider response"}});
  }
  const settled=await settleModelQuota(reservationKey,"succeeded",res.status,json,typeof json?.id==="string"?json.id:null);
  return out({
    status:"succeeded",
    response:{
      modality:"text",
      content,
      provider_response_id:typeof json?.id==="string"?json.id:null,
      finish_reason:typeof json?.choices?.[0]?.finish_reason==="string"?json.choices[0].finish_reason:null,
      provider_model:typeof json?.model==="string"?json.model:null
    },
    usage:json?.usage??{status:"unknown"},
    metadata:{runtime:"aria-execution-runtime-v1",adapter_id:"openrouter_chat_completions",provider_id:"openrouter",route_type:"mediated",attempt:1,quota_accounting:settled?"settled":"reserved_settlement_pending",canonical_write:false,memory_authority:"none"}
  });
}
if(route.provider_id==="mistral")return out({status:"blocked",reason:"provider_permanently_excluded"});
const requestId=String(body?.request_id||"");
if(route.provider_id==="google")return await directGemini(route,input,requestId,voiceProviderTimeoutMs);
if(route.provider_id==="xai")return await xaiResponses(route,input,requestId,voiceProviderTimeoutMs);
if(route.provider_id!=="openrouter")return out({status:"blocked",reason:"adapter_unavailable"});
return await openRouterChat(route,input,requestId,voiceProviderTimeoutMs);
});
