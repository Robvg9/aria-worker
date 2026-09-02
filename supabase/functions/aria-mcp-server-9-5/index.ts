import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const RESOURCE = `${SUPABASE_URL}/functions/v1/aria-mcp-server-9-5`;
const AUTH_SERVER = `${SUPABASE_URL}/functions/v1/aria-mcp-oauth-v1`;
const RESOURCE_METADATA = `${RESOURCE}/.well-known/oauth-protected-resource`;
const H = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const TOOLS = [
  { name: "aria_context", description: "Retrieve relevant authorized ChatBending context. Read-only.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"], additionalProperties: false } },
  { name: "aria_memory_capture", description: "Submit a memory candidate through the existing Gate-protected memory pipeline. No direct canonical write.", inputSchema: { type: "object", properties: { message: { type: "string", minLength: 1 }, source_application: { type: "string" }, source_conversation_id: { type: "string" }, source_session_id: { type: "string" }, idempotency_key: { type: "string" } }, required: ["message"], additionalProperties: false } }
];
const reply = (status: number, body: Record<string, unknown>, extra: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { ...H, ...extra } });
const bearer = (req: Request) => { const h = req.headers.get("authorization") ?? ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : ""; };
async function authenticate(req: Request) {
  const token = bearer(req);
  if (!token) return { ok: false as const, response: reply(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_METADATA}"` }) };
  if (!ANON_KEY) return { ok: false as const, response: reply(500, { error: "auth_configuration_invalid" }) };
  const c = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.getUser(token);
  if (error || !data.user) return { ok: false as const, response: reply(401, { error: "invalid_token" }, { "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${RESOURCE_METADATA}"` }) };
  return { ok: true as const, token, user: data.user };
}
async function callFunction(slug: string, token: string, payload: unknown) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
  const text = await r.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 2000) }; }
  return { status: r.status, body };
}
Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "authorization,content-type,accept,mcp-protocol-version,mcp-method,mcp-name,mcp-session-id", "access-control-expose-headers": "WWW-Authenticate,Mcp-Session-Id" } });
  const u = new URL(req.url);
  if (req.method === "GET" && u.pathname.endsWith("/.well-known/oauth-protected-resource")) return reply(200, { resource: RESOURCE, authorization_servers: [AUTH_SERVER], bearer_methods_supported: ["header"] }, { "access-control-allow-origin": "*" });
  const auth = await authenticate(req);
  if (!auth.ok) return auth.response;
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" }, { allow: "POST" });
  let body: any;
  try { body = JSON.parse(await req.text()); } catch { return reply(400, { error: "invalid_json" }); }
  const id = body.id ?? null;
  const method = String(req.headers.get("Mcp-Method") ?? body.method ?? "");
  const protocol = String(req.headers.get("MCP-Protocol-Version") ?? body.params?.protocolVersion ?? "2026-07-28");
  if (method === "initialize") return reply(200, { jsonrpc: "2.0", id, result: { protocolVersion: protocol, serverInfo: { name: "ARIA MCP Server", version: "1.0.0" }, capabilities: { tools: { listChanged: false } } } });
  if (method === "notifications/initialized") return new Response(null, { status: 202, headers: H });
  if (method === "tools/list") return reply(200, { jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method !== "tools/call") return reply(200, { jsonrpc: "2.0", id, error: { code: -32601, message: "unsupported_method" } });
  const p = body.params ?? {};
  const name = typeof p.name === "string" ? p.name : req.headers.get("Mcp-Name") ?? "";
  const args = p.arguments ?? {};
  if (name === "aria_context") {
    if (typeof args.query !== "string" || !args.query.trim()) return reply(200, { jsonrpc: "2.0", id, error: { code: -32602, message: "query is required" } });
    const out = await callFunction("aria-context-retrieval-v1", auth.token, { query: args.query.trim() });
    return reply(200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out.body) }], isError: out.status >= 400 } });
  }
  if (name === "aria_memory_capture") {
    if (typeof args.message !== "string" || !args.message.trim()) return reply(200, { jsonrpc: "2.0", id, error: { code: -32602, message: "message is required" } });
    const source = typeof args.source_application === "string" && args.source_application.trim() ? args.source_application.trim() : "grok";
    const payload = { mode: "write", source_application: source, source_conversation_id: typeof args.source_conversation_id === "string" ? args.source_conversation_id : "mcp", source_session_id: typeof args.source_session_id === "string" ? args.source_session_id : null, role: "user", message: args.message.trim(), user: auth.user.id, idempotency_key: typeof args.idempotency_key === "string" && args.idempotency_key ? args.idempotency_key : crypto.randomUUID() };
    const out = await callFunction("aria-memory-bridge-9-4", auth.token, payload);
    return reply(200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out.body) }], isError: out.status >= 400 } });
  }
  return reply(200, { jsonrpc: "2.0", id, error: { code: -32601, message: "unknown_tool" } });
});
