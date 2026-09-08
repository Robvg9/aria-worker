import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const EXPO_TOKEN = Deno.env.get("EXPO_TOKEN") ?? "";
const EAS_API = "https://api.expo.dev";
const EAS_GRAPHQL = `${EAS_API}/graphql`;
const EAS_APP_ID = "1b23b091-f7b6-4dc2-b328-c8e5ec07de57";
const PUBLIC_RESOURCE = "https://aria.robvg9.workers.dev/mcp";
const PUBLIC_AUTH_SERVER = "https://aria.robvg9.workers.dev";
const RESOURCE = PUBLIC_RESOURCE;
const AUTH_SERVER = PUBLIC_AUTH_SERVER;
const RESOURCE_METADATA = `${PUBLIC_RESOURCE}/.well-known/oauth-protected-resource`;
const PROTOCOLS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const TOOLS = [
  { name: "aria_context", description: "Retrieve relevant authorized ChatBending context. Read-only.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"], additionalProperties: false } },
  { name: "aria_memory_capture", description: "Submit a memory candidate through the existing Gate-protected memory pipeline. No direct canonical write.", inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1 }, source_application: { type: "string" }, source_conversation_id: { type: "string" }, source_session_id: { type: "string" }, idempotency_key: { type: "string" } }, required: ["message"], additionalProperties: false } },
  { name: "aria_eas_connection_status", description: "Verify the server-side ARIA connection to the EAS project. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "aria_eas_workflow_definitions", description: "List workflow definitions currently visible to ARIA in the EAS project. Read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "aria_eas_workflow_list", description: "List recent EAS workflow runs, optionally filtered by status. Read-only.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 }, status: { type: "string" } }, additionalProperties: false } },
  { name: "aria_eas_workflow_info", description: "Inspect a specific EAS workflow run including job details. Read-only.", inputSchema: { type: "object", properties: { runId: { type: "string", minLength: 1 } }, required: ["runId"], additionalProperties: false } },
  { name: "aria_eas_workflow_dispatch", description: "Dispatch an EAS workflow on the fixed ARIA APP project. Side effect: requires explicit confirm=true.", inputSchema: { type: "object", properties: { gitRef: { type: "string", minLength: 1 }, fileName: { type: "string", minLength: 1 }, inputs: { type: "object" }, confirm: { type: "boolean" } }, required: ["gitRef", "fileName", "confirm"], additionalProperties: false } },
  { name: "aria_eas_build_list", description: "List recent EAS builds for the ARIA APP project. Read-only.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 50 }, offset: { type: "integer", minimum: 0 }, platform: { type: "string" }, status: { type: "string" } }, additionalProperties: false } },
  { name: "aria_eas_build_info", description: "Inspect a specific EAS build including artifact URLs, status, git commit and error data. Read-only.", inputSchema: { type: "object", properties: { buildId: { type: "string", minLength: 1 } }, required: ["buildId"], additionalProperties: false } },
  { name: "aria_eas_build_logs", description: "Fetch logs for a completed EAS build, bounded to avoid runaway responses. Read-only.", inputSchema: { type: "object", properties: { buildId: { type: "string", minLength: 1 } }, required: ["buildId"], additionalProperties: false } }
];
const json = (status: number, body: unknown, extra: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const bearer = (req: Request) => { const value = req.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; };
const metadata = () => ({ resource: RESOURCE, authorization_servers: [AUTH_SERVER], bearer_methods_supported: ["header"], scopes_supported: ["openid", "profile", "email"] });

async function authenticate(req: Request) {
  const token = bearer(req);
  if (!token || !ANON_KEY) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { token, user: data.user };
}

async function callUpstream(slug: string, token: string, payload: unknown) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; }
  return { status: response.status, body };
}

function easHeaders() {
  if (!EXPO_TOKEN) throw new Error("EXPO_TOKEN is not configured");
  return { authorization: `Bearer ${EXPO_TOKEN}`, "content-type": "application/json" };
}
async function easGraphQL(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(EAS_GRAPHQL, { method: "POST", headers: easHeaders(), body: JSON.stringify({ query, variables }) });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 4000) }; }
  return { status: response.status, body };
}
async function easRest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${EAS_API}${path}`, { ...init, headers: { ...easHeaders(), ...(init.headers ?? {}) } });
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 12000) }; }
  return { status: response.status, body };
}
const RUN_FRAGMENT = `id status gitCommitMessage gitCommitHash requestedGitRef actor { id __typename ... on UserActor { username } ... on Robot { firstName } } triggeringLabelName triggerEventType triggeringSchedule createdAt updatedAt errors { title message } workflow { id name fileName }`;
const WORKFLOW_FRAGMENT = `id name fileName createdAt updatedAt revisionsPaginated(first: 1) { edges { node { id blobSha commitSha createdAt yamlConfig } } }`;
const BUILD_FRAGMENT = `id status platform error { errorCode message docsUrl } artifacts { buildUrl xcodeBuildLogsUrl applicationArchiveUrl buildArtifactsUrl } fingerprint { id hash } initiatingActor { __typename id displayName } logFiles app { __typename id name slug ownerAccount { id name } } updateChannel { id name } distribution iosEnterpriseProvisioning buildProfile appIdentifier sdkVersion appVersion appBuildVersion runtime { id version } gitCommitHash gitCommitMessage initialQueuePosition queuePosition estimatedWaitTimeLeftSeconds priority createdAt updatedAt message completedAt expirationDate isForIosSimulator metrics { buildWaitTime buildQueueTime buildDuration }`;
async function easConnectionStatus() { return (await easGraphQL(`query App($appId: String!) { app { byId(appId: $appId) { id name slug ownerAccount { id name } } } }`, { appId: EAS_APP_ID })).body; }
async function easWorkflowDefinitions() { return (await easGraphQL(`query Workflows($appId: String!) { app { byId(appId: $appId) { id workflows { ${WORKFLOW_FRAGMENT} } } } }`, { appId: EAS_APP_ID })).body; }
async function easWorkflowList(limit = 20, status?: string) { const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 100)); return (await easGraphQL(`query Runs($appId: String!, $status: WorkflowRunStatus, $limit: Int!) { app { byId(appId: $appId) { id workflowRunsPaginated(first: $limit, filter: { status: $status }) { edges { node { ${RUN_FRAGMENT} } } } } } }`, { appId: EAS_APP_ID, status: status || null, limit: safeLimit })).body; }
async function easWorkflowInfo(runId: string) { return (await easRest(`/v2/workflows/runs/${encodeURIComponent(runId)}`)).body; }
async function easWorkflowDispatch(gitRef: string, fileName: string, inputs?: Record<string, unknown>) { return (await easRest(`/v2/workflows/dispatch`, { method: "POST", body: JSON.stringify({ appId: EAS_APP_ID, gitRef, fileName, ...(inputs ? { inputs } : {}) }) })).body; }
async function easBuildList(limit = 20, offset = 0, platform?: string, status?: string) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const filterParts: string[] = [];
  if (platform) filterParts.push(`platform: ${JSON.stringify(platform)}`);
  if (status) filterParts.push(`status: ${JSON.stringify(status)}`);
  const filter = filterParts.length ? `, filter: { ${filterParts.join(", ")} }` : "";
  return (await easGraphQL(`query Builds($appId: String!, $offset: Int!, $limit: Int!) { app { byId(appId: $appId) { id builds(offset: $offset, limit: $limit${filter}) { ${BUILD_FRAGMENT} } } } }`, { appId: EAS_APP_ID, offset: safeOffset, limit: safeLimit })).body;
}
async function easBuildInfo(buildId: string) { return (await easGraphQL(`query Build($buildId: ID!) { builds { byId(buildId: $buildId) { ${BUILD_FRAGMENT} } } }`, { buildId })).body; }
async function easBuildLogs(buildId: string) {
  const info = await easBuildInfo(buildId); const logFiles = info?.data?.builds?.byId?.logFiles;
  if (!Array.isArray(logFiles) || logFiles.length === 0) return { buildId, build: info?.data?.builds?.byId ?? null, logs: [] };
  const logs = [];
  for (const url of logFiles.slice(0, 10)) {
    if (typeof url !== "string") continue;
    try { const response = await fetch(url); const text = await response.text(); logs.push({ url, ok: response.ok, status: response.status, content: text.slice(-50000) }); }
    catch (e) { logs.push({ url, ok: false, error: e instanceof Error ? e.message : String(e) }); }
  }
  return { buildId, build: info?.data?.builds?.byId ?? null, logs };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...HEADERS, "access-control-allow-origin": "*", "access-control-allow-methods": "GET,HEAD,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,accept,mcp-protocol-version,mcp-method,mcp-name", "access-control-expose-headers": "WWW-Authenticate" } });
  if (req.method === "GET" && (url.pathname.endsWith("/.well-known/oauth-protected-resource") || url.pathname.includes("/.well-known/oauth-protected-resource"))) return json(200, metadata(), { "access-control-allow-origin": "*" });
  if (req.method === "GET" || req.method === "HEAD") {
    const auth = await authenticate(req);
    if (!auth) return json(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_METADATA}"` });
    return req.method === "HEAD" ? new Response(null, { status: 200, headers: HEADERS }) : json(200, { ok: true, transport: "streamable-http", resource: RESOURCE });
  }
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "GET,HEAD,POST,OPTIONS" });
  const auth = await authenticate(req);
  if (!auth) return json(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_METADATA}"` });
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const id = body.id ?? null; const method = typeof body.method === "string" ? body.method : "";
  const requested = req.headers.get("MCP-Protocol-Version") ?? body.params?.protocolVersion ?? "2025-03-26";
  if (!PROTOCOLS.includes(requested)) return json(400, rpcError(id, -32022, "unsupported_protocol"));
  if (method === "initialize") return json(200, rpc(id, { protocolVersion: requested, serverInfo: { name: "ARIA MCP Server", version: "4.1.0" }, capabilities: { tools: { listChanged: false } } }));
  if (method === "notifications/initialized") return new Response(null, { status: 202, headers: HEADERS });
  if (method === "server/discover") return json(200, rpc(id, { resultType: "complete", supportedVersions: PROTOCOLS, capabilities: { tools: { listChanged: false } } }));
  if (method === "tools/list") return json(200, rpc(id, { tools: TOOLS }));
  if (method !== "tools/call") return json(200, rpcError(id, -32601, "unsupported_method"));

  const params = body.params ?? {}; const name = typeof params.name === "string" ? params.name : ""; const args = params.arguments ?? {};
  const textResult = (payload: unknown, isError = false) => json(200, rpc(id, { content: [{ type: "text", text: JSON.stringify(payload) }], isError }));
  try {
    if (name === "aria_context") {
      if (typeof args.query !== "string" || !args.query.trim()) return json(200, rpcError(id, -32602, "query is required"));
      const upstream = await callUpstream("aria-context-retrieval-v1", auth.token, { query: args.query.trim() });
      return textResult(upstream.body, upstream.status >= 400);
    }
    if (name === "aria_memory_capture") {
      if (typeof args.message !== "string" || !args.message.trim()) return json(200, rpcError(id, -32602, "message is required"));
      const upstream = await callUpstream("aria-memory-bridge-9-4", auth.token, { mode: "write", source_application: typeof args.source_application === "string" && args.source_application.trim() ? args.source_application.trim() : "grok", source_conversation_id: typeof args.source_conversation_id === "string" ? args.source_conversation_id : "mcp", source_session_id: typeof args.source_session_id === "string" ? args.source_session_id : null, role: "user", message: args.message.trim(), user: auth.user.id, idempotency_key: typeof args.idempotency_key === "string" && args.idempotency_key ? args.idempotency_key : crypto.randomUUID() });
      return textResult(upstream.body, upstream.status >= 400);
    }
    if (name === "aria_eas_connection_status") return textResult(await easConnectionStatus());
    if (name === "aria_eas_workflow_definitions") return textResult(await easWorkflowDefinitions());
    if (name === "aria_eas_workflow_list") return textResult(await easWorkflowList(args.limit, args.status));
    if (name === "aria_eas_workflow_info") { if (typeof args.runId !== "string" || !args.runId.trim()) return json(200, rpcError(id, -32602, "runId is required")); return textResult(await easWorkflowInfo(args.runId.trim())); }
    if (name === "aria_eas_workflow_dispatch") { if (args.confirm !== true) return textResult({ error: "confirmation_required", message: "Set confirm=true to dispatch an EAS workflow." }, true); if (typeof args.gitRef !== "string" || !args.gitRef.trim()) return json(200, rpcError(id, -32602, "gitRef is required")); if (typeof args.fileName !== "string" || !args.fileName.trim()) return json(200, rpcError(id, -32602, "fileName is required")); return textResult(await easWorkflowDispatch(args.gitRef.trim(), args.fileName.trim(), args.inputs && typeof args.inputs === "object" ? args.inputs : undefined)); }
    if (name === "aria_eas_build_list") return textResult(await easBuildList(args.limit, args.offset, args.platform, args.status));
    if (name === "aria_eas_build_info") { if (typeof args.buildId !== "string" || !args.buildId.trim()) return json(200, rpcError(id, -32602, "buildId is required")); return textResult(await easBuildInfo(args.buildId.trim())); }
    if (name === "aria_eas_build_logs") { if (typeof args.buildId !== "string" || !args.buildId.trim()) return json(200, rpcError(id, -32602, "buildId is required")); return textResult(await easBuildLogs(args.buildId.trim())); }
    return json(200, rpcError(id, -32601, "unknown_tool"));
  } catch (e) {
    return textResult({ error: "eas_upstream_error", message: e instanceof Error ? e.message : String(e) }, true);
  }
});
