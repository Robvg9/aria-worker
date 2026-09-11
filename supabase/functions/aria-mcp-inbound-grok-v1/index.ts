import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const TOKEN = Deno.env.get("ARIA_MCP_INBOUND_TOKEN") ?? "";
const RESOURCE = Deno.env.get("ARIA_MCP_INBOUND_RESOURCE") ?? "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1";
const PROTOCOL_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"];
const DEFAULT_PROTOCOL = "2025-03-26";
const TOOLS = [
  { name: "aria_status", description: "Read-only ARIA inbound status for Grok Custom MCP Connector. No secrets.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "aria_context", description: "Read-only authorized ARIA context snapshot for Grok. No memory writes.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1 } }, additionalProperties: false } }
];

const jsonHeaders = (extra: HeadersInit = {}) => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Mcp-Session-Id,WWW-Authenticate,MCP-Protocol-Version",
  ...extra
});

const json = (status: number, body: unknown, extra: HeadersInit = {}) =>
  new Response(body == null ? null : JSON.stringify(body), { status, headers: jsonHeaders(extra) });

function bearer(req: Request) {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function tokensEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function authorized(req: Request) {
  return Boolean(TOKEN) && tokensEqual(bearer(req), TOKEN);
}

function sessionHeaders(req: Request, protocol = DEFAULT_PROTOCOL): HeadersInit {
  return jsonHeaders({
    "Mcp-Session-Id": req.headers.get("mcp-session-id") ?? "aria-inbound-stateless",
    "MCP-Protocol-Version": protocol
  });
}

function rpc(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: jsonHeaders({
        "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
        "access-control-allow-headers": "authorization,content-type,accept,mcp-protocol-version,mcp-session-id"
      })
    });
  }
  if (req.method === "GET" && url.pathname.includes(".well-known/oauth-protected-resource")) {
    return json(200, { resource: RESOURCE, bearer_methods_supported: ["header"], authorization_servers: [], scopes_supported: ["aria.mcp.inbound"] });
  }
  if (req.method === "GET" || req.method === "HEAD") {
    if (!authorized(req)) return json(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer realm="aria-mcp-inbound", resource="${RESOURCE}"` });
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: jsonHeaders() });
    return json(200, { ok: true, transport: "streamable-http", resource: RESOURCE, tools: TOOLS.map((t) => t.name) });
  }
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" }, { allow: "GET,HEAD,POST,OPTIONS" });
  if (!authorized(req)) return json(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer realm="aria-mcp-inbound", resource="${RESOURCE}"` });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "invalid_json" }); }
  const id = body.id ?? null;
  const method = typeof body.method === "string" ? body.method : "";
  const requested = body.params?.protocolVersion ?? req.headers.get("mcp-protocol-version") ?? DEFAULT_PROTOCOL;
  const protocol = PROTOCOL_VERSIONS.includes(requested) ? requested : null;

  if (method === "initialize") {
    if (!protocol) return json(400, rpcError(id, -32022, "unsupported_protocol"), sessionHeaders(req));
    return json(200, rpc(id, {
      protocolVersion: protocol,
      serverInfo: { name: "ARIA MCP Inbound Grok", version: "1.0.0" },
      capabilities: { tools: { listChanged: false } },
      instructions: "ARIA inbound MCP for Grok Free Custom Connector. Direction: Grok \u2192 ARIA only."
    }), sessionHeaders(req, protocol));
  }
  if (method === "notifications/initialized") return new Response(null, { status: 202, headers: sessionHeaders(req) });
  if (method === "tools/list") return json(200, rpc(id, { tools: TOOLS }), sessionHeaders(req));
  if (method === "ping") return json(200, rpc(id, {}), sessionHeaders(req));
  if (method !== "tools/call") return json(200, rpcError(id, -32601, "unsupported_method"), sessionHeaders(req));

  const name = typeof body.params?.name === "string" ? body.params.name : "";
  const args = body.params?.arguments ?? {};
  const textResult = (payload: unknown) => json(200, rpc(id, { content: [{ type: "text", text: JSON.stringify(payload) }], isError: false }), sessionHeaders(req));
  if (name === "aria_status") {
    return textResult({ ok: true, direction: "grok_to_aria", transport: "streamable-http", auth: "governed_bearer", tools: TOOLS.map((t) => t.name), protocolVersions: PROTOCOL_VERSIONS, xaiApi: "not_used" });
  }
  if (name === "aria_context") {
    const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : "";
    return textResult({ ok: true, direction: "grok_to_aria", query: query || null, context: { system: "ARIA", channel: "mcp-inbound", mode: "read_only", note: "Phase-1 context snapshot. Memory core is not written." } });
  }
  if (name === "aria_run_task" || name === "aria_memory_query") return json(200, rpcError(id, -32601, "tool_not_enabled_in_phase1"), sessionHeaders(req));
  return json(200, rpcError(id, -32601, "unknown_tool"), sessionHeaders(req));
});
