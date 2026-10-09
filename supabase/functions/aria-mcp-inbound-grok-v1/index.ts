import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * ARIA MCP Inbound for Grok Web Custom Connector
 * Combined Resource Server + Authorization Server (OAuth 2.1 + PKCE S256).
 *
 * Canonical resource (RFC 8707):
 *   https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1
 *
 * Does NOT use XAI_API_KEY or api.x.ai.
 * Access tokens are ARIA-signed JWTs (HMAC), not Supabase user JWTs.
 * Refresh tokens are opaque, hashed at rest, rotated on use.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OAUTH_SECRET =
  Deno.env.get("ARIA_MCP_OAUTH_SECRET") ??
  Deno.env.get("ARIA_MCP_INBOUND_TOKEN") ??
  SERVICE_ROLE_KEY;

const RESOURCE =
  Deno.env.get("ARIA_MCP_INBOUND_RESOURCE") ??
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1";

// Worker facade: RESOURCE=.../mcp (aud), ISSUER=Worker origin (iss / AS id).
const ISSUER =
  Deno.env.get("ARIA_MCP_INBOUND_ISSUER") ??
  RESOURCE;
const SCOPE = "aria.mcp.inbound";
const CUEVACOIN_CONTROL_SCOPE = "aria.project.cuevacoin.control";
const SUPPORTED_SCOPES = [SCOPE, CUEVACOIN_CONTROL_SCOPE];
const CUEVACOIN_PROJECT = Object.freeze({owner:"Robvg9",repo:"CuevaCoin",projectRef:"zqgmjwfvluboiporytcq",managementTokenSecretName:"cuevacoin_supabase_management_pat",managementCredentialName:"CuevaCoin Supabase scoped Management API PAT"});
const CUEVACOIN_GITHUB_RUNTIME = `${SUPABASE_URL}/functions/v1/aria-github-app-runtime-v1`;
const ACCESS_TTL_SEC = 3600;
const REFRESH_TTL_SEC = 30 * 24 * 3600;
const CODE_TTL_MS = 5 * 60_000;
const PENDING_TTL_MS = 10 * 60_000;

const PROTOCOL_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"];
const DEFAULT_PROTOCOL = "2025-03-26";

const TOOLS = [
  {
    name: "aria_status",
    description: "Read-only ARIA inbound status for Grok Custom MCP Connector. No secrets.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "aria_context",
    description: "Read-only authorized ARIA context snapshot for Grok. No memory writes.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
  {name:"cuevacoin_connection_status",description:"Read-only check for CuevaCoin. Tests ARIA GitHub App access to Robvg9/CuevaCoin and whether a scoped Supabase Management API credential is configured. Never returns credential material; performs no writes.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
  {name:"cuevacoin_project_control",description:"Governed control of the CuevaCoin repository and Supabase backend. Requires separate OAuth scope aria.project.cuevacoin.control. Supports repository read/write branches and PRs, read-only SQL, explicitly confirmed production SQL/migrations, and Edge Function inspect/deploy. Repo/ref are fixed to Robvg9/CuevaCoin and zqgmjwfvluboiporytcq. Secret values are never returned.",inputSchema:{type:"object",properties:{
    operation:{type:"string",enum:["github_installation_info","github_repo_read","github_tree_read","github_file_read","github_ref_read","github_pr_find","github_pr_read","github_pr_files","github_pr_checks","github_workflow_runs","github_create_branch","github_file_write","github_open_pr","github_pr_merge","github_workflow_dispatch","supabase_project_status","supabase_sql_read","supabase_sql_execute","supabase_migrations_list","supabase_migration_apply","supabase_edge_functions_list","supabase_edge_function_read","supabase_edge_function_deploy"]},
    branch:{type:"string",maxLength:200},base:{type:"string",maxLength:200},ref:{type:"string",maxLength:200},path:{type:"string",maxLength:500},content:{type:"string",maxLength:200000},message:{type:"string",maxLength:500},title:{type:"string",maxLength:300},body:{type:"string",maxLength:10000},state:{type:"string",enum:["open","closed","all","metadata","body"]},number:{type:"integer",minimum:1},commit_sha:{type:"string",maxLength:64},paths:{type:"array",items:{type:"string",maxLength:500},maxItems:50},workflow_id:{type:"string",maxLength:100},risk_level:{type:"string",enum:["low","moderate","high","destructive","LOW_RISK_WRITE"]},change_summary:{type:"string",minLength:12,maxLength:500},manual_review_required:{type:"boolean"},change_approval:{type:"string",maxLength:100},confirm_merge:{type:"string",maxLength:100},auto_merge:{type:"boolean"},confirm_project_ref:{type:"string",maxLength:64},confirm_production_write:{type:"boolean"},query:{type:"string",maxLength:50000},migration_name:{type:"string",maxLength:120},rollback:{type:"string",maxLength:30000},function_slug:{type:"string",maxLength:80},function_name:{type:"string",maxLength:120},entrypoint_path:{type:"string",maxLength:200},import_map_path:{type:"string",maxLength:200},verify_jwt:{type:"boolean"},files:{type:"array",maxItems:30,items:{type:"object",properties:{name:{type:"string",minLength:1,maxLength:200},content:{type:"string",maxLength:200000}},required:["name","content"],additionalProperties:false}}
  },required:["operation"],additionalProperties:false}},
];

const db = () =>
  createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const CUEVACOIN_GITHUB_OPERATION_MAP:Record<string,string>=Object.freeze({
  github_installation_info:"installation_info",github_repo_read:"repo_read",github_tree_read:"tree_read",github_file_read:"file_read",github_ref_read:"ref_read",github_pr_find:"pr_find",github_pr_read:"pr_read",github_pr_files:"pr_files",github_pr_checks:"pr_checks",github_workflow_runs:"main_workflow_runs",github_create_branch:"create_branch",github_file_write:"reviewed_file_write",github_open_pr:"open_pr",github_pr_merge:"pr_merge",github_workflow_dispatch:"workflow_dispatch"
});
function cuevacoinSafeProviderError(error:unknown):string {
 const m=error instanceof Error?error.message:String(error??"");
 if(/github_installation_not_found/i.test(m))return "github_app_installation_missing";
 if(/github_401|github_403|installation_token_403/i.test(m))return "github_app_permission_denied";
 if(/github_404|installation_token_404/i.test(m))return "github_repository_unavailable";
 if(/github_422|installation_token_422/i.test(m))return "github_app_repository_not_selected";
 if(/supabase_management_http_401/i.test(m))return "supabase_management_token_invalid";
 if(/supabase_management_http_403/i.test(m))return "supabase_project_permission_denied";
 if(/supabase_management_http_404/i.test(m))return "supabase_project_unavailable";
 if(/timeout|abort/i.test(m))return "provider_timeout";
 return "provider_request_failed";
}
async function callCuevaCoinGitHub(operation:string,args:Record<string,unknown>={}){
 if(!SERVICE_ROLE_KEY)throw Error("aria_internal_service_unavailable");
 const response=await fetch(CUEVACOIN_GITHUB_RUNTIME,{method:"POST",headers:{authorization:`Bearer ${SERVICE_ROLE_KEY}`,"content-type":"application/json"},body:JSON.stringify({...args,operation,owner:CUEVACOIN_PROJECT.owner,repo:CUEVACOIN_PROJECT.repo}),signal:AbortSignal.timeout(15000)});
 const payload:any=await response.json().catch(()=>null);
 if(!response.ok||payload?.ok!==true)throw Error(String(payload?.error||`github_http_${response.status}`));
 return payload;
}
async function readCuevaCoinManagementToken():Promise<string|null>{
 try{const {data,error}=await db().schema("aria_internal").rpc("credential_read_secret",{p_name:CUEVACOIN_PROJECT.managementTokenSecretName});if(error||typeof data!=="string"||data.trim().length<20)return null;return data.trim();}catch{return null;}
}
async function callCuevaCoinManagementApi(token:string,path:string,init:RequestInit={}){
 const response=await fetch(`https://api.supabase.com${path}`,{...init,headers:{authorization:`Bearer ${token}`,accept:"application/json",...(init.body?{"content-type":"application/json"}:{}),...(init.headers||{})},signal:init.signal||AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>null);if(!response.ok)throw Error(`supabase_management_http_${response.status}`);return{status:response.status,data};
}
function requireCuevaCoinWriteConfirmation(args:Record<string,unknown>,action:string){
 if(args.confirm_production_write!==true)throw Error("production_write_confirmation_required");
 if(String(args.confirm_project_ref||"")!==CUEVACOIN_PROJECT.projectRef)throw Error("production_project_confirmation_mismatch");
 if(String(args.change_summary||"").trim().length<12)throw Error("change_summary_required");
 if(!["low","moderate","high","destructive"].includes(String(args.risk_level||"")))throw Error("valid_risk_level_required");
 return{name:action,project_ref:CUEVACOIN_PROJECT.projectRef,change_summary:String(args.change_summary).trim().slice(0,500),risk_level:String(args.risk_level),confirmed:true,confirmed_at:new Date().toISOString()};
}
async function cuevaCoinConnectionStatus(){
 const [githubResult,token]=await Promise.all([callCuevaCoinGitHub("repo_read").then(value=>({ok:true,value})).catch(error=>({ok:false,error:cuevacoinSafeProviderError(error)})),readCuevaCoinManagementToken()]);
 let backend:Record<string,unknown>={state:"human_gate",project_ref:CUEVACOIN_PROJECT.projectRef,credential_name:CUEVACOIN_PROJECT.managementCredentialName,secret_name:CUEVACOIN_PROJECT.managementTokenSecretName,reason:"scoped_management_token_not_configured"};
 if(token){try{const {data}=await callCuevaCoinManagementApi(token,`/v1/projects/${CUEVACOIN_PROJECT.projectRef}`);const projectId=String(data?.id||data?.ref||"");backend=projectId===CUEVACOIN_PROJECT.projectRef?{state:"connected",project_ref:projectId,project_name:data?.name??null,project_status:data?.status??null}:{state:"project_identity_mismatch",expected_project_ref:CUEVACOIN_PROJECT.projectRef};}catch(error){backend={state:cuevacoinSafeProviderError(error),project_ref:CUEVACOIN_PROJECT.projectRef};}}
 const gh=githubResult.ok?{state:"connected_read_verified",repository:`${CUEVACOIN_PROJECT.owner}/${CUEVACOIN_PROJECT.repo}`,visibility:githubResult.value?.data?.private===true?"private":"public",default_branch:githubResult.value?.data?.default_branch??null,write_access:"not_yet_verified"}:{state:githubResult.error,repository:`${CUEVACOIN_PROJECT.owner}/${CUEVACOIN_PROJECT.repo}`,write_access:"not_verified"};
 return{ok:true,project:"CuevaCoin",project_ref:CUEVACOIN_PROJECT.projectRef,github:gh,supabase:backend,deployment:{state:"not_verified",note:"A dedicated deployment workflow and scoped deployment credential must be verified before claiming deployment control."},control_scope:CUEVACOIN_CONTROL_SCOPE,ready_for_full_control:gh.state==="connected_read_verified"&&backend.state==="connected",checked_at:new Date().toISOString()};
}
async function cuevaCoinProjectControl(args:Record<string,unknown>,clientId:string){
 const operation=String(args.operation||"");
 if(Object.prototype.hasOwnProperty.call(CUEVACOIN_GITHUB_OPERATION_MAP,operation)){
  const payload:Record<string,unknown>={...args};delete payload.operation;
  if(operation==="github_create_branch"||operation==="github_file_write"||operation==="github_open_pr"||operation==="github_pr_merge"){
   if(!/^aria\\/repair\\/cuevacoin-[A-Za-z0-9._/-]{1,160}$/.test(String(args.branch||"")))throw Error("cuevacoin_governed_branch_required");
  }
  if(operation==="github_file_write"){
   const risk=String(args.risk_level||"low").toLowerCase();
   if(risk==="low"){payload.risk_level="low";}
   else{
    if(!["moderate","high","destructive"].includes(risk))throw Error("valid_risk_level_required");
    if(args.manual_review_required!==true)throw Error("manual_review_required");
    if(String(args.change_summary||"").trim().length<12)throw Error("change_summary_required");
    if(String(args.change_approval||"")!=="I AUTHORIZE THIS CUEVACOIN CHANGE")throw Error("cuevacoin_change_confirmation_required");
    payload.risk_level=risk;payload.manual_review_required=true;payload.change_summary=String(args.change_summary).slice(0,500);
   }
   if(String(args.content||"").length>180000)throw Error("cuevacoin_file_too_large");
   delete payload.change_approval;delete payload.manual_review_required;
  }
  if(operation==="github_pr_merge"){
   const n=Number(args.number);
   if(!Number.isInteger(n)||n<1)throw Error("pr_number_required");
   if(args.auto_merge!==true||String(args.risk_level||"")!=="LOW_RISK_WRITE")throw Error("low_risk_ci_gated_merge_only");
   if(String(args.confirm_merge||"")!==`MERGE CUEVACOIN PR #${n}`)throw Error("merge_confirmation_phrase_required");
   delete payload.confirm_merge;
  }
  if(operation==="github_workflow_dispatch"){
   if(String(args.workflow_id||"")!=="cuevacoin-deploy.yml")throw Error("deployment_workflow_not_allowlisted");
   if(String(args.ref||"main")!=="main")throw Error("production_workflow_must_dispatch_main");
   requireCuevaCoinWriteConfirmation(args,operation);
  }
  payload.owner=CUEVACOIN_PROJECT.owner;payload.repo=CUEVACOIN_PROJECT.repo;
  const result=await callCuevaCoinGitHub(CUEVACOIN_GITHUB_OPERATION_MAP[operation],payload);
  return{ok:true,project:"CuevaCoin",subsystem:"github",operation,client_id:clientId,data:result.data??null,manual_review_required:operation==="github_file_write"&&String(args.risk_level||"low").toLowerCase()!=="low",completed_at:new Date().toISOString()};
 }
 const token=await readCuevaCoinManagementToken();if(!token)throw Error("cuevacoin_supabase_management_token_human_gate");
 const ref=CUEVACOIN_PROJECT.projectRef;
 if(operation==="supabase_project_status"){const {data}=await callCuevaCoinManagementApi(token,`/v1/projects/${ref}`);if(String(data?.id||data?.ref||"")!==ref)throw Error("cuevacoin_project_identity_mismatch");return{ok:true,project:"CuevaCoin",subsystem:"supabase",operation,project_ref:ref,project_name:data?.name??null,project_status:data?.status??null};}
 if(operation==="supabase_sql_read"){
  const query=String(args.query||"").trim();
  if(!query||query.length>16000||/;\\s*\\S/.test(query)||!/^(select|with|explain|show|values)\\b/i.test(query))throw Error("single_read_only_sql_statement_required");
  const {data}=await callCuevaCoinManagementApi(token,`/v1/projects/${ref}/database/query/read-only`,{method:"POST",body:JSON.stringify({query})});
  return{ok:true,project:"CuevaCoin",subsystem:"supabase",operation,project_ref:ref,data};
 }
 if(operation==="supabase_sql_execute"){
  const audit=requireCuevaCoinWriteConfirmation(args,operation),query=String(args.query||"").trim();
  if(!query||query.length>30000)throw Error("sql_query_required_or_too_large");
  const {data}=await callCuevaCoinManagementApi(token,`/v1/projects/${ref}/database/query`,{method:"POST",body:JSON.stringify({query,read_only:false})});
  return{ok:true,project:"CuevaCoin",subsystem:"supabase",operation,audit,data};
 }
 if(operation==="supabase_migrations_list"){const {data}=await callCuevaCoinManagementApi(token,`/v1/projects/${ref}/database/migrations`);return{ok:true,project:"CuevaCoin",subsystem:"supabase",operation,data};}
 if(operation==="supabase_migration_apply"){
  const audit=requireCuevaCoinWriteConfirmation(args,operation),name=String(args.migration_name||""),query=String(args.query||"").trim();
  if(!/^\\d{14}_[a-z0-9_]{3,100}$/.test(name))throw Error("timestamped_migration_name_required");
  if(!query||query.length>30000)throw Error("migration_query_required_or_too_large");
  const body:Record<string,unknown>={name,query};if(typeof args.rollback==="string"&&args.rollback.trim())body.rollback=args.rollback.slice(0,30000);
  const {data}=await callCuevaCoinManagementApi(token,`/v1/projects/${ref}/database/migrations`,{method:"POST",body:JSON.stringify(body)});
  return{ok:true,project:"CuevaCoin",subsystem:"supabase",operation,audit,data};
 }
 if(operation==="supabase_edge_functions_list"){const {data}=await callCuevaCoinManagementApi(token,`/v1/projects/${ref}/functions`);return{ok:true,project:"CuevaCoin",subsystem:"supabase",operation,data};}
 if(operation==="supabase_edge_function_read"){
  const slug=String(args.function_slug||"");if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))throw Error("valid_edge_function_slug_required");
  const ep=String(args.state||"metadata")==="body"?`/v1/projects/${ref}/functions/${encodeURIComponent(slug)}/body`:`/v1/projects/${ref}/functions/${encodeURIComponent(slug)}`;
  const {data}=await callCuevaCoinManagementApi(token,ep);return{ok:true,project:"CuevaCoin",subsystem:"supabase",operation,function_slug:slug,data};
 }
 if(operation==="supabase_edge_function_deploy"){
  const audit=requireCuevaCoinWriteConfirmation(args,operation),slug=String(args.function_slug||"");
  if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))throw Error("valid_edge_function_slug_required");
  if(args.verify_jwt!==true)throw Error("edge_function_deploy_requires_verify_jwt_true");
  const files=Array.isArray(args.files)?args.files as Array<Record<string,unknown>>:[];
  if(!files.length||files.length>30)throw Error("edge_function_files_required");
  let total=0;const form=new FormData(),meta:Record<string,unknown>={name:String(args.function_name||slug).slice(0,120),entrypoint_path:String(args.entrypoint_path||"index.ts"),verify_jwt:true};
  if(args.import_map_path){meta.import_map=true;meta.import_map_path=String(args.import_map_path);}
  form.append("metadata",JSON.stringify(meta));
  for(const f of files){const name=String(f.name||""),content=String(f.content||"");
   if(!name||name.startsWith("/")||name.includes("..")||name.includes("\\\\")||content.length>200000)throw Error("unsafe_edge_function_file");
   if(/(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\\b(?:sbp_[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\\b)/i.test(content))throw Error("secret_material_rejected");
   total+=content.length;if(total>450000)throw Error("edge_function_bundle_too_large");
   form.append("file",new Blob([content],{type:"application/octet-stream"}),name);
  }
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`,{method:"POST",headers:{authorization:`Bearer ${token}`,accept:"application/json"},body:form,signal:AbortSignal.timeout(45000)});
  const data=await response.json().catch(()=>null);if(!response.ok)throw Error(`supabase_management_http_${response.status}`);
  return{ok:true,project:"CuevaCoin",subsystem:"supabase",operation,audit,function_slug:slug,deployment:data};
 }
 throw Error("cuevacoin_operation_not_allowed");
}

const te = new TextEncoder();
const td = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromB64url(value: string): Uint8Array {
  const pad = "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad), (c) =>
    c.charCodeAt(0),
  );
}

async function sha256(value: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof value === "string" ? te.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

async function hmacSign(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(OAUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, te.encode(data)));
}

async function hmacVerify(data: string, sig: Uint8Array): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    te.encode(OAUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, sig, te.encode(data));
}

async function pkceOk(verifier: string, challenge: string): Promise<boolean> {
  return b64url(await sha256(verifier)) === challenge;
}

function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function issueAccessToken(clientId: string, scope = SCOPE): Promise<{ token: string; expiresIn: number; scope: string }> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(te.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    te.encode(
      JSON.stringify({
        iss: ISSUER,
        aud: RESOURCE,
        sub: clientId,
        scope,
        iat: now,
        exp: now + ACCESS_TTL_SEC,
        token_use: "access",
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(await hmacSign(signingInput));
  return { token: `${signingInput}.${sig}`, expiresIn: ACCESS_TTL_SEC, scope };
}

async function verifyAccessToken(token: string): Promise<{ clientId: string; scope: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;
  let sig: Uint8Array;
  try {
    sig = fromB64url(sigB64);
  } catch {
    return null;
  }
  if (!(await hmacVerify(signingInput, sig))) return null;
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(td.decode(fromB64url(payloadB64)));
  } catch {
    return null;
  }
  if (claims.iss !== ISSUER) return null;
  if (claims.aud !== RESOURCE) return null;
  const tokenScopes = typeof claims.scope === "string" ? claims.scope.split(/\s+/).filter(Boolean) : [];
  if (!tokenScopes.includes(SCOPE) || tokenScopes.some((value) => value !== "openid" && !SUPPORTED_SCOPES.includes(value))) return null;
  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return { clientId: claims.sub, scope: tokenScopes.filter((value) => value !== "openid").join(" ") };
}

async function issueRefreshToken(clientId: string, scope = SCOPE, rotatedFrom?: string): Promise<string> {
  const raw = `aria_rt_${randomToken(40)}`;
  const hash = b64url(await sha256(raw));
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString();
  const row: Record<string, unknown> = {
    token_hash: hash,
    client_id: clientId,
    scope,
    resource: RESOURCE,
    expires_at: expiresAt,
  };
  if (rotatedFrom) row.rotated_from = rotatedFrom;
  const { error } = await db().from("aria_mcp_oauth_refresh_tokens").insert(row);
  if (error) throw new Error(`refresh_persist_failed: ${error.message}`);
  return raw;
}

async function consumeRefreshToken(raw: string): Promise<{ clientId: string; scope: string } | null> {
  const hash = b64url(await sha256(raw));
  const { data } = await db()
    .from("aria_mcp_oauth_refresh_tokens")
    .select("id, client_id, scope, expires_at, revoked_at, resource")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  if (data.resource !== RESOURCE) return null;
  await db()
    .from("aria_mcp_oauth_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", data.id);
  return { clientId: data.client_id, scope: String(data.scope || SCOPE) };
}

function jsonHeaders(extra: HeadersInit = {}): HeadersInit {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-expose-headers":
      "Mcp-Session-Id,WWW-Authenticate,MCP-Protocol-Version",
    ...extra,
  };
}

function json(status: number, body: unknown, extra: HeadersInit = {}) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: jsonHeaders(extra),
  });
}

function html(status: number, body: string) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

function bearer(req: Request): string {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function sessionHeaders(req: Request, protocol = DEFAULT_PROTOCOL): HeadersInit {
  return jsonHeaders({
    "Mcp-Session-Id": req.headers.get("mcp-session-id") ?? "aria-inbound-stateless",
    "MCP-Protocol-Version": protocol,
  });
}

function rpc(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function wwwAuthenticate(): string {
  const meta =
    ISSUER !== RESOURCE
      ? `${ISSUER}/.well-known/oauth-protected-resource/mcp`
      : `${RESOURCE}/.well-known/oauth-protected-resource`;
  return `Bearer realm="aria-mcp-inbound", resource="${RESOURCE}", resource_metadata="${meta}"`;
}

function isValidRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function protectedResourceMetadata() {
  return {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    bearer_methods_supported: ["header"],
    scopes_supported: SUPPORTED_SCOPES,
  };
}

function authorizationServerMetadata() {
  return {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    registration_endpoint: `${ISSUER}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SUPPORTED_SCOPES,
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
  };
}

async function resolveClient(
  clientId: string,
  redirectUri: string,
): Promise<{ client_id: string; redirect_uris: string[] } | null> {
  const { data } = await db()
    .from("aria_mcp_oauth_clients")
    .select("client_id, redirect_uris")
    .eq("client_id", clientId)
    .maybeSingle();
  if (data && Array.isArray(data.redirect_uris) && data.redirect_uris.includes(redirectUri)) {
    return data as { client_id: string; redirect_uris: string[] };
  }
  if (/^https:\/\//i.test(clientId)) {
    try {
      const res = await fetch(clientId, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      const meta = (await res.json()) as {
        client_id?: string;
        redirect_uris?: string[];
        client_name?: string;
      };
      const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris : [];
      if (!uris.includes(redirectUri)) return null;
      await db().from("aria_mcp_oauth_clients").upsert({
        client_id: clientId,
        client_name: (meta.client_name ?? "cimd-client").slice(0, 120),
        redirect_uris: uris,
        metadata_source: "cimd",
        client_uri: clientId,
      });
      return { client_id: clientId, redirect_uris: uris };
    } catch {
      return null;
    }
  }
  return null;
}

function consentPage(pendingId: string, clientName: string, scope = SCOPE): string {
 const safeName=clientName.replace(/[<>&"]/g,"");
 const scopeList=scope.split(/\s+/).filter(Boolean), control=scopeList.includes(CUEVACOIN_CONTROL_SCOPE), scopeText=scopeList.join(" ");
 const notice=control?`<div style="padding:12px;border:2px solid #b91c1c;border-radius:8px;background:#fef2f2;color:#7f1d1d;margin:14px 0"><strong>Elevated project access requested</strong><p>This grants source-code and backend controls for CuevaCoin: repository changes, pull requests, SQL, migrations and Edge Functions. Production writes still require a separate explicit confirmation. Targets are fixed to Robvg9/CuevaCoin and zqgmjwfvluboiporytcq.</p><label for="control-confirmation">Type <code>AUTHORIZE CUEVACOIN CONTROL</code> to grant this scope.</label><input id="control-confirmation" name="control_confirmation" type="text" required autocomplete="off" pattern="AUTHORIZE CUEVACOIN CONTROL" style="display:block;width:100%;box-sizing:border-box;padding:10px;margin-top:6px"/></div>`:`<p class="muted">Base ARIA MCP access only. CuevaCoin write authority is not granted unless its separate control scope is requested and confirmed.</p>`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="referrer" content="no-referrer"/><title>Authorize ARIA</title><style>body{font-family:system-ui,sans-serif;max-width:560px;margin:36px auto;padding:0 16px;color:#111}button{font:inherit;padding:12px 16px;width:100%;cursor:pointer;border-radius:8px;border:0;background:#111;color:#fff}.card{border:1px solid #e5e5e5;border-radius:12px;padding:20px}.muted{color:#666;font-size:14px;line-height:1.5}</style></head><body><div class="card"><h1>Authorize ARIA MCP</h1><p><strong>${safeName}</strong> is requesting access to ARIA tools.</p><p class="muted">Scopes: <code>${scopeText}</code><br/>Resource: ARIA inbound MCP</p>${notice}<form method="post" action="${ISSUER}/authorize/consent"><input type="hidden" name="pending_id" value="${pendingId}"/><input type="hidden" name="decision" value="allow"/><button type="submit">Authorize requested scopes</button></form><form method="post" action="${ISSUER}/authorize/consent" style="margin-top:8px"><input type="hidden" name="pending_id" value="${pendingId}"/><input type="hidden" name="decision" value="deny"/><button type="submit" style="background:#eee;color:#111">Deny</button></form></div></body></html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Grok Web requires the OAuth challenge during the initial MCP handshake.
  const publicOAuthPath =
    path.includes("/.well-known/oauth-protected-resource") ||
    path.includes("/.well-known/oauth-authorization-server") ||
    path.endsWith("/register") ||
    path.endsWith("/authorize") ||
    path.endsWith("/authorize/consent") ||
    path.endsWith("/token");

  if (!publicOAuthPath && req.method !== "OPTIONS") {
    const access = await verifyAccessToken(bearer(req));
    if (!access) {
      return json(401, { error: "unauthorized" }, {
        "WWW-Authenticate": wwwAuthenticate(),
      });
    }
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: jsonHeaders({
        "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
        "access-control-allow-headers":
          "authorization,content-type,accept,mcp-protocol-version,mcp-session-id",
      }),
    });
  }

  if (
    req.method === "GET" &&
    (path.includes("/.well-known/oauth-protected-resource") ||
      path.endsWith("/.well-known/oauth-protected-resource"))
  ) {
    return json(200, protectedResourceMetadata());
  }
  if (
    req.method === "GET" &&
    (path.includes("/.well-known/oauth-authorization-server") ||
      path.endsWith("/.well-known/oauth-authorization-server"))
  ) {
    return json(200, authorizationServerMetadata());
  }

  if (req.method === "POST" && path.endsWith("/register")) {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid_client_metadata" });
    }
    const redirectUris = Array.isArray(body.redirect_uris)
      ? body.redirect_uris.filter((v): v is string => typeof v === "string" && isValidRedirectUri(v))
      : [];
    const name =
      typeof body.client_name === "string" && body.client_name.trim()
        ? body.client_name.trim().slice(0, 120)
        : "Grok Custom Connector";
    if (!redirectUris.length) return json(400, { error: "invalid_redirect_uri" });
    const clientId = `aria_${crypto.randomUUID()}`;
    const { error } = await db().from("aria_mcp_oauth_clients").insert({
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      metadata_source: "dcr",
      token_endpoint_auth_method: "none",
    });
    if (error) return json(500, { error: "registration_failed", detail: error.message });
    return json(201, {
      client_id: clientId,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  }

  if (req.method === "GET" && path.endsWith("/authorize")) {
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const responseType = url.searchParams.get("response_type") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    const method = url.searchParams.get("code_challenge_method") ?? "";
    const resource = url.searchParams.get("resource") ?? "";
    const scope = url.searchParams.get("scope") ?? SCOPE;

    if (responseType !== "code" || method !== "S256" || !state || !challenge) {
      return json(400, { error: "invalid_request" });
    }
    if (resource && resource !== RESOURCE) {
      return json(400, { error: "invalid_target", error_description: "resource mismatch" });
    }
    const requestedScopes=(scope||SCOPE).trim().split(/\s+/).filter(Boolean);
    const grantedScopes=Array.from(new Set(requestedScopes.filter(value=>value!=="openid")));
    if(!grantedScopes.includes(SCOPE)||grantedScopes.some(value=>!SUPPORTED_SCOPES.includes(value)))return json(400,{error:"invalid_scope"});
    const grantedScope=grantedScopes.join(" ");
    const client = await resolveClient(clientId, redirectUri);
    if (!client) return json(400, { error: "invalid_client" });

    const pendingId = crypto.randomUUID();
    const { error } = await db().from("aria_mcp_oauth_pending").insert({
      id: pendingId,
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: method,
      scope: grantedScope,
      expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
    });
    if (error) return json(500, { error: "authorization_state_failed", detail: error.message });

    const clientName =
      /^https:\/\//i.test(clientId)
        ? "Grok (CIMD)"
        : clientId.startsWith("aria_")
          ? "Grok Custom Connector"
          : clientId;
    return html(200, consentPage(pendingId, clientName, grantedScope));
  }

  if (req.method === "POST" && path.endsWith("/authorize/consent")) {
    const form = await req.formData();
    const pendingId = String(form.get("pending_id") ?? "");
    const decision = String(form.get("decision") ?? "");
    const { data: pending } = await db()
      .from("aria_mcp_oauth_pending")
      .select("*")
      .eq("id", pendingId)
      .maybeSingle();
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) {
      return html(400, "<h1>Authorization expired</h1><p>Restart from Grok.</p>");
    }
    const redirect = new URL(pending.redirect_uri);
    if (decision !== "allow") {
      redirect.searchParams.set("error", "access_denied");
      redirect.searchParams.set("state", pending.state);
      await db().from("aria_mcp_oauth_pending").delete().eq("id", pendingId);
      return Response.redirect(redirect.toString(), 302);
    }
    const grantedScope=String(pending.scope||SCOPE);
    if(decision==="allow"&&grantedScope.split(/\s+/).includes(CUEVACOIN_CONTROL_SCOPE)&&String(form.get("control_confirmation")||"")!=="AUTHORIZE CUEVACOIN CONTROL")return html(400,"<h1>Explicit control consent required</h1><p>Restart authorization and type the exact confirmation phrase.</p>");
    const code = `aria_code_${randomToken(24)}`;
    const { error } = await db().from("aria_mcp_oauth_codes").insert({
      code,
      client_id: pending.client_id,
      redirect_uri: pending.redirect_uri,
      code_challenge: pending.code_challenge,
      code_challenge_method: pending.code_challenge_method,
      user_id: null,
      encrypted_access_token: null,
      scope: grantedScope,
      resource: RESOURCE,
      expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    });
    if (error) return json(500, { error: "authorization_failed", detail: error.message });
    await db().from("aria_mcp_oauth_pending").delete().eq("id", pendingId);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", pending.state);
    redirect.searchParams.set("iss", ISSUER);
    return Response.redirect(redirect.toString(), 302);
  }

  if (req.method === "POST" && path.endsWith("/token")) {
    const ct = req.headers.get("content-type") ?? "";
    let body: Record<string, string>;
    try {
      if (ct.includes("application/x-www-form-urlencoded")) {
        body = Object.fromEntries(new URLSearchParams(await req.text())) as Record<string, string>;
      } else {
        body = (await req.json()) as Record<string, string>;
      }
    } catch {
      return json(400, { error: "invalid_request" });
    }

    const grant = body.grant_type ?? "";

    if (grant === "authorization_code") {
      const code = body.code ?? "";
      const clientId = body.client_id ?? "";
      const redirectUri = body.redirect_uri ?? "";
      const verifier = body.code_verifier ?? "";
      const resource = body.resource ?? RESOURCE;
      if (!code || !clientId || !redirectUri || !verifier) {
        return json(400, { error: "invalid_request" });
      }
      if (resource !== RESOURCE) {
        return json(400, { error: "invalid_target" });
      }
      const { data: record } = await db()
        .from("aria_mcp_oauth_codes")
        .select("*")
        .eq("code", code)
        .maybeSingle();
      if (
        !record ||
        record.used_at ||
        new Date(record.expires_at).getTime() <= Date.now() ||
        record.client_id !== clientId ||
        record.redirect_uri !== redirectUri
      ) {
        return json(400, { error: "invalid_grant" });
      }
      if (!(await pkceOk(verifier, record.code_challenge))) {
        return json(400, { error: "invalid_grant" });
      }
      await db()
        .from("aria_mcp_oauth_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("code", code);

      const grantedScope=String(record.scope||SCOPE);
      if(!grantedScope.split(/\s+/).includes(SCOPE)||grantedScope.split(/\s+/).some(value=>!SUPPORTED_SCOPES.includes(value)))return json(400,{error:"invalid_grant"});
      const access=await issueAccessToken(clientId,grantedScope);
      const refresh=await issueRefreshToken(clientId,grantedScope);
      return json(200,{access_token:access.token,token_type:"Bearer",expires_in:access.expiresIn,refresh_token:refresh,scope:grantedScope,resource:RESOURCE});
    }

    if (grant === "refresh_token") {
      const refreshRaw = body.refresh_token ?? "";
      const clientId = body.client_id ?? "";
      if (!refreshRaw) return json(400, { error: "invalid_request" });
      const consumed = await consumeRefreshToken(refreshRaw);
      if (!consumed) return json(400, { error: "invalid_grant" });
      if (clientId && clientId !== consumed.clientId) {
        return json(400, { error: "invalid_client" });
      }
      const access=await issueAccessToken(consumed.clientId,consumed.scope);
      const newRefresh=await issueRefreshToken(consumed.clientId,consumed.scope);
      return json(200,{access_token:access.token,token_type:"Bearer",expires_in:access.expiresIn,refresh_token:newRefresh,scope:consumed.scope,resource:RESOURCE});
    }

    return json(400, { error: "unsupported_grant_type" });
  }

  if (req.method === "GET" || req.method === "HEAD") {
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: jsonHeaders() });
    return json(200, {
      ok: true,
      transport: "streamable-http",
      resource: RESOURCE,
      issuer: ISSUER,
      tools: TOOLS.map((t) => t.name),
      authentication: "oauth2.1_pkce",
      xaiApi: "not_used",
    });
  }

  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { allow: "GET,HEAD,POST,OPTIONS" });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }
  const id = body.id ?? null;
  const method = typeof body.method === "string" ? body.method : "";
  const params = (body.params ?? {}) as Record<string, unknown>;
  const requested =
    (typeof params.protocolVersion === "string" ? params.protocolVersion : null) ??
    req.headers.get("mcp-protocol-version") ??
    DEFAULT_PROTOCOL;
  const protocol = PROTOCOL_VERSIONS.includes(requested) ? requested : null;

  const isDiscovery =
    method === "initialize" ||
    method === "notifications/initialized" ||
    method === "ping" ||
    method === "tools/list";

  const token = bearer(req);
  const auth = token ? await verifyAccessToken(token) : null;

  if (!isDiscovery && !auth) {
    return json(401, { error: "unauthorized" }, { "WWW-Authenticate": wwwAuthenticate() });
  }

  if (method === "initialize") {
    if (!protocol) {
      return json(400, rpcError(id, -32022, "unsupported_protocol"), sessionHeaders(req));
    }
    return json(
      200,
      rpc(id, {
        protocolVersion: protocol,
        serverInfo: { name: "ARIA MCP Inbound Grok", version: "2.0.0" },
        capabilities: { tools: { listChanged: false } },
        instructions:
          "ARIA inbound MCP for Grok Free Custom Connector. OAuth 2.1 + PKCE. Direction: Grok → ARIA only. xAI API not used.",
      }),
      sessionHeaders(req, protocol),
    );
  }
  if (method === "notifications/initialized") {
    return new Response(null, { status: 202, headers: sessionHeaders(req) });
  }
  if (method === "tools/list") {
    return json(200, rpc(id, { tools: TOOLS }), sessionHeaders(req));
  }
  if (method === "ping") {
    return json(200, rpc(id, {}), sessionHeaders(req));
  }
  if (method !== "tools/call") {
    return json(200, rpcError(id, -32601, "unsupported_method"), sessionHeaders(req));
  }

  const name = typeof params.name === "string" ? params.name : "";
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const textResult=(payload:unknown,isError=false)=>json(200,rpc(id,{content:[{type:"text",text:JSON.stringify(payload)}],isError}),sessionHeaders(req));

  if (name === "aria_status") {
    return textResult({
      ok: true,
      direction: "grok_to_aria",
      transport: "streamable-http",
      auth: "oauth2.1_pkce",
      resource: RESOURCE,
      tools: TOOLS.map((t) => t.name),
      protocolVersions: PROTOCOL_VERSIONS,
      xaiApi: "not_used",
    });
  }
  if (name === "aria_context") {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : "";
    return textResult({
      ok: true,
      direction: "grok_to_aria",
      query: query || null,
      context: {
        system: "ARIA",
        channel: "mcp-inbound",
        mode: "read_only",
        auth: "oauth2.1_pkce",
        note: "Phase-1 context snapshot. Memory core is not written.",
      },
    });
  }

  if(name==="cuevacoin_connection_status"){
   try{return textResult(await cuevaCoinConnectionStatus());}
   catch(error){return textResult({ok:false,project:"CuevaCoin",ready_for_full_control:false,error:cuevacoinSafeProviderError(error),checked_at:new Date().toISOString()},true);}
  }
  if(name==="cuevacoin_project_control"){
   const scopes=String(auth?.scope||"").split(/\s+/).filter(Boolean);
   if(!scopes.includes(CUEVACOIN_CONTROL_SCOPE))return json(200,rpcError(id,-32003,"cuevacoin_control_scope_required"),sessionHeaders(req));
   try{return textResult(await cuevaCoinProjectControl(args,auth?.clientId||"authorized_mcp_client"));}
   catch(error){
    const message=error instanceof Error?error.message:String(error??"");
    const allowlisted=new Set(["production_write_confirmation_required","production_project_confirmation_mismatch","change_summary_required","valid_risk_level_required","cuevacoin_governed_branch_required","manual_review_required","cuevacoin_change_confirmation_required","cuevacoin_file_too_large","low_risk_ci_gated_merge_only","merge_confirmation_phrase_required","deployment_workflow_not_allowlisted","production_workflow_must_dispatch_main","single_read_only_sql_statement_required","sql_query_required_or_too_large","timestamped_migration_name_required","migration_query_required_or_too_large","valid_edge_function_slug_required","edge_function_deploy_requires_verify_jwt_true","edge_function_files_required","unsafe_edge_function_file","secret_material_rejected","edge_function_bundle_too_large","cuevacoin_supabase_management_token_human_gate","cuevacoin_project_identity_mismatch","cuevacoin_operation_not_allowed","aria_internal_service_unavailable"]);
    return textResult({ok:false,project:"CuevaCoin",error:allowlisted.has(message)?message:cuevacoinSafeProviderError(error),completed_at:new Date().toISOString()},true);
   }
  }
  if (name === "aria_run_task" || name === "aria_memory_query" || name === "aria_memory_capture") {
    return json(200, rpcError(id, -32601, "tool_not_enabled_in_phase1"), sessionHeaders(req));
  }
  return json(200, rpcError(id, -32601, "unknown_tool"), sessionHeaders(req));
});
