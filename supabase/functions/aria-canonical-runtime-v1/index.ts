import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")!;const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")??"";const RUNNER=`${URL}/functions/v1/aria-mission-runner-v22`;const sb=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});const bearer=(r:Request)=>{const h=r.headers.get("authorization")??"";return h.startsWith("Bearer ")?h.slice(7):null};const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};async function sha256Hex(value:string){const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,"0")).join("")}
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
}Deno.serve(async r=>{if(r.method!=="POST")return out({error:"method_not_allowed"},405);if(!(await authorized(r)))return out({error:"unauthorized"},401);const body=await r.text();const h=new Headers({"content-type":"application/json"});const at=r.headers.get("x-aria-autonomy-token"),ab=r.headers.get("authorization"),trace=r.headers.get("X-ARIA-Trace-Id");const meditation=r.headers.get("x-aria-trigger")==="meditation-ia";if(meditation&&KEY){h.set("authorization",`Bearer ${KEY}`);h.set("x-aria-trigger","meditation-ia");}else if(KEY){h.set("authorization",`Bearer ${KEY}`);}else if(meditation&&SECRET){h.set("authorization",`Bearer ${SECRET}`);h.set("x-aria-trigger","meditation-ia");}else if(at)h.set("x-aria-autonomy-token",at);else if(ab)h.set("authorization",ab);if(trace)h.set("X-ARIA-Trace-Id",trace);try{const u=await fetch(RUNNER,{method:"POST",headers:h,body});const b=await u.text();return new Response(b,{status:u.status,headers:{"content-type":u.headers.get("content-type")||"application/json","cache-control":"no-store"}})}catch(e){return out({ok:false,status:"unavailable",error:e instanceof Error?e.message:String(e),runtime:"canonical-runtime-v1"},503)}});