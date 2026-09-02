import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getTraceId, recordTrace, traceHeaders } from "../_shared/aria-trace.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ISSUER = `${SUPABASE_URL}/functions/v1/aria-mcp-oauth-grok-v2`;
const MCP_RESOURCE = `${SUPABASE_URL}/functions/v1/aria-mcp-server-grok-v2`;
const STATIC_UI = "https://cdn.jsdelivr.net/gh/Robvg9/aria-worker@main/integrations/grok/oauth-ui.html";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const CODE_TTL_MS = 60_000;
const PENDING_TTL_MS = 10 * 60_000;
const db = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const authClient = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (status: number, body: Record<string, unknown>, traceId: string, extra: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...traceHeaders(traceId), ...extra } });
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function deriveKey() { return crypto.subtle.importKey("raw", await sha256(SERVICE_ROLE_KEY), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function encryptSecret(value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await deriveKey(); const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value))); return `${b64url(iv)}.${b64url(ciphertext)}`; }
async function decryptSecret(value: string) { const [iv64, ct64] = value.split("."); const key = await deriveKey(); const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv64) }, key, fromB64url(ct64)); return new TextDecoder().decode(plaintext); }
async function pkceMatches(verifier: string, challenge: string) { return b64url(await sha256(verifier)) === challenge; }
async function cleanup() { const now = new Date().toISOString(); await db().from("aria_mcp_oauth_pending").delete().lt("expires_at", now); await db().from("aria_mcp_oauth_codes").delete().lt("expires_at", now); }
function metadata() { return { issuer: ISSUER, resource: MCP_RESOURCE, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, registration_endpoint: `${ISSUER}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["openid", "profile", "email"] }; }
function uiRedirect(pendingId: string, mode = "email") { const u = new URL(STATIC_UI); u.searchParams.set("pending_id", pendingId); u.searchParams.set("mode", mode); return Response.redirect(u.toString(), 302); }

Deno.serve(async req => {
  const traceId = getTraceId(req);
  const started = Date.now();
  const u = new URL(req.url);
  await cleanup();

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...JSON_HEADERS, ...traceHeaders(traceId), "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,x-aria-trace-id" } });

  const isStandardMetadata = req.method === "GET" && u.pathname === "/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v2";
  const isLegacyMetadata = req.method === "GET" && u.pathname.endsWith("/.well-known/oauth-authorization-server");
  if (isStandardMetadata || isLegacyMetadata) {
    await recordTrace({ traceId, stage: "oauth.metadata", component: "aria-mcp-oauth-grok-v2", outcome: "success", method: "GET", path: u.pathname, statusCode: 200, latencyMs: Date.now() - started });
    return json(200, metadata(), traceId, { "access-control-allow-origin": "*" });
  }

  if (req.method === "POST" && u.pathname.endsWith("/register")) {
    let body: any;
    try { body = await req.json(); } catch { await recordTrace({ traceId, stage: "oauth.register", component: "aria-mcp-oauth-grok-v2", outcome: "error", method: "POST", path: u.pathname, statusCode: 400, errorCode: "invalid_client_metadata" }); return json(400, { error: "invalid_client_metadata" }, traceId); }
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((v: unknown) => typeof v === "string" && v.length > 0) : [];
    if (!redirectUris.length || typeof body.client_name !== "string" || !body.client_name.trim()) return json(400, { error: "invalid_client_metadata" }, traceId);
    for (const uri of redirectUris) if (!/^https:\/\//.test(uri) && !/^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(uri) && !/^http:\/\/localhost(?::\d+)?\//.test(uri)) return json(400, { error: "invalid_redirect_uri" }, traceId);
    const clientId = `aria_${crypto.randomUUID()}`;
    const { error } = await db().from("aria_mcp_oauth_clients").insert({ client_id: clientId, client_name: body.client_name.trim().slice(0, 120), redirect_uris: redirectUris });
    if (error) return json(500, { error: "registration_failed" }, traceId);
    await recordTrace({ traceId, stage: "oauth.register", component: "aria-mcp-oauth-grok-v2", outcome: "success", method: "POST", path: u.pathname, statusCode: 201, clientId, latencyMs: Date.now() - started, details: { redirect_count: redirectUris.length } });
    return json(201, { client_id: clientId, client_name: body.client_name.trim().slice(0, 120), redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }, traceId);
  }

  if (req.method === "GET" && u.pathname.endsWith("/authorize")) {
    const clientId = u.searchParams.get("client_id") ?? "", redirectUri = u.searchParams.get("redirect_uri") ?? "", responseType = u.searchParams.get("response_type") ?? "", state = u.searchParams.get("state") ?? "", challenge = u.searchParams.get("code_challenge") ?? "", method = u.searchParams.get("code_challenge_method") ?? "";
    if (responseType !== "code" || method !== "S256" || !state || !challenge) return json(400, { error: "invalid_request" }, traceId);
    const { data: client } = await db().from("aria_mcp_oauth_clients").select("client_id,client_name,redirect_uris").eq("client_id", clientId).maybeSingle();
    if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) { await recordTrace({ traceId, stage: "oauth.authorize", component: "aria-mcp-oauth-grok-v2", outcome: "rejected", method: "GET", path: u.pathname, statusCode: 400, clientId, errorCode: "invalid_client", latencyMs: Date.now() - started }); return json(400, { error: "invalid_client" }, traceId); }
    const pendingId = crypto.randomUUID();
    const { error } = await db().from("aria_mcp_oauth_pending").insert({ id: pendingId, client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: method, trace_id: traceId, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() });
    if (error) return json(500, { error: "authorization_state_failed" }, traceId);
    await recordTrace({ traceId, stage: "oauth.authorize", component: "aria-mcp-oauth-grok-v2", outcome: "redirect_ui", method: "GET", path: u.pathname, statusCode: 302, clientId, latencyMs: Date.now() - started, details: { pending_id_present: true, pkce: method } });
    return uiRedirect(pendingId);
  }

  if (req.method === "GET" && u.pathname.endsWith("/authorize/ui")) {
    const pendingId = u.searchParams.get("pending_id") ?? "";
    const { data: pending } = await db().from("aria_mcp_oauth_pending").select("id,client_id,expires_at,trace_id").eq("id", pendingId).maybeSingle();
    const flowTrace = pending?.trace_id ?? traceId;
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) return json(400, { error: "authorization_expired" }, flowTrace);
    return uiRedirect(pendingId);
  }

  if (req.method === "POST" && u.pathname.endsWith("/authorize/start")) {
    const form = await req.formData(), pendingId = String(form.get("pending_id") ?? ""), email = String(form.get("email") ?? "").trim().toLowerCase();
    const { data: pending } = await db().from("aria_mcp_oauth_pending").select("id,expires_at,trace_id,client_id").eq("id", pendingId).maybeSingle();
    const flowTrace = pending?.trace_id ?? traceId;
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now() || !/^\S+@\S+\.\S+$/.test(email)) { await recordTrace({ traceId: flowTrace, stage: "oauth.otp", component: "aria-mcp-oauth-grok-v2", outcome: "rejected", method: "POST", path: u.pathname, statusCode: 400, clientId: pending?.client_id, errorCode: "invalid_request", latencyMs: Date.now() - started }); return json(400, { error: "invalid_request" }, flowTrace); }
    const { error } = await authClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) { await recordTrace({ traceId: flowTrace, stage: "oauth.otp", component: "aria-mcp-oauth-grok-v2", outcome: "error", method: "POST", path: u.pathname, statusCode: 400, clientId: pending.client_id, errorCode: "otp_send_failed", latencyMs: Date.now() - started }); return json(400, { error: "otp_send_failed" }, flowTrace); }
    await db().from("aria_mcp_oauth_pending").update({ email }).eq("id", pendingId);
    await recordTrace({ traceId: flowTrace, stage: "oauth.otp", component: "aria-mcp-oauth-grok-v2", outcome: "sent", method: "POST", path: u.pathname, statusCode: 302, clientId: pending.client_id, latencyMs: Date.now() - started });
    return uiRedirect(pendingId, "otp");
  }

  if (req.method === "POST" && u.pathname.endsWith("/authorize/verify")) {
    const form = await req.formData(), pendingId = String(form.get("pending_id") ?? ""), otp = String(form.get("token") ?? "").trim();
    const { data: pending } = await db().from("aria_mcp_oauth_pending").select("*").eq("id", pendingId).maybeSingle();
    const flowTrace = pending?.trace_id ?? traceId;
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now() || !pending.email || !/^\d{6,8}$/.test(otp)) return json(400, { error: "invalid_authorization" }, flowTrace);
    const { data: verified, error } = await authClient().auth.verifyOtp({ email: pending.email, token: otp, type: "email" });
    if (error || !verified.session || !verified.user) { await recordTrace({ traceId: flowTrace, stage: "oauth.callback", component: "aria-mcp-oauth-grok-v2", outcome: "rejected", method: "POST", path: u.pathname, statusCode: 400, clientId: pending.client_id, errorCode: "invalid_grant", latencyMs: Date.now() - started }); return json(400, { error: "invalid_grant" }, flowTrace); }
    const code = `aria_code_${crypto.randomUUID()}`;
    const encryptedAccessToken = await encryptSecret(verified.session.access_token);
    const { error: insertError } = await db().from("aria_mcp_oauth_codes").insert({ code, client_id: pending.client_id, redirect_uri: pending.redirect_uri, code_challenge: pending.code_challenge, code_challenge_method: pending.code_challenge_method, user_id: verified.user.id, encrypted_access_token: encryptedAccessToken, trace_id: flowTrace, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() });
    await db().from("aria_mcp_oauth_pending").delete().eq("id", pendingId);
    if (insertError) return json(500, { error: "authorization_failed" }, flowTrace);
    const redirect = new URL(pending.redirect_uri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", pending.state);
    redirect.searchParams.set("iss", ISSUER);
    await recordTrace({ traceId: flowTrace, stage: "oauth.callback", component: "aria-mcp-oauth-grok-v2", outcome: "redirect", method: "POST", path: u.pathname, statusCode: 302, clientId: pending.client_id, latencyMs: Date.now() - started, details: { code_issued: true } });
    return Response.redirect(redirect.toString(), 302);
  }

  if (req.method === "POST" && u.pathname.endsWith("/token")) {
    let body: any;
    const ct = req.headers.get("content-type") ?? "";
    try { body = ct.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(await req.text())) : await req.json(); } catch { return json(400, { error: "invalid_request" }, traceId); }
    if (body.grant_type !== "authorization_code" || typeof body.code !== "string" || typeof body.code_verifier !== "string" || typeof body.client_id !== "string" || typeof body.redirect_uri !== "string") return json(400, { error: "invalid_request" }, traceId);
    const { data: record } = await db().from("aria_mcp_oauth_codes").select("*").eq("code", body.code).maybeSingle();
    const flowTrace = record?.trace_id ?? traceId;
    if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now()) return json(400, { error: "invalid_grant" }, flowTrace);
    if (record.client_id !== body.client_id || record.redirect_uri !== body.redirect_uri || !(await pkceMatches(body.code_verifier, record.code_challenge))) { await recordTrace({ traceId: flowTrace, stage: "oauth.token", component: "aria-mcp-oauth-grok-v2", outcome: "rejected", method: "POST", path: u.pathname, statusCode: 400, clientId: body.client_id, errorCode: "invalid_grant", latencyMs: Date.now() - started }); return json(400, { error: "invalid_grant" }, flowTrace); }
    const accessToken = await decryptSecret(record.encrypted_access_token);
    await db().from("aria_mcp_oauth_codes").update({ used_at: new Date().toISOString() }).eq("code", body.code);
    await recordTrace({ traceId: flowTrace, stage: "oauth.token", component: "aria-mcp-oauth-grok-v2", outcome: "issued", method: "POST", path: u.pathname, statusCode: 200, clientId: body.client_id, latencyMs: Date.now() - started, details: { token_type: "Bearer", expires_in: 3600 } });
    return json(200, { access_token: accessToken, token_type: "Bearer", expires_in: 3600, scope: record.scope ?? "openid profile email" }, flowTrace);
  }

  return json(404, { error: "not_found" }, traceId);
});
