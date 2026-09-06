const SUPABASE_MCP =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-server-grok-v2";
const SUPABASE_OAUTH =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-oauth-grok-v3";
const RUNTIME_GATEWAY =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-runtime-gateway-v1";
const MISSION_INTAKE =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-intake-v1";
const CANONICAL_RUNTIME =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-canonical-runtime-v1";
const DIRECT_ARIA =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-direct-v1";
const CRON_AUTH_URL =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-cron-auth-v1";
const RESOURCE = "https://aria.robvg9.workers.dev/mcp";
const RESOURCE_METADATA = "https://aria.robvg9.workers.dev/.well-known/oauth-protected-resource/mcp";
const SCOPES = ["openid", "profile", "email"];
const { createCloudflareAdminEndpoint } = require("./integrations/cloudflare-admin-endpoint");
const { createCloudflareTokenManager } = require("./integrations/cloudflare-token-manager");
const cloudflareAdmin = createCloudflareAdminEndpoint({ scriptName: "aria" });
const cloudflareTokenManager = createCloudflareTokenManager();
function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
  });
}
function protectedResourceMetadata() {
  return { resource: RESOURCE, authorization_servers: [SUPABASE_OAUTH], bearer_methods_supported: ["header"], scopes_supported: SCOPES };
}
function authorizationServerMetadata() {
  return {
    issuer: SUPABASE_OAUTH,
    authorization_endpoint: `${SUPABASE_OAUTH}/authorize`,
    token_endpoint: `${SUPABASE_OAUTH}/token`,
    registration_endpoint: `${SUPABASE_OAUTH}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true
  };
}
function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
function extractBearer(request) {
  const value = request.headers.get("authorization");
  const match = value && value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}
async function vaultCronAuthorized(request, fetchImpl = globalThis.fetch) {
  const token = request.headers.get("x-aria-autonomy-token");
  if (!token) return false;
  try {
    const response = await fetchImpl(CRON_AUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-aria-autonomy-token": token },
      body: "{}"
    });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return body?.authorized === true;
  } catch (_) {
    return false;
  }
}
async function autonomyHealth(request) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!(await vaultCronAuthorized(request))) return json({ error: "unauthorized" }, 401);
  return json({ ok: true, service: "aria-worker", executor: "cloudflare-worker", version: "canonical-runtime-v1" });
}
function rewriteAuthChallenge(response) {
  const headers = new Headers(response.headers);
  headers.set("WWW-Authenticate", 'Bearer resource_metadata="' + RESOURCE_METADATA + '", scope="' + SCOPES.join(" ") + '"');
  headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, X-ARIA-Trace-Id");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function proxyOAuth(request, url) {
  const upstreamUrl = new URL(SUPABASE_OAUTH);
  const suffix = url.pathname.replace(/^\/(?:oauth\/)?/, "");
  if (suffix) upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
  upstreamUrl.search = url.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  const upstream = await fetch(new Request(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual"
  }));
  if (url.pathname === "/authorize" || url.pathname === "/authorize/") {
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("content-type", "text/html; charset=utf-8");
    responseHeaders.set("cache-control", "no-store");
    const html = await upstream.text();
    const publicStart = `${url.origin}/authorize/start`;
    const upstreamStart = `action="${SUPABASE_OAUTH}/authorize/start"`;
    const rewritten = html.replace(upstreamStart, `action="${publicStart}"`);
    return new Response(rewritten, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
  }
  return upstream;
}
async function proxyRuntime(request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.ARIA_RUNTIME_SHARED_SECRET) return json({ error: "runtime_secret_not_configured" }, 500);
  const incomingToken = extractBearer(request);
  if (!incomingToken || !constantTimeEqual(incomingToken, env.ARIA_RUNTIME_SHARED_SECRET)) return json({ error: "unauthorized" }, 401);
  const body = await request.text();
  const upstream = await fetch(RUNTIME_GATEWAY, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}` },
    body
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
async function startMission(request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.ARIA_RUNTIME_SHARED_SECRET) return json({ error: "runtime_secret_not_configured" }, 500);
  const incomingToken = extractBearer(request);
  if (!incomingToken || !constantTimeEqual(incomingToken, env.ARIA_RUNTIME_SHARED_SECRET)) return json({ error: "unauthorized" }, 401);
  const body = await request.text();
  const upstream = await fetch(MISSION_INTAKE, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}` },
    body
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
async function directAria(request, env) {
  if (request.method === "GET") return fetch(DIRECT_ARIA, { method: "GET" });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.ARIA_RUNTIME_SHARED_SECRET) return json({ error: "runtime_secret_not_configured" }, 500);
  const incomingToken = extractBearer(request);
  if (!incomingToken || !constantTimeEqual(incomingToken, env.ARIA_RUNTIME_SHARED_SECRET)) return json({ error: "unauthorized" }, 401);
  const body = await request.text();
  const upstream = await fetch(DIRECT_ARIA, {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}` },
    body
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
async function runScheduledMission(env) {
  if (!env.ARIA_RUNTIME_SHARED_SECRET) {
    console.error("[ARIA CRON] runtime secret not configured");
    return;
  }
  try {
    const response = await fetch(CANONICAL_RUNTIME, {
      method: "POST",
      headers: { "content-type": "application/json", "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}` },
      body: "{}"
    });
    console.log(`[ARIA CRON] canonical-runtime status=${response.status}`);
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[ARIA CRON] canonical-runtime failure status=${response.status} body=${text.slice(0, 500)}`);
    }
  } catch (error) {
    console.error(`[ARIA CRON] canonical-runtime request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledMission(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/autonomy-health") return autonomyHealth(request);
    if (request.method === "GET" && (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp")) {
      return json(protectedResourceMetadata(), 200, { "access-control-allow-origin": "*" });
    }
    if (request.method === "GET" && (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v2" || url.pathname === "/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v3")) {
      return json(authorizationServerMetadata(), 200, { "access-control-allow-origin": "*" });
    }
    if (url.pathname === "/authorize" || url.pathname === "/authorize/" || url.pathname.startsWith("/authorize/")) return proxyOAuth(request, url);
    if (["/token", "/token/", "/register", "/register/"].includes(url.pathname)) return proxyOAuth(request, url);
    if (url.pathname === "/aria" || url.pathname === "/aria/") return directAria(request, env);
    if (url.pathname === "/mission" || url.pathname === "/mission/") return startMission(request, env);
    if (url.pathname === "/runtime" || url.pathname === "/runtime/") return proxyRuntime(request, env);
    if (url.pathname === "/admin/cloudflare" || url.pathname === "/admin/cloudflare/") return cloudflareAdmin(request, env);
    if (url.pathname === "/admin/cloudflare/token" || url.pathname === "/admin/cloudflare/token/") return cloudflareTokenManager(request, env);
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const upstreamUrl = new URL(SUPABASE_MCP);
      upstreamUrl.search = url.search;
      const headers = new Headers(request.headers);
      const incomingTrace = headers.get("X-ARIA-Trace-Id");
      if (incomingTrace) headers.set("X-ARIA-Trace-Id", incomingTrace);
      const upstream = await fetch(new Request(upstreamUrl.toString(), {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual"
      }));
      if (upstream.status === 401) return rewriteAuthChallenge(upstream);
      return upstream;
    }
    if (url.pathname === "/" || url.pathname === "") {
      return Response.redirect(`${url.origin}/mcp`, 308);
    }
    return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
};

// Phase 1 certification trigger: keep deployment path exercised after autonomous fallback rollout.
