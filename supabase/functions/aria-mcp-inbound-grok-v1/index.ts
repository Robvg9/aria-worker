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

const ISSUER = RESOURCE;
const SCOPE = "aria.mcp.inbound";
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
];

const db = () =>
  createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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

async function issueAccessToken(clientId: string): Promise<{ token: string; expiresIn: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(te.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = b64url(
    te.encode(
      JSON.stringify({
        iss: ISSUER,
        aud: RESOURCE,
        sub: clientId,
        scope: SCOPE,
        iat: now,
        exp: now + ACCESS_TTL_SEC,
        token_use: "access",
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(await hmacSign(signingInput));
  return { token: `${signingInput}.${sig}`, expiresIn: ACCESS_TTL_SEC };
}

async function verifyAccessToken(token: string): Promise<{ clientId: string } | null> {
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
  if (claims.scope !== SCOPE && claims.scope !== `openid ${SCOPE}`) return null;
  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return { clientId: claims.sub };
}

async function issueRefreshToken(clientId: string, rotatedFrom?: string): Promise<string> {
  const raw = `aria_rt_${randomToken(40)}`;
  const hash = b64url(await sha256(raw));
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SEC * 1000).toISOString();
  const row: Record<string, unknown> = {
    token_hash: hash,
    client_id: clientId,
    scope: SCOPE,
    resource: RESOURCE,
    expires_at: expiresAt,
  };
  if (rotatedFrom) row.rotated_from = rotatedFrom;
  const { error } = await db().from("aria_mcp_oauth_refresh_tokens").insert(row);
  if (error) throw new Error(`refresh_persist_failed: ${error.message}`);
  return raw;
}

async function consumeRefreshToken(raw: string): Promise<{ clientId: string } | null> {
  const hash = b64url(await sha256(raw));
  const { data } = await db()
    .from("aria_mcp_oauth_refresh_tokens")
    .select("id, client_id, expires_at, revoked_at, resource")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  if (data.resource !== RESOURCE) return null;
  await db()
    .from("aria_mcp_oauth_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", data.id);
  return { clientId: data.client_id };
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
  const meta = `${RESOURCE}/.well-known/oauth-protected-resource`;
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
    scopes_supported: [SCOPE],
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
    scopes_supported: [SCOPE],
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

function consentPage(pendingId: string, clientName: string): string {
  const safeName = clientName.replace(/[<>&"]/g, "");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Authorize ARIA</title>
<style>
body{font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#111}
button{font:inherit;padding:12px 16px;width:100%;cursor:pointer;border-radius:8px;border:0;background:#111;color:#fff}
.card{border:1px solid #e5e5e5;border-radius:12px;padding:20px}
.muted{color:#666;font-size:14px}
</style></head><body>
<div class="card">
  <h1>Authorize ARIA MCP</h1>
  <p><strong>${safeName}</strong> is requesting access to ARIA read-only tools.</p>
  <p class="muted">Scope: <code>${SCOPE}</code><br/>Resource: ARIA inbound MCP</p>
  <form method="post" action="${ISSUER}/authorize/consent">
    <input type="hidden" name="pending_id" value="${pendingId}"/>
    <input type="hidden" name="decision" value="allow"/>
    <button type="submit">Authorize</button>
  </form>
  <form method="post" action="${ISSUER}/authorize/consent" style="margin-top:8px">
    <input type="hidden" name="pending_id" value="${pendingId}"/>
    <input type="hidden" name="decision" value="deny"/>
    <button type="submit" style="background:#eee;color:#111">Deny</button>
  </form>
</div>
</body></html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Grok Web requires the OAuth challenge during the initial MCP handshake.
  // Keep OAuth metadata/authorization endpoints public; protect the MCP resource itself.
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
    if (scope.trim() && !scope.split(/\s+/).includes(SCOPE) && scope !== SCOPE) {
      return json(400, { error: "invalid_scope" });
    }
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
      expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
    });
    if (error) return json(500, { error: "authorization_state_failed", detail: error.message });

    const clientName =
      /^https:\/\//i.test(clientId)
        ? "Grok (CIMD)"
        : clientId.startsWith("aria_")
          ? "Grok Custom Connector"
          : clientId;
    return html(200, consentPage(pendingId, clientName));
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
    const code = `aria_code_${randomToken(24)}`;
    const { error } = await db().from("aria_mcp_oauth_codes").insert({
      code,
      client_id: pending.client_id,
      redirect_uri: pending.redirect_uri,
      code_challenge: pending.code_challenge,
      code_challenge_method: pending.code_challenge_method,
      user_id: null,
      encrypted_access_token: null,
      scope: SCOPE,
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

      const access = await issueAccessToken(clientId);
      const refresh = await issueRefreshToken(clientId);
      return json(200, {
        access_token: access.token,
        token_type: "Bearer",
        expires_in: access.expiresIn,
        refresh_token: refresh,
        scope: SCOPE,
        resource: RESOURCE,
      });
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
      const access = await issueAccessToken(consumed.clientId);
      const newRefresh = await issueRefreshToken(consumed.clientId);
      return json(200, {
        access_token: access.token,
        token_type: "Bearer",
        expires_in: access.expiresIn,
        refresh_token: newRefresh,
        scope: SCOPE,
        resource: RESOURCE,
      });
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
  const textResult = (payload: unknown) =>
    json(
      200,
      rpc(id, {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        isError: false,
      }),
      sessionHeaders(req),
    );

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
  if (name === "aria_run_task" || name === "aria_memory_query" || name === "aria_memory_capture") {
    return json(200, rpcError(id, -32601, "tool_not_enabled_in_phase1"), sessionHeaders(req));
  }
  return json(200, rpcError(id, -32601, "unknown_tool"), sessionHeaders(req));
});
