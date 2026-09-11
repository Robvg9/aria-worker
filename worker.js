const SUPABASE_MCP = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1";
const SUPABASE_OAUTH = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1";
const SUPABASE_BROWSER_OAUTH = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1";
const PUBLIC_ISSUER = "https://aria.robvg9.workers.dev";
const PUBLIC_RESOURCE = `${PUBLIC_ISSUER}/mcp`;
const PUBLIC_AUTH_ENDPOINT = `${PUBLIC_ISSUER}/authorize`;
const PUBLIC_TOKEN_ENDPOINT = `${PUBLIC_ISSUER}/token`;
const PUBLIC_REGISTER_ENDPOINT = `${PUBLIC_ISSUER}/register`;
const RUNTIME_GATEWAY = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-runtime-gateway-v1";
const MISSION_INTAKE = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-intake-v1";
const CANONICAL_RUNTIME = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-canonical-runtime-v1";
const DIRECT_ARIA = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-direct-v1";
const CRON_AUTH_URL = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-cron-auth-v1";
const RESOURCE = PUBLIC_RESOURCE;
const RESOURCE_METADATA = `${PUBLIC_ISSUER}/.well-known/oauth-protected-resource/mcp`;
const SCOPES = ["aria.mcp.inbound"];
const { createCloudflareAdminEndpoint } = require("./integrations/cloudflare-admin-endpoint");
const { createCloudflareTokenManager } = require("./integrations/cloudflare-token-manager");
const cloudflareAdmin = createCloudflareAdminEndpoint({ scriptName: "aria" });
const cloudflareTokenManager = createCloudflareTokenManager();
function json(body,status=200,extra={}){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...extra}})}
function protectedResourceMetadata(){return{resource:RESOURCE,authorization_servers:[PUBLIC_ISSUER],bearer_methods_supported:["header"],scopes_supported:SCOPES}}
function authorizationServerMetadata(){return{issuer:PUBLIC_ISSUER,authorization_endpoint:PUBLIC_AUTH_ENDPOINT,token_endpoint:PUBLIC_TOKEN_ENDPOINT,registration_endpoint:PUBLIC_REGISTER_ENDPOINT,response_types_supported:["code"],grant_types_supported:["authorization_code","refresh_token"],code_challenge_methods_supported:["S256"],token_endpoint_auth_methods_supported:["none"],scopes_supported:SCOPES,authorization_response_iss_parameter_supported:true,client_id_metadata_document_supported:true}}
function constantTimeEqual(a,b){if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0}
function extractBearer(request){const value=request.headers.get("authorization");const match=value&&value.match(/^Bearer\s+(.+)$/i);return match?match[1]:null}
async function vaultCronAuthorized(request,fetchImpl=globalThis.fetch){const token=request.headers.get("x-aria-autonomy-token");if(!token)return false;try{const response=await fetchImpl(CRON_AUTH_URL,{method:"POST",headers:{"content-type":"application/json","x-aria-autonomy-token":token},body:"{}"});if(!response.ok)return false;const body=await response.json().catch(()=>null);return body?.authorized===true}catch(_){return false}}
async function autonomyHealth(request){if(request.method!=="GET")return json({error:"method_not_allowed"},405);if(!(await vaultCronAuthorized(request)))return json({error:"unauthorized"},401);return json({ok:true,service:"aria-worker",executor:"cloudflare-worker",version:"canonical-runtime-v1"})}
function rewriteAuthChallenge(response){const headers=new Headers(response.headers);headers.set("WWW-Authenticate",'Bearer resource_metadata="'+RESOURCE_METADATA+'", scope="'+SCOPES.join(" ")+'"');headers.set("Access-Control-Expose-Headers","WWW-Authenticate, X-ARIA-Trace-Id");return new Response(response.body,{status:response.status,statusText:response.statusText,headers})}
function escapeHtml(value){return String(value).replace(/[&<>'\"]/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[ch]))}
function authorizationPage(pendingId,origin){const id=escapeHtml(pendingId);const go=`${origin}/authorize/consent`;return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ARIA</title><style>:root{color-scheme:dark;--bg:#090b12;--card:#111522;--line:#252b3c;--text:#f6f7fb;--muted:#a5adc2;--accent:#8b5cf6;--accent2:#6366f1}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 500px at 50% 0,#1a1634 0%,var(--bg) 58%);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text);padding:22px}.card{width:min(430px,100%);background:rgba(17,21,34,.96);border:1px solid var(--line);border-radius:22px;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:30px}.logo{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent2));font-weight:800;font-size:20px;margin-bottom:22px}h1{font-size:26px;margin:0 0 10px}.sub{color:var(--muted);line-height:1.5;margin:0 0 26px}.btn{display:block;width:100%;margin-top:14px;padding:14px 16px;border-radius:12px;border:0;background:linear-gradient(135deg,var(--accent),var(--accent2));color:white;font-weight:700;font-size:16px;text-align:center;text-decoration:none}.foot{margin-top:18px;font-size:12px;color:#7f879c;text-align:center}</style></head><body><main class="card"><div class="logo">A</div><h1>Authorize ARIA MCP</h1><p class="sub">Authorize this Grok connection to ARIA read-only MCP tools (aria_status, aria_context).</p><a class="btn" href="${go}?pending_id=${encodeURIComponent(id)}&decision=allow">Authorize</a><a class="btn" href="${go}?pending_id=${encodeURIComponent(id)}&decision=deny" style="background:#2a3144;margin-top:10px">Deny</a><div class="foot">Secure OAuth · ARIA MCP</div></main></body></html>`}
async function proxyOAuth(request,url){
  const upstreamBase = new URL(SUPABASE_OAUTH);
  let suffix = "";
  if(url.pathname==="/authorize"||url.pathname==="/authorize/"||url.pathname==="/authorize-grok-v2"||url.pathname==="/authorize-grok-v2/"){
    suffix = "authorize";
  } else if(url.pathname==="/authorize/consent"||url.pathname==="/authorize/consent/"){
    suffix = "authorize/consent";
  } else if(url.pathname==="/token"||url.pathname==="/token/"){
    suffix = "token";
  } else if(url.pathname==="/register"||url.pathname==="/register/"){
    suffix = "register";
  } else {
    suffix = url.pathname.replace(/^\//,"");
  }
  const upstreamUrl = new URL(upstreamBase.toString());
  upstreamUrl.pathname = `${upstreamBase.pathname.replace(/\/$/,"")}/${suffix}`;

  // Grok embedded browser: consent links use GET. Convert to POST for upstream.
  if(suffix === "authorize/consent" && request.method === "GET"){
    const pendingId = url.searchParams.get("pending_id") || "";
    const decision = url.searchParams.get("decision") || "";
    if(!pendingId || (decision !== "allow" && decision !== "deny")){
      return new Response("<h1>Invalid consent request</h1><p>Missing pending_id or decision.</p>",{
        status:400,
        headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}
      });
    }
    const body = new URLSearchParams({pending_id:pendingId,decision:decision}).toString();
    const upstream = await fetch(upstreamUrl.toString(),{
      method:"POST",
      headers:{"content-type":"application/x-www-form-urlencoded","accept":"text/html,application/json"},
      body,
      redirect:"manual"
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("cache-control","no-store");
    return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
  }

  upstreamUrl.search = url.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  const upstream = await fetch(new Request(upstreamUrl.toString(),{
    method:request.method,
    headers,
    body:request.method==="GET"||request.method==="HEAD"?undefined:request.body,
    redirect:"manual"
  }));

  if(url.pathname==="/register"||url.pathname==="/register/"){
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("content-type","application/json; charset=utf-8");
    responseHeaders.set("cache-control","no-store");
    const raw = await upstream.text();
    try{
      const body = JSON.parse(raw);
      body.authorization_endpoint = PUBLIC_AUTH_ENDPOINT;
      body.token_endpoint = PUBLIC_TOKEN_ENDPOINT;
      body.registration_endpoint = PUBLIC_REGISTER_ENDPOINT;
      body.issuer = PUBLIC_ISSUER;
      body.resource = PUBLIC_RESOURCE;
      return new Response(JSON.stringify(body),{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
    }catch(_){
      return new Response(raw,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
    }
  }

  // Authorize GET: preserve upstream consent page but normalize it to direct links.
  if((url.pathname==="/authorize"||url.pathname==="/authorize/"||url.pathname==="/authorize-grok-v2"||url.pathname==="/authorize-grok-v2/") && request.method==="GET"){
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("cache-control","no-store");
    if(upstream.status>=300 && upstream.status<400){
      return new Response(null,{status:upstream.status,headers:responseHeaders});
    }
    responseHeaders.set("content-type","text/html; charset=utf-8");
    let html = await upstream.text();
    html = html.replace(/<form method="post" action="([^"]*\/authorize\/consent)"[^>]*>\s*<input[^>]*name="pending_id"[^>]*value="([^"]+)"[^>]*>\s*<input[^>]*name="decision"[^>]*value="(allow|deny)"[^>]*>\s*<button[^>]*>([^<]+)<\/button>\s*<\/form>/gi,
      (_, action, pendingId, decision, label) => `<a class="btn" href="${action}?pending_id=${encodeURIComponent(pendingId)}&decision=${decision}">${label}</a>`);
    html = html.replace(/method\s*=\s*["']post["']/gi,'method="get"');
    html = html.replace(/action\s*=\s*["'][^"']*authorize\/consent["']/gi,'action="'+PUBLIC_ISSUER+'/authorize/consent"');
    return new Response(html,{status:upstream.status,statusText:upstream.statusText,headers:responseHeaders});
  }

  return upstream;
}
async function proxyRuntime(request,env){if(request.method!=="POST")return json({error:"method_not_allowed"},405);if(!env.ARIA_RUNTIME_SHARED_SECRET)return json({error:"runtime_secret_not_configured"},500);const incomingToken=extractBearer(request);if(!incomingToken||!constantTimeEqual(incomingToken,env.ARIA_RUNTIME_SHARED_SECRET))return json({error:"unauthorized"},401);const body=await request.text();const upstream=await fetch(RUNTIME_GATEWAY,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}`},body});return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:{"content-type":upstream.headers.get("content-type")||"application/json; charset=utf-8","cache-control":"no-store"}})}
async function startMission(request,env){if(request.method!=="POST")return json({error:"method_not_allowed"},405);if(!env.ARIA_RUNTIME_SHARED_SECRET)return json({error:"runtime_secret_not_configured"},500);const incomingToken=extractBearer(request);if(!incomingToken||!constantTimeEqual(incomingToken,env.ARIA_RUNTIME_SHARED_SECRET))return json({error:"unauthorized"},401);const body=await request.text();const upstream=await fetch(MISSION_INTAKE,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}`},body});return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:{"content-type":upstream.headers.get("content-type")||"application/json; charset=utf-8","cache-control":"no-store"}})}
async function directAria(request,env){if(request.method==="GET")return fetch(DIRECT_ARIA,{method:"GET"});if(request.method!=="POST")return json({error:"method_not_allowed"},405);if(!env.ARIA_RUNTIME_SHARED_SECRET)return json({error:"runtime_secret_not_configured"},500);const incomingToken=extractBearer(request);if(!incomingToken||!constantTimeEqual(incomingToken,env.ARIA_RUNTIME_SHARED_SECRET))return json({error:"unauthorized"},401);const body=await request.text();const upstream=await fetch(DIRECT_ARIA,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}`},body});return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:{"content-type":upstream.headers.get("content-type")||"application/json; charset=utf-8","cache-control":"no-store"}})}
async function runScheduledMission(env){if(!env.ARIA_RUNTIME_SHARED_SECRET){console.error("[ARIA CRON] runtime secret not configured");return}try{const response=await fetch(CANONICAL_RUNTIME,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}`},body:"{}"});console.log(`[ARIA CRON] canonical-runtime status=${response.status}`);if(!response.ok){const text=await response.text().catch(()=>"");console.error(`[ARIA CRON] canonical-runtime failure status=${response.status} body=${text.slice(0,500)}`)}}catch(error){console.error(`[ARIA CRON] canonical-runtime request failed: ${error instanceof Error?error.message:String(error)}`)}}
export default {async scheduled(_controller,env,ctx){ctx.waitUntil(runScheduledMission(env))},async fetch(request,env){const url=new URL(request.url);if(url.pathname==="/autonomy-health")return autonomyHealth(request);if(request.method==="GET"&&(url.pathname==="/.well-known/oauth-protected-resource"||url.pathname==="/.well-known/oauth-protected-resource/mcp"||url.pathname==="/mcp/.well-known/oauth-protected-resource"))return json(protectedResourceMetadata(),200,{"access-control-allow-origin":"*"});if(request.method==="GET"&&(url.pathname==="/.well-known/oauth-authorization-server"||url.pathname==="/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v2"||url.pathname==="/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v3"||url.pathname==="/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v4"||url.pathname==="/.well-known/oauth-authorization-server/functions/v1/aria-mcp-inbound-grok-v1"))return json(authorizationServerMetadata(),200,{"access-control-allow-origin":"*"});if(url.pathname==="/authorize"||url.pathname==="/authorize/"||url.pathname.startsWith("/authorize/")||url.pathname==="/authorize-grok-v2"||url.pathname==="/authorize-grok-v2/"||url.pathname.startsWith("/authorize-grok-v2/"))return proxyOAuth(request,url);if(["/token","/token/","/register","/register/"].includes(url.pathname))return proxyOAuth(request,url);if(url.pathname==="/aria"||url.pathname==="/aria/")return directAria(request,env);if(url.pathname==="/mission"||url.pathname==="/mission/")return startMission(request,env);if(url.pathname==="/runtime"||url.pathname==="/runtime/")return proxyRuntime(request,env);if(url.pathname==="/admin/cloudflare"||url.pathname==="/admin/cloudflare/")return cloudflareAdmin(request,env);if(url.pathname==="/admin/cloudflare/token"||url.pathname==="/admin/cloudflare/token/")return cloudflareTokenManager(request,env);if(url.pathname==="/mcp"||url.pathname==="/mcp/"){const upstreamUrl=new URL(SUPABASE_MCP);upstreamUrl.search=url.search;const headers=new Headers(request.headers);const upstream=await fetch(new Request(upstreamUrl.toString(),{method:request.method,headers,body:request.method==="GET"||request.method==="HEAD"?undefined:request.body,redirect:"manual"}));if(upstream.status===401)return rewriteAuthChallenge(upstream);return upstream}if(url.pathname==="/"||url.pathname==="")return Response.redirect(`${url.origin}/mcp`,308);return new Response("Not Found",{status:404,headers:{"content-type":"text/plain; charset=utf-8"}})}};
