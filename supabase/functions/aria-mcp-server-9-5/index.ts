import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const RESOURCE = `${SUPABASE_URL}/functions/v1/aria-mcp-server-grok-v1`;
const AUTH_SERVER = `${SUPABASE_URL}/functions/v1/aria-mcp-oauth-grok-v1`;
const RESOURCE_METADATA = `${SUPABASE_URL}/.well-known/oauth-protected-resource/functions/v1/aria-mcp-server-grok-v1`;
const SERVER_NAME = "ARIA MCP Server";
const SERVER_VERSION = "1.1.1";
const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-11-25";
const H = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const TOOLS = [
  { name: "aria_context", description: "Retrieve relevant authorized ChatBending context. Read-only.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"], additionalProperties: false } },
  { name: "aria_memory_capture", description: "Submit a memory candidate through the existing Gate-protected memory pipeline. No direct canonical write.", inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1 }, source_application: { type: "string" }, source_conversation_id: { type: "string" }, source_session_id: { type: "string" }, idempotency_key: { type: "string" } }, required: ["message"], additionalProperties: false } }
];
const reply = (status: number, body: Record<string, unknown>, extra: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...extra } });
const modernReply = (status: number, body: Record<string, unknown>, extra: HeadersInit = {}) => reply(status, { ...body, _meta: { "io.modelcontextprotocol/serverInfo": { name: SERVER_NAME, version: SERVER_VERSION } } }, extra);
const bearer = (req: Request) => { const h = req.headers.get("authorization") ?? ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : ""; };
function originAllowed(req: Request) { const origin = req.headers.get("origin"); if (!origin) return true; return origin === "https://grok.com" || origin === "https://www.grok.com" || origin === "https://x.com" || origin === "https://www.x.com"; }
async function authenticate(req: Request) { const token = bearer(req); if (!token) return { ok: false as const, response: reply(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_METADATA}"` }) }; if (!ANON_KEY) return { ok: false as const, response: reply(500, { error: "auth_configuration_invalid" }) }; const c = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }); const { data, error } = await c.auth.getUser(token); if (error || !data.user) return { ok: false as const, response: reply(401, { error: "invalid_token" }, { "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${RESOURCE_METADATA}"` }) }; return { ok: true as const, token, user: data.user }; }
async function callFunction(slug: string, token: string, payload: unknown) { const r = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload) }); const text = await r.text(); let body: unknown; try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; } return { status: r.status, body }; }
function rpcError(id: unknown, code: number, message: string, extra: Record<string, unknown> = {}) { return { jsonrpc: "2.0", id, error: { code, message, ...extra } }; }
function resourceMetadata() { return { resource: RESOURCE, authorization_servers: [AUTH_SERVER], bearer_methods_supported: ["header"] }; }
Deno.serve(async req => {
  if (!originAllowed(req)) return reply(403, { error: "invalid_origin" }, { "access-control-allow-origin": "null" });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,HEAD,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,accept,mcp-protocol-version,mcp-method,mcp-name,mcp-session-id", "access-control-expose-headers": "WWW-Authenticate,Mcp-Session-Id" } });
  const u = new URL(req.url);
  const isRootMetadata = req.method === "GET" && u.pathname === "/.well-known/oauth-protected-resource/functions/v1/aria-mcp-server-grok-v1";
  if (isRootMetadata) return reply(200, resourceMetadata(), { "access-control-allow-origin": "*" });
  if (req.method === "GET" || req.method === "HEAD") return (await authenticate(req)).response;
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, { allow: "GET, HEAD, POST, OPTIONS" });
  const auth = await authenticate(req); if (!auth.ok) return auth.response;
  let body: any; try { body = JSON.parse(await req.text()); } catch { return reply(400, { error: "invalid_json" }); }
  const id = body.id ?? null;
  const bodyMethod = typeof body.method === "string" ? body.method : "";
  const headerMethod = req.headers.get("Mcp-Method") ?? "";
  const headerName = req.headers.get("Mcp-Name") ?? "";
  const requestedProtocol = req.headers.get("MCP-Protocol-Version") ?? body.params?._meta?.["io.modelcontextprotocol/protocolVersion"] ?? body.params?.protocolVersion ?? LEGACY_VERSION;
  const modern = requestedProtocol === MODERN_VERSION;
  if (headerMethod && headerMethod !== bodyMethod) return reply(400, rpcError(id, -32600, "Mcp-Method does not match JSON-RPC method"));
  if (modern) {
    if (!headerMethod && bodyMethod !== "notifications/initialized") return reply(400, rpcError(id, -32600, "Mcp-Method is required for modern MCP requests"));
    if (bodyMethod === "tools/call" && headerName && headerName !== body.params?.name) return reply(400, rpcError(id, -32600, "Mcp-Name does not match tool name"));
    if (bodyMethod === "tools/call" && !headerName) return reply(400, rpcError(id, -32600, "Mcp-Name is required for tools/call"));
  } else if (![LEGACY_VERSION, "2025-06-18", "2025-03-26"].includes(requestedProtocol)) return reply(400, rpcError(id, -32021, "unsupported_protocol", { supported: [MODERN_VERSION, LEGACY_VERSION, "2025-06-18", "2025-03-26"] }));
  if (modern && bodyMethod === "server/discover") return modernReply(200, { jsonrpc: "2.0", id, result: { resultType: "complete", supportedVersions: [MODERN_VERSION], capabilities: { tools: { listChanged: false } }, instructions: "ARIA exposes governed ChatBending context and memory-capture tools." } });
  if (!modern && bodyMethod === "initialize") { const protocolVersion = [LEGACY_VERSION, "2025-06-18", "2025-03-26"].includes(requestedProtocol) ? requestedProtocol : LEGACY_VERSION; return reply(200, { jsonrpc: "2.0", id, result: { protocolVersion, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }, capabilities: { tools: { listChanged: false } } } }); }
  if (!modern && bodyMethod === "notifications/initialized") return new Response(null, { status: 202, headers: H });
  if (bodyMethod === "tools/list") return modern ? modernReply(200, { jsonrpc: "2.0", id, result: { resultType: "complete", tools: TOOLS } }) : reply(200, { jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (bodyMethod !== "tools/call") return modern ? modernReply(200, rpcError(id, -32601, "unsupported_method")) : reply(200, rpcError(id, -32601, "unsupported_method"));
  const p = body.params ?? {}; const name = typeof p.name === "string" ? p.name : headerName; const args = p.arguments ?? {};
  if (name === "aria_context") { if (typeof args.query !== "string" || !args.query.trim()) return modern ? modernReply(200, rpcError(id, -32602, "query is required")) : reply(200, rpcError(id, -32602, "query is required")); const out = await callFunction("aria-context-retrieval-v1", auth.token, { query: args.query.trim() }); const response = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out.body) }], isError: out.status >= 400 } }; return modern ? modernReply(200, response) : reply(200, response); }
  if (name === "aria_memory_capture") { if (typeof args.message !== "string" || !args.message.trim()) return modern ? modernReply(200, rpcError(id, -32602, "message is required")) : reply(200, rpcError(id, -32602, "message is required")); const source = typeof args.source_application === "string" && args.source_application.trim() ? args.source_application.trim() : "grok"; const payload = { mode: "write", source_application: source, source_conversation_id: typeof args.source_conversation_id === "string" ? args.source_conversation_id : "mcp", source_session_id: typeof args.source_session_id === "string" ? args.source_session_id : null, role: "user", message: args.message.trim(), user: auth.user.id, idempotency_key: typeof args.idempotency_key === "string" && args.idempotency_key ? args.idempotency_key : crypto.randomUUID() }; const out = await callFunction("aria-memory-bridge-9-4", auth.token, payload); const response = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out.body) }], isError: out.status >= 400 } }; return modern ? modernReply(200, response) : reply(200, response); }
  return modern ? modernReply(200, rpcError(id, -32601, "unknown_tool")) : reply(200, rpcError(id, -32601, "unknown_tool"));
});
