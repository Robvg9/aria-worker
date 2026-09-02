import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getTraceId, recordTrace, traceHeaders } from "../_shared/aria-trace.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const RESOURCE = `${SUPABASE_URL}/functions/v1/aria-mcp-server-grok-v2`;
const RESOURCE_PATH = new URL(RESOURCE).pathname;
const AUTH_SERVER = `${SUPABASE_URL}/functions/v1/aria-mcp-oauth-grok-v2`;
const RESOURCE_METADATA = `${RESOURCE}/.well-known/oauth-protected-resource`;
const TRANSPORT = "streamable-http";
const SCOPES = "openid profile email";
const H = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const TOOLS = [
  { name: "aria_context", description: "Retrieve relevant authorized ChatBending context. Read-only.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"], additionalProperties: false } },
  { name: "aria_memory_capture", description: "Submit a memory candidate through the existing Gate-protected memory pipeline.", inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1 }, source_application: { type: "string" }, source_conversation_id: { type: "string" }, source_session_id: { type: "string" }, idempotency_key: { type: "string" } }, required: ["message"], additionalProperties: false } }
];
const reply = (status: number, body: Record<string, unknown>, traceId: string, extra: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...traceHeaders(traceId), ...extra } });
const rpc = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const errorRpc = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const bearer = (req: Request) => { const value = req.headers.get("authorization") ?? ""; return value.startsWith("Bearer ") ? value.slice(7).trim() : ""; };
const authChallenge = () => `Bearer resource_metadata="${RESOURCE_METADATA}", scope="${SCOPES}"`;
async function authUser(req: Request) {
  const token = bearer(req);
  if (!token || !ANON_KEY) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data } = await client.auth.getUser(token);
  return data.user ? { token, user: data.user } : null;
}
async function callFunction(slug: string, token: string, payload: unknown, traceId: string) {
  const started = Date.now();
  const path = `/functions/v1/${slug}`;
  const response = await fetch(`${SUPABASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "X-ARIA-Trace-Id": traceId }, body: JSON.stringify(payload) });
  const text = await response.text();
  let body: unknown; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; }
  await recordTrace({ traceId, stage: "mcp.upstream", component: slug, outcome: response.ok ? "success" : "error", method: "POST", path, statusCode: response.status, hasBearer: true, latencyMs: Date.now() - started, details: { upstream_status_ok: response.ok } });
  return { status: response.status, body };
}
function allowedOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || ["https://grok.com", "https://www.grok.com", "https://x.com", "https://www.x.com"].includes(origin);
}
Deno.serve(async req => {
  const traceId = getTraceId(req);
  const started = Date.now();
  let mcpMethod: string | null = null;
  const hasBearer = Boolean(bearer(req));
  let clientId: string | null = req.headers.get("x-client-id");
  if (!allowedOrigin(req)) {
    await recordTrace({ traceId, stage: "mcp.request", component: "aria-mcp-server-grok-v2", outcome: "rejected", method: req.method, path: new URL(req.url).pathname, statusCode: 403, hasBearer, errorCode: "invalid_origin", latencyMs: Date.now() - started });
    return reply(403, { error: "invalid_origin" }, traceId);
  }
  const u = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...H, ...traceHeaders(traceId), "access-control-allow-origin": "*", "access-control-allow-methods": "GET,HEAD,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,accept,mcp-protocol-version,mcp-method,mcp-name,x-client-id,x-aria-trace-id", "access-control-expose-headers": "X-ARIA-Trace-Id, WWW-Authenticate" } });
  const resourceMetadata = { resource: RESOURCE, authorization_servers: [AUTH_SERVER], bearer_methods_supported: ["header"], scopes_supported: SCOPES.split(" "), transport: TRANSPORT };
  if (req.method === "GET" && u.pathname === `${RESOURCE_PATH}/.well-known/oauth-protected-resource`) {
    await recordTrace({ traceId, stage: "mcp.request", component: "aria-mcp-server-grok-v2", outcome: "metadata", method: "GET", path: u.pathname, statusCode: 200, hasBearer, latencyMs: Date.now() - started });
    return reply(200, resourceMetadata, traceId, { "access-control-allow-origin": "*" });
  }
  if (req.method === "GET" || req.method === "HEAD") {
    await recordTrace({ traceId, stage: "mcp.auth", component: "aria-mcp-server-grok-v2", outcome: "challenge", method: req.method, path: u.pathname, statusCode: 401, hasBearer, latencyMs: Date.now() - started });
    return reply(401, { error: "unauthorized", transport: TRANSPORT }, traceId, { "WWW-Authenticate": authChallenge() });
  }
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, traceId, { allow: "GET,HEAD,POST,OPTIONS" });
  let body: any; try { body = await req.json(); } catch { return reply(400, { error: "invalid_json" }, traceId); }
  const id = body.id ?? null;
  mcpMethod = typeof body.method === "string" ? body.method : null;
  clientId = clientId ?? (typeof body.params?.client_id === "string" ? body.params.client_id : null);
  const requested = req.headers.get("MCP-Protocol-Version") ?? body.params?._meta?.["io.modelcontextprotocol/protocolVersion"] ?? body.params?.protocolVersion ?? "2025-03-26";
  const modern = requested === "2026-07-28";
  if (!["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"].includes(requested)) return reply(400, errorRpc(id, -32022, "unsupported_protocol"), traceId);
  const auth = await authUser(req);
  if (!auth) {
    await recordTrace({ traceId, stage: "mcp.auth", component: "aria-mcp-server-grok-v2", outcome: "rejected", method: "POST", path: u.pathname, statusCode: 401, mcpMethod, clientId, hasBearer, errorCode: "auth_required", latencyMs: Date.now() - started });
    return reply(401, { error: "unauthorized" }, traceId, { "WWW-Authenticate": authChallenge() });
  }
  await recordTrace({ traceId, stage: "mcp.request", component: "aria-mcp-server-grok-v2", outcome: "authenticated", method: "POST", path: u.pathname, statusCode: 200, mcpMethod, clientId, hasBearer: true, latencyMs: Date.now() - started, details: { protocol: requested } });
  if (methodEquals(mcpMethod, "initialize")) return reply(200, rpc(id, { protocolVersion: modern ? "2026-07-28" : requested, serverInfo: { name: "ARIA MCP Server", version: "1.3.9" }, capabilities: { tools: { listChanged: false } }, transport: TRANSPORT }), traceId);
  if (methodEquals(mcpMethod, "server/discover")) return reply(200, rpc(id, { resultType: "complete", supportedVersions: ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"], capabilities: { tools: { listChanged: false } } }), traceId);
  if (methodEquals(mcpMethod, "notifications/initialized")) return new Response(null, { status: 202, headers: { ...H, ...traceHeaders(traceId) } });
  if (methodEquals(mcpMethod, "tools/list")) return reply(200, rpc(id, { tools: TOOLS }), traceId);
  const params = body.params ?? {};
  const name = typeof params.name === "string" ? params.name : (req.headers.get("Mcp-Name") ?? "");
  const args = params.arguments ?? {};
  if (!methodEquals(mcpMethod, "tools/call")) return reply(200, errorRpc(id, -32601, "unsupported_method"), traceId);
  await recordTrace({ traceId, stage: "mcp.tool_call", component: "aria-mcp-server-grok-v2", outcome: "dispatch", method: "POST", path: u.pathname, statusCode: 200, mcpMethod, clientId, hasBearer: true, details: { tool: name } });
  if (name === "aria_context") {
    if (typeof args.query !== "string" || !args.query.trim()) return reply(200, errorRpc(id, -32602, "query is required"), traceId);
    const out = await callFunction("aria-context-retrieval-v1", auth.token, { query: args.query.trim() }, traceId);
    return reply(200, rpc(id, { content: [{ type: "text", text: JSON.stringify(out.body) }], isError: out.status >= 400 }), traceId);
  }
  if (name === "aria_memory_capture") {
    if (typeof args.message !== "string" || !args.message.trim()) return reply(200, errorRpc(id, -32602, "message is required"), traceId);
    const payload = { mode: "write", source_application: typeof args.source_application === "string" && args.source_application.trim() ? args.source_application.trim() : "grok", source_conversation_id: typeof args.source_conversation_id === "string" ? args.source_conversation_id : "mcp", source_session_id: typeof args.source_session_id === "string" ? args.source_session_id : null, role: "user", message: args.message.trim(), user: auth.user.id, idempotency_key: typeof args.idempotency_key === "string" && args.idempotency_key ? args.idempotency_key : crypto.randomUUID() };
    const out = await callFunction("aria-memory-bridge-9-4", auth.token, payload, traceId);
    return reply(200, rpc(id, { content: [{ type: "text", text: JSON.stringify(out.body) }], isError: out.status >= 400 }), traceId);
  }
  return reply(200, errorRpc(id, -32601, "unknown_tool"), traceId);
});
function methodEquals(value: string | null, expected: string) { return value === expected; }
