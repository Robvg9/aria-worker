import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { m22Gate3HumanGateActionHash, m22Gate3RouteAllowed, m22MissionWonder2ScopedProbeAllowed } from "../_shared/mission-wonder-2-gate3-scope-v1.mjs";
import { parseOpenRouterFreeDailyQuota, extractProviderUsage, parseQuotaReservation } from "./quota-accounting-v1.mjs";
import { isCloudflarePlanPreviewRequest } from "../_shared/cloudflare-plan-preview-auth-v1.mjs";
const MISSION_EXECUTION_PAUSED = true;
const URL=Deno.env.get("SUPABASE_URL")!;const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")??"";const PLAN_BRIDGE_SECRET=Deno.env.get("ARIA_PLAN_PRODUCER_SHARED_SECRET")??"";const GOOGLE_API_KEY=Deno.env.get("GOOGLE_API_KEY")??"";
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
  let providerRemaining:number|null=null;
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
    providerRemaining=daily.remaining;
  }

  const {data,error}=await sb.schema("aria_internal").rpc("quota_reserve_model_request_v2",{
    p_reservation_key:reservationKey,
    p_provider_id:String(route?.provider_id||""),
    p_account_id:String(route?.account_id||""),
    p_model_id:String(route?.model_id||""),
    p_provider_used:providerUsed,
    p_provider_limit:providerLimit,
    p_provider_remaining:providerRemaining,
  });
  if(error) return {allowed:false,reason:"quota_reservation_database_error"};
  const parsed=parseQuotaReservation(data);
  if(!parsed.allowed) return parsed;
  return {allowed:true,reservation_key:parsed.reservation_key,provider_secret:providerSecret};
}

async function settleModelQuota(reservationKey:string,outcome:string,providerStatus:number|null,payload:any,providerResponseId:string|null=null) {
  if(!reservationKey) return false;
  const usage=extractProviderUsage(payload);
  const {data,error}=await sb.schema("aria_internal").rpc("quota_settle_model_request_v2",{
    p_reservation_key:reservationKey,
    p_outcome:outcome,
    p_provider_status:providerStatus,
    p_prompt_tokens:usage.prompt_tokens,
    p_completion_tokens:usage.completion_tokens,
    p_total_tokens:usage.total_tokens,
    p_provider_response_id:providerResponseId,
    p_cached_input_tokens:usage.cached_input_tokens,
  });
  return !error&&data?.settled===true;
}
