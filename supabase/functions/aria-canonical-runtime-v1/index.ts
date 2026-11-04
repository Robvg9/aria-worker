import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyMissionWonder2PwaMission } from "../_shared/mission-wonder-2-pwa-scope-v1.mjs";
const URL=Deno.env.get("SUPABASE_URL")!;const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const API_KEY=Deno.env.get("SUPABASE_PUBLISHABLE_KEY")||Deno.env.get("SUPABASE_ANON_KEY")||"";const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")??"";const RUNNER=`${URL}/functions/v1/aria-mission-runner-v22`;const sb=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});function internalFunctionFetch(input:RequestInfo|URL,init:RequestInit={}){if(!API_KEY)throw new Error("supabase_project_apikey_missing");const headers=new Headers(init.headers);headers.set("apikey",API_KEY);return fetch(input,{...init,headers});}const MISSION_EXECUTION_PAUSED=true;const bearer=(r:Request)=>{const h=r.headers.get("authorization")??"";return h.startsWith("Bearer ")?h.slice(7):null};const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};async function sha256Hex(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join("")}
async function authorized(r:Request){
  const t=bearer(r);
  if(t&&KEY&&eq(t,KEY))return true;
  if(t&&SECRET&&eq(t,SECRET))return true;
  const a=r.headers.get("x-aria-autonomy-token")??t;
  if(!a)return false;
  try{
    const h=await sha256Hex(a);
    const {data,error}=await sb.schema("aria_internal").from("runtime_auth_token_hashes").select("token_name,token_hash").eq("token_name","aria_autonomy_cron_token").eq("active",true).maybeSingle();
    if(!error&&data?.token_hash&&eq(h,String(data.token_hash)))return true;
  }catch(_){}
  const {data,error}=await sb.rpc("aria_autonomy_cron_authorize",{p_token:a});return !error&&data===true
}Deno.serve(async (request) => {
  if (request.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await authorized(request))) return out({ error: "unauthorized" }, 401);

  const rawBody = await request.text();
  let body: any;
  try { body = JSON.parse(rawBody); } catch { return out({ error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return out({ error: "invalid_json" }, 400);

  let scopedMissionAllowed = false;
  let missionId = String(body.mission_id || "").trim();
  if (MISSION_EXECUTION_PAUSED && missionId && request.headers.get("x-aria-trigger") === "mission-tick") {
    const { data: mission, error } = await sb.schema("aria_internal").from("mission_state")
      .select("mission_id,goal,status,metadata,checkpoint")
      .eq("mission_id", missionId)
      .maybeSingle();
    if (!error && mission && ["queued", "running"].includes(String(mission.status || ""))) {
      const scope = await verifyMissionWonder2PwaMission(mission, SECRET);
      scopedMissionAllowed = scope.ok === true && scope.payload?.mission_id === missionId;
    }
  }
  if (MISSION_EXECUTION_PAUSED && !scopedMissionAllowed) {
    return out({ ok: false, status: "paused", error: "mission_execution_paused", runtime: "canonical-runtime-v1", execution_enabled: false }, 423);
  }
  if (!API_KEY) return out({ error: "supabase_project_apikey_missing" }, 503);

  const headers = new Headers({ "content-type": "application/json", "apikey": API_KEY });
  const autonomyToken = request.headers.get("x-aria-autonomy-token");
  const authorization = request.headers.get("authorization");
  const trace = request.headers.get("X-ARIA-Trace-Id");
  const meditation = request.headers.get("x-aria-trigger") === "meditation-ia";
  if (scopedMissionAllowed || KEY) {
    headers.set("authorization", `Bearer ${KEY || SECRET}`);
    if (scopedMissionAllowed) headers.set("x-aria-trigger", "mission-tick");
    else if (meditation) headers.set("x-aria-trigger", "meditation-ia");
  } else if (meditation && SECRET) {
    headers.set("authorization", `Bearer ${SECRET}`);
    headers.set("x-aria-trigger", "meditation-ia");
  } else if (autonomyToken) {
    headers.set("x-aria-autonomy-token", autonomyToken);
  } else if (authorization) {
    headers.set("authorization", authorization);
  }
  if (trace) headers.set("X-ARIA-Trace-Id", trace);

  try {
    if (scopedMissionAllowed) {
      const responsePromise = internalFunctionFetch(RUNNER, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...body, mission_id: missionId }),
      });
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(responsePromise); } catch {}
      return out({ ok: true, status: "accepted", async: true, runtime: "canonical-runtime-v1", mission_id: missionId }, 202);
    }
    const upstream = await internalFunctionFetch(RUNNER, { method: "POST", headers, body: rawBody });
    const responseBody = await upstream.text();
    return new Response(responseBody, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json", "cache-control": "no-store" },
    });
  } catch (error) {
    return out({ ok: false, status: "unavailable", error: error instanceof Error ? error.message : String(error), runtime: "canonical-runtime-v1" }, 503);
  }
});
