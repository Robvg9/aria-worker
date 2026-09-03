import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const RESOURCE = `${SUPABASE_URL}/functions/v1/aria-mcp-server-grok-v2`;
const AUTH_SERVER = `${SUPABASE_URL}/functions/v1/aria-mcp-oauth-grok-v2`;
const RESOURCE_METADATA = `${RESOURCE}/.well-known/oauth-protected-resource`;
const SCOPES = "openid profile email";
const HEADERS = { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" };
const TOOLS = [
{name:"aria_context",description:"Retrieve relevant authorized ChatBending context. Read-only.",inputSchema:{type:"object",properties:{query:{type:"string",minLength:1}},required:["query"],additionalProperties:false}},
{name:"aria_memory_capture",description:"Submit a memory candidate through the existing Gate-protected memory pipeline.",inputSchema:{type:"object",properties:{message:{type:"string",minLength:1},source_application:{type:"string"},source_conversation_id:{type:"string"},source_session_id:{type:"string"},idempotency_key:{type:"string"}},required:["message"],additionalProperties:false}}
];
const json=(status:number,body:unknown,extra:HeadersInit={})=>new Response(JSON.stringify(body),{status,headers:{...HEADERS,...extra}});
const rpc=(id:unknown,result:unknown)=>({jsonrpc:"2.0",id,result});
const rpcError=(id:unknown,code:number,message:string)=>({jsonrpc:"2.0",id,error:{code,message}});
const bearer=(req:Request)=>{const a=req.headers.get("authorization")??"";return a.startsWith("Bearer ")?a.slice(7).trim():""};
const challenge=()=>`Bearer resource_metadata="${RESOURCE_METADATA}", scope="${SCOPES}"`;
async function getUser(token:string){if(!token||!ANON_KEY)return null;const c=createClient(SUPABASE_URL,ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await c.auth.getUser(token);if(error||!data.user)return null;return data.user;}
async function callUpstream(slug:string,token:string,payload:unknown){const r=await fetch(`${SUPABASE_URL}/functions/v1/${slug}`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(payload)});const t=await r.text();let b:unknown;try{b=JSON.parse(t)}catch{b={raw:t.slice(0,2000)}}return {status:r.status,body:b};}
Deno.serve(async req=>{
 const u=new URL(req.url);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{...HEADERS,"access-control-allow-origin":"*","access-control-allow-methods":"GET,HEAD,POST,OPTIONS","access-control-allow-headers":"authorization,content-type,accept,mcp-protocol-version,mcp-method,mcp-name,x-client-id,x-aria-trace-id","access-control-expose-headers":"WWW-Authenticate"}});
 if(req.method==="GET"&&u.pathname.endsWith("/.well-known/oauth-protected-resource"))return json(200,{resource:RESOURCE,authorization_servers:[AUTH_SERVER],bearer_methods_supported:["header"],scopes_supported:SCOPES.split(" "),transport:"streamable-http"},{"access-control-allow-origin":"*"});
 if(req.method!=="POST")return json(401,{error:"unauthorized",transport:"streamable-http"},{"WWW-Authenticate":challenge()});
 let body:any;try{body=await req.json()}catch{return json(400,{error:"invalid_json"})}
 const id=body.id??null;const method=typeof body.method==="string"?body.method:"";const requested=req.headers.get("MCP-Protocol-Version")??body.params?.protocolVersion??"2025-03-26";
 if(!["2025-03-26","2025-06-18","2025-11-25","2026-07-28"].includes(requested))return json(400,rpcError(id,-32022,"unsupported_protocol"));
 if(method==="initialize")return json(200,rpc(id,{protocolVersion:requested,serverInfo:{name:"ARIA MCP Server",version:"1.5.0"},capabilities:{tools:{listChanged:false}},transport:"streamable-http"}));
 if(method==="notifications/initialized")return new Response(null,{status:202,headers:HEADERS});
 if(method==="server/discover")return json(200,rpc(id,{resultType:"complete",supportedVersions:["2026-07-28","2025-11-25","2025-06-18","2025-03-26"],capabilities:{tools:{listChanged:false}}}));
 if(method==="tools/list")return json(200,rpc(id,{tools:TOOLS}));
 if(method!=="tools/call")return json(200,rpcError(id,-32601,"unsupported_method"));
 const token=bearer(req);const user=await getUser(token);if(!user)return json(401,{error:"unauthorized"},{"WWW-Authenticate":challenge()});
 const args=body.params?.arguments??{};const name=typeof body.params?.name==="string"?body.params.name:"";
 if(name==="aria_context"){if(typeof args.query!=="string"||!args.query.trim())return json(200,rpcError(id,-32602,"query is required"));const out=await callUpstream("aria-context-retrieval-v1",token,{query:args.query.trim()});return json(200,rpc(id,{content:[{type:"text",text:JSON.stringify(out.body)}],isError:out.status>=400}));}
 if(name==="aria_memory_capture"){if(typeof args.message!=="string"||!args.message.trim())return json(200,rpcError(id,-32602,"message is required"));const payload={mode:"write",source_application:typeof args.source_application==="string"&&args.source_application.trim()?args.source_application.trim():"grok",source_conversation_id:typeof args.source_conversation_id==="string"?args.source_conversation_id:"mcp",source_session_id:typeof args.source_session_id==="string"?args.source_session_id:null,role:"user",message:args.message.trim(),user:user.id,idempotency_key:typeof args.idempotency_key==="string"&&args.idempotency_key?args.idempotency_key:crypto.randomUUID()};const out=await callUpstream("aria-memory-bridge-9-4",token,payload);return json(200,rpc(id,{content:[{type:"text",text:JSON.stringify(out.body)}],isError:out.status>=400}));}
 return json(200,rpcError(id,-32601,"unknown_tool"));
});