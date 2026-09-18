import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")!;
const GATEWAY=`${URL}/functions/v1/aria-device-gateway`;
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
async function kick(){
  const [response,auditResponse]=await Promise.all([
    fetch(`${GATEWAY}/v1/autonomy/cycle`,{
      method:"POST",
      headers:{authorization:`Bearer ${SECRET}`,"content-type":"application/json","x-aria-trigger":"autonomy-supervisor-v5"},
      body:JSON.stringify({trigger:"autonomy-supervisor-v5"})
    }),
    fetch(`${GATEWAY}/v1/audit/all-for-one/tick`,{
      method:"POST",
      headers:{authorization:`Bearer ${SECRET}`,"content-type":"application/json","x-aria-trigger":"all-for-one-supervisor-v1"},
      body:"{}"
    })
  ]);
  const payload=await response.json().catch(()=>({}));
  const audit=await auditResponse.json().catch(()=>({ok:false,status:"audit_response_invalid"}));
  return {http_status:response.status,...payload,audit_http_status:auditResponse.status,audit};
}
Deno.serve(async r=>{
  if(r.method!=="POST")return out({error:"method_not_allowed"},405);
  try{
    if(!await authorized(r))return out({error:"unauthorized"},401);
    const runtime=await kick();
    return out({
      ok:runtime.http_status>=200&&runtime.http_status<300&&runtime.ok!==false,
      authority:"aria-device-gateway:/v1/autonomy/cycle",
      runtime
    });
  }catch(e){
    return out({ok:false,error:e instanceof Error?e.message:String(e)},200);
  }
});
