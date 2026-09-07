const SUPABASE_MCP =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-server-grok-v4";
const SUPABASE_OAUTH =
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-oauth-grok-v4";
const PUBLIC_ISSUER = "https://aria.robvg9.workers.dev";
const PUBLIC_RESOURCE = `${PUBLIC_ISSUER}/mcp`;
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
const RESOURCE = PUBLIC_RESOURCE;
const RESOURCE_METADATA = `${PUBLIC_ISSUER}/.well-known/oauth-protected-resource/mcp`;
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
  return { resource: RESOURCE, authorization_servers: [PUBLIC_ISSUER], bearer_methods_supported: ["header"], scopes_supported: SCOPES };
}
function authorizationServerMetadata() {
  return {
    issuer: PUBLIC_ISSUER,
    authorization_endpoint: `${PUBLIC_ISSUER}/authorize`,
    token_endpoint: `${PUBLIC_ISSUER}/token`,
    registration_endpoint: `${PUBLIC_ISSUER}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: SCOPES,
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: false
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
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[ch]));
}
function authorizationPage(pendingId, origin) {
  const id = escapeHtml(pendingId);
  const go = `${origin}/authorize/go`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize ARIA</title>
<style>
:root{color-scheme:dark;--bg:#090b12;--card:#111522;--line:#252b3c;--text:#f6f7fb;--muted:#a5adc2;--accent:#8b5cf6;--accent2:#6366f1}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 500px at 50% 0,#1a1634 0%,var(--bg) 58%);font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;color:var(--text);padding:22px}
.card{width:min(430px,100%);background:rgba(17,21,34,.96);border:1px solid var(--line);border-radius:22px;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:30px}
.logo{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent2));font-weight:800;font-size:20px;margin-bottom:22px}
h1{font-size:26px;margin:0 0 10px}.sub{color:var(--muted);line-height:1.5;margin:0 0 26px}.label{display:block;font-size:13px;color:#c4c9d7;margin-bottom:8px}input{width:100%;padding:14px 15px;border-radius:12px;border:1px solid var(--line);background:#0c101b;color:var(--text);outline:none;font-size:16px}input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(139,92,246,.16)}.btn{display:block;width:100%;margin-top:14px;padding:14px 16px;border-radius:12px;border:0;background:linear-gradient(135deg,var(--accent),var(--accent2));color:white;font-weight:700;font-size:16px;text-align:center;text-decoration:none}.foot{margin-top:18px;font-size:12px;color:#7f879c;text-align:center}
</style></head><body><main class="card"><div class="logo">A</div><h1>Authorize ARIA</h1><p class="sub">Sign in to authorize this Grok connection to ARIA.</p><form method="get" action="${go}"><input type="hidden" name="pending_id" value="${id}"><label class="label" for="email">Email</label><input id="email" name="email" type="email" required autocomplete="email" inputmode="email" placeholder="you@example.com"><button class="btn" type="submit">Continue</button></form><div class="foot">Secure OAuth authorization · ARIA</div></main></body></html>`;
}
async function proxyOAuth(request, url) {
  const upstreamUrl = new URL(SUPABASE_OAUTH);
  let suffix = url.pathname.replace(/^\/(?:oauth\/)?/, "");
  if (url.pathname === "/authorize/go" || url.pathname === "/authorize/go/") suffix = "authorize/start";
  if (suffix) upstreamUrl.pathname = `${upstreamUrl.pathname.replace(/\/$/, "")}/${suffix.replace(/^\//, "")}`;
  if (url.pathname === "/authorize/go" || url.pathname === "/authorize/go/") {
    upstreamUrl.search = "";
    const body = new URLSearchParams();
    body.set("pending_id", url.searchParams.get("pending_id") || "");
    body.set("email", url.searchParams.get("email") || "");
    const response = await fetch(new Request(upstreamUrl.toString(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "manual"
    }));
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    headers.set("content-type", "text/html; charset=utf-8");
    if (response.status >= 400) {
      const raw = await response.text();
      const safe = escapeHtml(raw.slice(0, 1000));
      return new Response(`<!doctype html><html><body style="font-family:system-ui;max-width:520px;margin:40px auto;padding:20px"><h1>Authorization could not continue</h1><p>ARIA could not start the sign-in flow.</p><pre>${safe}</pre></body></html>`, { status: response.status, headers });
    }
    return new Response(await response.text(), { status: response.status, statusText: response.statusText, headers });
  }
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
    responseHeaders.set("referrer-policy", "no-referrer");
    const html = await upstream.text();
    const match = html.match(/name=[\"']pending_id[\"'][^>]*value=[\"']([^\"']+)[\"']/i) || html.match(/value=[\"']([^\"']+)[\"'][^>]*name=[\"']pending_id[\"']/i);
    if (!match || upstream.status !== 200) return new Response(html, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
    return new Response(authorizationPage(match[1], url.origin), { status: 200, headers: responseHeaders });
  }
  if (url.pathname === "/authorize/start" || url.pathname === "/authorize/start/") {
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("content-type", "text/html; charset=utf-8");
    responseHeaders.set("cache-control", "no-store");
    if (upstream.status >= 400) {
      const body = await upstream.text();
      return new Response(`<h1>Authorization could not continue</h1><p>Please go back and try again.</p><pre style="white-space:pre-wrap">${body.replace(/[<>&\"]/g, "")}</pre>`, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
    }
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
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
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" } });
}
async function startMission(request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.ARIA_RUNTIME_SHARED_SECRET) return json({ error: "runtime_secret_not_configured" }, 500);
  const incomingToken = extractBearer(request);
  if (!incomingToken || !constantTimeEqual(incomingToken, env.ARIA_RUNTIME_SHARED_SECRET)) return json({ error: "unauthorized" }, 401);
  const body = await request.text();
  const upstream = await fetch(MISSION_INTAKE, { method: "POST", headers: { "content-type": "application/json", "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}` }, body });
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" } });
}
async function directAria(request, env) {
  if (request.method === "GET") return fetch(DIRECT_ARIA, { method: "GET" });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!env.ARIA_RUNTIME_SHARED_SECRET) return json({ error: "runtime_secret_not_configured" }, 500);
  const incomingToken = extractBearer(request);
  if (!incomingToken || !constantTimeEqual(incomingToken, env.ARIA_RUNTIME_SHARED_SECRET)) return json({ error: "unauthorized" }, 401);
  const body = await request.text();
  const upstream = await fetch(DIRECT_ARIA, { method: "POST", headers: { "content-type": "application/json", "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}` }, body });
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: { "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8", "cache-control": "no-store" } });
}
async function runScheduledMission(env) {
  if (!env.ARIA_RUNTIME_SHARED_SECRET) { console.error("[ARIA CRON] runtime secret not configured"); return; }
  try {
    const response = await fetch(CANONICAL_RUNTIME, { method: "POST", headers: { "content-type": "application/json", "authorization": `Bearer ${env.ARIA_RUNTIME_SHARED_SECRET}` }, body: "{}" });
    console.log(`[ARIA CRON] canonical-runtime status=${response.status}`);
    if (!response.ok) { const text = await response.text().catch(() => ""); console.error(`[ARIA CRON] canonical-runtime failure status=${response.status} body=${text.slice(0, 500)}`); }
  } catch (error) { console.error(`[ARIA CRON] canonical-runtime request failed: ${error instanceof Error ? error.message : String(error)}`); }
}
export default {
  async scheduled(_controller, env, ctx) { ctx.waitUntil(runScheduledMission(env)); },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/autonomy-health") return autonomyHealth(request);
    if (request.method === "GET" && (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp" || url.pathname === "/mcp/.well-known/oauth-protected-resource")) return json(protectedResourceMetadata(), 200, { "access-control-allow-origin": "*" });
    if (request.method === "GET" && (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v2" || url.pathname === "/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v3" || url.pathname === "/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v4")) return json(authorizationServerMetadata(), 200, { "access-control-allow-origin": "*" });
    if (url.pathname === "/authorize" || url.pathname === "/authorize/" || url.pathname.startsWith("/authorize/")) return proxyOAuth(request, url);
    if (["/token", "/token/", "/register", "/register/"].includes(url.pathname)) return proxyOAuth(request, url);
    if (url.pathname === "/aria" || url.pathname === "/aria/") return directAria(request, env);
    if (url.pathname === "/mission" || url.pathname === "/mission/") return startMission(request, env);
    if (url.pathname === "/runtime" || url.pathname === "/runtime/") return proxyRuntime(request, env);
    if (url.pathname === "/admin/cloudflare" || url.pathname === "/admin/cloudflare/") return cloudflareAdmin(request, env);
    if (url.pathname === "/admin/cloudflare/token" || url.pathname === "/admin/cloudflare/token/") return cloudflareTokenManager(request, env);
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const upstreamUrl = new URL(SUPABASE_MCP); upstreamUrl.search = url.search;
      const headers = new Headers(request.headers);
      const upstream = await fetch(new Request(upstreamUrl.toString(), { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body, redirect: "manual" }));
      if (upstream.status === 401) return rewriteAuthChallenge(upstream);
      return upstream;
    }
    if (url.pathname === "/" || url.pathname === "") return Response.redirect(`${url.origin}/mcp`, 308);
    return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
};

// Grok OAuth hardening: native GET navigation for Continue, server-side POST to Supabase, polished authorization UI.