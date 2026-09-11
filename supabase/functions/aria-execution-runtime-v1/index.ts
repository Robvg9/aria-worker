import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")!;const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")??"";const GOOGLE_API_KEY=Deno.env.get("GOOGLE_API_KEY")??"";
const sb=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const bearer=(r:Request)=>{const h=r.headers.get("authorization")??"";return h.startsWith("Bearer ")?h.slice(7):null};
const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};
async function auth(r:Request){const b=bearer(r);if(b&&SECRET&&eq(b,SECRET))return true;const t=r.headers.get("x-aria-autonomy-token");if(!t)return false;const {data,error}=await sb.rpc("aria_autonomy_cron_authorize",{p_token:t});return !error&&data===true}
async function secret(name:string){const {data,error}=await sb.rpc("read_aria_credential_secret",{p_name:name});if(error||typeof data!=="string"||!data)return null;return data}
const sanitize=(m:unknown)=>String(m??"error").replace(/Bearer\s+[A-Za-z0-9._-]+/g,"[redacted]").replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g,"[redacted]").replace(/AIza[A-Za-z0-9_-]{20,}/g,"[redacted]").replace(/\bor-v1-[A-Za-z0-9_-]{8,}\b/g,"[redacted]").replace(/\bxai-[A-Za-z0-9_-]{8,}\b/g,"[redacted]");
async function directGemini(route:any,input:any){
  if(route.capability!=="text_generation")return out({status:"blocked",reason:"capability_missing"});
  if(route.account_id!=="acct_google_gemini_free")return out({status:"blocked",reason:"route_not_selectable"});
  if(route.model_id!=="google/gemini-3.5-flash-lite-direct")return out({status:"blocked",reason:"model_not_verified"});
  if(!GOOGLE_API_KEY)return out({status:"failed",error:{code:"credential_unavailable",message:"google credential unavailable"}});
  const p=input?.payload??{};const model="gemini-3.5-flash-lite";const contents=Array.isArray(p.contents)&&p.contents.length?p.contents:(typeof p.prompt==="string"&&p.prompt.length?[{role:"user",parts:[{text:p.prompt}]}]:null);
  if(!contents)return out({status:"blocked",reason:"input_missing"});
  const body:any={contents};if(p.systemInstruction)body.systemInstruction=p.systemInstruction;if(p.generationConfig)body.generationConfig={...p.generationConfig};
  if(body.generationConfig?.temperature!==undefined){const {temperature,...rest}=body.generationConfig;body.generationConfig=rest;}
  if(body.generationConfig?.topP!==undefined){const {topP,...rest}=body.generationConfig;body.generationConfig=rest;}
  if(body.generationConfig?.topK!==undefined){const {topK,...rest}=body.generationConfig;body.generationConfig=rest;}
  let res:Response;try{res=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":GOOGLE_API_KEY},body:JSON.stringify(body)})}catch{return out({status:"failed",error:{code:"transport_error",message:"transport failure"}})}
  const json=await res.json().catch(()=>null);if(!res.ok)return out({status:"failed",error:{code:"provider_error",message:sanitize(json?.error?.message||`provider returned HTTP ${res.status}`),provider_status:res.status}});
  const parts=json?.candidates?.[0]?.content?.parts;const text=Array.isArray(parts)?parts.filter((x:any)=>typeof x?.text==="string").map((x:any)=>x.text).join(""):"";
  if(!text)return out({status:"failed",error:{code:"invalid_response",message:"no text content in provider response"}});
  return out({status:"succeeded",response:{modality:"text",content:text,provider_response_id:null,finish_reason:json?.candidates?.[0]?.finishReason??null,provider_model:route.model_id},usage:json?.usageMetadata?{status:"known",prompt_tokens:json.usageMetadata.promptTokenCount??null,completion_tokens:json.usageMetadata.candidatesTokenCount??null,total_tokens:json.usageMetadata.totalTokenCount??null}:{status:"unknown"},metadata:{runtime:"aria-execution-runtime-v1",adapter_id:"google_gemini_generate_content",provider_id:"google",route_type:"direct",attempt:1,canonical_write:false,memory_authority:"none"}});
}
async function xaiResponses(route:any,input:any){
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
  let res:Response;try{res=await fetch("https://api.x.ai/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${sec}`,"Content-Type":"application/json"},body:JSON.stringify(body)})}catch{return out({status:"failed",error:{code:"transport_error",message:"transport failure"}})}
  const json=await res.json().catch(()=>null);if(!res.ok)return out({status:"failed",error:{code:"provider_error",message:sanitize(json?.error?.message||`provider returned HTTP ${res.status}`),provider_status:res.status}});
  const parts=Array.isArray(json?.output)?json.output:[];const text=parts.flatMap((item:any)=>item?.type==="message"&&Array.isArray(item?.content)?item.content:[]).filter((c:any)=>typeof c?.text==="string").map((c:any)=>c.text).join("")|| (typeof json?.output_text==="string"?json.output_text:"");
  if(!text)return out({status:"failed",error:{code:"invalid_response",message:"no text content in provider response"}});
  const u=json?.usage;const inTok=typeof u?.input_tokens==="number"?u.input_tokens:null;const outTok=typeof u?.output_tokens==="number"?u.output_tokens:null;const total=typeof u?.total_tokens==="number"?u.total_tokens:(inTok!==null&&outTok!==null?inTok+outTok:null);
  return out({status:"succeeded",response:{modality:"text",content:text,provider_response_id:typeof json?.id==="string"?json.id:null,finish_reason:typeof json?.status==="string"?json.status:null,provider_model:typeof json?.model==="string"?json.model:route.model_id},usage:{status:"reported",prompt_tokens:inTok,completion_tokens:outTok,total_tokens:total},metadata:{runtime:"aria-execution-runtime-v1",adapter_id:"xai_responses",provider_id:"xai",route_type:"direct",attempt:1,canonical_write:false,memory_authority:"none"}});
}
Deno.serve(async r=>{if(r.method!=="POST")return out({error:"method_not_allowed"},405);if(!(await auth(r)))return out({error:"unauthorized"},401);const body=await r.json().catch(()=>({}));const route=body?.selected_route;const input=body?.input;const az=body?.authorization;if(!route||typeof route!=="object")return out({status:"blocked",reason:"route_missing"});if(!az||az.status!=="approved")return out({status:"blocked",reason:"authorization_not_approved"});if(route.provider_id==="google")return directGemini(route,input);if(route.provider_id==="xai")return xaiResponses(route,input);if(route.provider_id!=="openrouter")return out({status:"blocked",reason:"adapter_unavailable"});if(route.capability!=="text_generation")return out({status:"blocked",reason:"capability_missing"});if(route.account_id!=="acct_openrouter_primary")return out({status:"blocked",reason:"route_not_selectable"});if(route.model_id!=="google/gemini-2.5-flash-lite")return out({status:"blocked",reason:"model_not_verified"});const sec=await secret("aria_openrouter_primary");if(!sec)return out({status:"failed",error:{code:"credential_unavailable",message:"credential unavailable"}});const p=input?.payload;const messages=Array.isArray(p?.messages)&&p.messages.length?p.messages:(typeof p?.prompt==="string"&&p.prompt.length?[{role:"user",content:p.prompt}]:null);if(!messages)return out({status:"blocked",reason:"input_missing"});const reqBody:any={model:route.model_id,messages};if(typeof p.max_tokens==="number")reqBody.max_tokens=p.max_tokens;if(typeof p.temperature==="number")reqBody.temperature=p.temperature;let res:Response;try{res=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${sec}`,"Content-Type":"application/json"},body:JSON.stringify(reqBody)})}catch{return out({status:"failed",error:{code:"transport_error",message:"transport failure"}})}const json=await res.json().catch(()=>null);if(!res.ok)return out({status:"failed",error:{code:"provider_error",message:sanitize(json?.error?.message||`provider returned HTTP ${res.status}`),provider_status:res.status}});const c=json?.choices?.[0]?.message?.content;if(typeof c!=="string")return out({status:"failed",error:{code:"invalid_response",message:"no text content in provider response"}});return out({status:"succeeded",response:{modality:"text",content:c,provider_response_id:typeof json?.id==="string"?json.id:null,finish_reason:typeof json?.choices?.[0]?.finish_reason==="string"?json.choices[0].finish_reason:null,provider_model:typeof json?.model==="string"?json.model:null},usage:json?.usage??{status:"unknown"},metadata:{runtime:"aria-execution-runtime-v1",adapter_id:"openrouter_chat_completions",provider_id:"openrouter",route_type:"mediated",attempt:1,canonical_write:false,memory_authority:"none"}})});
