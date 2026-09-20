import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")!;
const CANONICAL=`${URL}/functions/v1/aria-autonomy-supervisor-v5`;
const GATEWAY=`${URL}/functions/v1/aria-device-gateway`;
const sb=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};
const bearer=(r:Request)=>{const h=r.headers.get("authorization")??"";return h.startsWith("Bearer ")?h.slice(7):null};
async function authorized(r:Request){
  const t=bearer(r);
  if(t&&SECRET&&eq(t,SECRET))return true;
  const c=r.headers.get("x-aria-autonomy-token");
  if(!c)return false;
  const {data,error}=await sb.rpc("aria_autonomy_cron_authorize",{p_token:c});
  return !error&&data===true;
}
async function meditationActive(){
  const {data,error}=await sb.schema("aria_internal").from("meditation_control").select("controller_id,desired_mode,session_id,metadata").eq("controller_id","primary").maybeSingle();
  if(error)throw new Error(error.message);
  return data&&data.desired_mode==="active"?data:null;
}
async function meditationKick(r:any,control:any){
  const response=await fetch(`${GATEWAY}/v1/meditation/tick-service`,{
    method:"POST",
    headers:{...(r.headers.get("x-aria-autonomy-token")?{"x-aria-autonomy-token":r.headers.get("x-aria-autonomy-token")}:{authorization:`Bearer ${SECRET}`}),"content-type":"application/json","x-aria-trigger":"meditation-ia-cloud-supervisor"},
    body:JSON.stringify({session_id:control.session_id,device_id:control.metadata?.device_id||null,source:"aria-autonomy-supervisor-v10"})
  });
  const payload=await response.json().catch(()=>({}));
  return {http_status:response.status,...payload};
}
Deno.serve(async r=>{
  if(r.method!=="POST")return out({error:"method_not_allowed"},405);
  if(!await authorized(r))return out({error:"unauthorized"},401);
  try{
    const control=await meditationActive();
    if(control){
      const meditation=await meditationKick(r,control);
      return out({ok:meditation.http_status>=200&&meditation.http_status<300&&meditation.ok!==false,deprecated:false,canonical_authority:"aria-device-gateway:/v1/meditation/tick-service",meditation});
    }
    const response=await fetch(CANONICAL,{
      method:"POST",
      headers:{...(r.headers.get("x-aria-autonomy-token")?{"x-aria-autonomy-token":r.headers.get("x-aria-autonomy-token")}:{authorization:`Bearer ${SECRET}`}),"content-type":"application/json","x-aria-trigger":"legacy-supervisor-v10-compat"},
      body:"{}"
    });
    const payload=await response.json().catch(()=>({}));
    return out({ok:response.ok,deprecated:true,canonical_authority:"aria-autonomy-supervisor-v5",runtime:{http_status:response.status,...payload}});
  }catch(e){
    return out({ok:false,deprecated:false,error:e instanceof Error?e.message:String(e)},200);
  }
});