import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")!;
const GATEWAY=`${URL}/functions/v1/aria-device-gateway`;
const REPAIR_SUPERVISOR=`${URL}/functions/v1/aria-repair-supervisor-v1`;
const sb=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});

const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};
const bearer=(r:Request)=>{const h=r.headers.get("authorization")??"";return h.startsWith("Bearer ")?h.slice(7):null};
async function rpc(n:string,a:Record<string,unknown>){const {data,error}=await sb.rpc(n,a);if(error)throw new Error(`${n}:${error.message}`);return data}
async function authorized(r:Request){
  const t=bearer(r);
  if(t&&SECRET&&eq(t,SECRET))return true;
  const c=r.headers.get("x-aria-autonomy-token");
  return c?Boolean(await rpc("aria_autonomy_cron_authorize",{p_token:c})):false;
}

async function requestJson(
  url:string,
  headers:Record<string,string>,
  body:string,
){
  try{
    const response=await fetch(url,{method:"POST",headers,body});
    const payload=await response.json().catch(()=>({}));
    return {http_status:response.status,ok:response.ok,payload};
  }catch(error){
    return {http_status:0,ok:false,payload:{status:"request_failed",error:error instanceof Error?error.message:String(error)}};
  }
}

async function runCycle(authHeaders:Record<string,string>){
  const requests=await Promise.allSettled([
    requestJson(
      `${GATEWAY}/v1/audit/all-for-one/start`,
      {...authHeaders,"x-aria-trigger":"all-for-one-supervisor-v1"},
      "{}",
    ),
    requestJson(
      REPAIR_SUPERVISOR,
      {...authHeaders,"x-aria-trigger":"aria-autonomous-repair-supervisor"},
      "{}",
    ),
    requestJson(
      `${GATEWAY}/v1/meditation/tick-service`,
      {...authHeaders,"x-aria-trigger":"meditation-ia-cloud-supervisor"},
      JSON.stringify({source:"aria-autonomy-supervisor-v5"}),
    ),
    requestJson(
      `${GATEWAY}/v1/autonomy/cycle`,
      {...authHeaders,"x-aria-trigger":"autonomy-supervisor-v5"},
      JSON.stringify({trigger:"autonomy-supervisor-v5"}),
    ),
    requestJson(
      `${GATEWAY}/v1/audit/all-for-one/tick`,
      {...authHeaders,"x-aria-trigger":"all-for-one-supervisor-v1"},
      "{}",
    ),
  ]);
  const normalized=requests.map((entry,index)=>{
    if(entry.status==="fulfilled")return entry.value;
    return {http_status:0,ok:false,payload:{status:"request_failed",error:String(entry.reason??"unknown")},index};
  });
  return {
    completed:true,
    meditation:normalized[2],
    repair:normalized[1],
    autonomy:normalized[3],
    audit_start:normalized[0],
    audit_tick:normalized[4],
    all_ok:normalized.every(x=>x.ok),
  };
}

async function kick(r:Request){
  const authHeaders:Record<string,string>={
    ...(r.headers.get("x-aria-autonomy-token")
      ? {"x-aria-autonomy-token":String(r.headers.get("x-aria-autonomy-token"))}
      : {authorization:`Bearer ${SECRET}`}),
    "content-type":"application/json",
  };

  const background=runCycle(authHeaders);
  const waitUntil=(globalThis as any).EdgeRuntime?.waitUntil;
  if(typeof waitUntil==="function"){
    waitUntil(background);
    return {
      http_status:202,
      accepted:true,
      background:true,
      dispatch_started:true,
      contract:"autonomy-supervisor-orchestrates-independent-subsystems",
    };
  }

  const runtime=await background;
  return {http_status:200,accepted:true,background:false,...runtime};
}

Deno.serve(async r=>{
  if(r.method!=="POST")return out({error:"method_not_allowed"},405);
  try{
    if(!await authorized(r))return out({error:"unauthorized"},401);
    const runtime=await kick(r);
    return out({
      ok:runtime.accepted===true,
      authority:"aria-device-gateway:/v1/autonomy/cycle",
      runtime
    },runtime.http_status||200);
  }catch(e){
    return out({ok:false,error:e instanceof Error?e.message:String(e)},200);
  }
});
