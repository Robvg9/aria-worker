import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ISSUER = `${SUPABASE_URL}/functions/v1/aria-mcp-oauth-grok-v2`;
const MCP_RESOURCE = `${SUPABASE_URL}/functions/v1/aria-mcp-server-grok-v2`;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const CODE_TTL_MS = 60_000;
const PENDING_TTL_MS = 10 * 60_000;
const db = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const authClient = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (status: number, body: Record<string, unknown>, extra: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const escapeHtml = (s: string) => s.replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]!));
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
const sha256 = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function deriveKey() { return crypto.subtle.importKey("raw", await sha256(SERVICE_ROLE_KEY), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function encryptSecret(value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await deriveKey(); const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value))); return `${b64url(iv)}.${b64url(ciphertext)}`; }
async function decryptSecret(value: string) { const [iv64, ct64] = value.split("."); const key = await deriveKey(); const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv64) }, key, fromB64url(ct64)); return new TextDecoder().decode(plaintext); }
async function pkceMatches(verifier: string, challenge: string) { return b64url(await sha256(verifier)) === challenge; }
async function cleanup() { const now = new Date().toISOString(); await db().from("aria_mcp_oauth_pending").delete().lt("expires_at", now); await db().from("aria_mcp_oauth_codes").delete().lt("expires_at", now); }
function metadata() { return { issuer: ISSUER, resource: MCP_RESOURCE, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, registration_endpoint: `${ISSUER}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["openid", "profile", "email"] }; }
Deno.serve(async req => {
  const u = new URL(req.url); await cleanup();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } });
  const isStandardMetadata = req.method === "GET" && u.pathname === "/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v2";
  const isLegacyMetadata = req.method === "GET" && u.pathname.endsWith("/.well-known/oauth-authorization-server");
  if (isStandardMetadata || isLegacyMetadata) return json(200, metadata(), { "access-control-allow-origin": "*" });
  if (req.method === "POST" && u.pathname.endsWith("/register")) {
    let body: any; try { body = await req.json(); } catch { return json(400, { error: "invalid_client_metadata" }); }
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((v: unknown) => typeof v === "string" && v.length > 0) : [];
    if (!redirectUris.length || typeof body.client_name !== "string" || !body.client_name.trim()) return json(400, { error: "invalid_client_metadata" });
    for (const uri of redirectUris) if (!/^https:\/\//.test(uri) && !/^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(uri) && !/^http:\/\/localhost(?::\d+)?\//.test(uri)) return json(400, { error: "invalid_redirect_uri" });
    const clientId = `aria_${crypto.randomUUID()}`; const { error } = await db().from("aria_mcp_oauth_clients").insert({ client_id: clientId, client_name: body.client_name.trim().slice(0, 120), redirect_uris: redirectUris });
    if (error) return json(500, { error: "registration_failed" });
    return json(201, { client_id: clientId, client_name: body.client_name.trim().slice(0, 120), redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] });
  }
  if (req.method === "GET" && u.pathname.endsWith("/authorize")) {
    const clientId = u.searchParams.get("client_id") ?? "", redirectUri = u.searchParams.get("redirect_uri") ?? "", responseType = u.searchParams.get("response_type") ?? "", state = u.searchParams.get("state") ?? "", challenge = u.searchParams.get("code_challenge") ?? "", method = u.searchParams.get("code_challenge_method") ?? "";
    if (responseType !== "code" || method !== "S256" || !state || !challenge) return json(400, { error: "invalid_request" });
    const { data: client } = await db().from("aria_mcp_oauth_clients").select("client_id,client_name,redirect_uris").eq("client_id", clientId).maybeSingle();
    if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) return json(400, { error: "invalid_client" });
    const pendingId = crypto.randomUUID(); const { error } = await db().from("aria_mcp_oauth_pending").insert({ id: pendingId, client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: method, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() });
    if (error) return json(500, { error: "authorization_state_failed" }); const ui = new URL(`${ISSUER}/authorize/ui`); ui.searchParams.set("pending_id", pendingId); return Response.redirect(ui.toString(), 302);
  }
  if (req.method === "GET" && u.pathname.endsWith("/authorize/ui")) {
    const pendingId = u.searchParams.get("pending_id") ?? ""; const { data: pending } = await db().from("aria_mcp_oauth_pending").select("id,client_id,expires_at").eq("id", pendingId).maybeSingle();
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) return json(400, { error: "authorization_expired" }); const { data: client } = await db().from("aria_mcp_oauth_clients").select("client_name").eq("client_id", pending.client_id).maybeSingle();
    return html(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Authorize ARIA</title></head><body style="font-family:sans-serif;max-width:520px;margin:40px auto;padding:0 16px"><h1>Authorize ${escapeHtml(client?.client_name ?? "client")}</h1><p>ARIA will request permission to use your ChatBending context and memory tools.</p><form method="post" action="${ISSUER}/authorize/start"><input type="hidden" name="pending_id" value="${escapeHtml(pendingId)}"><label>Email<br><input name="email" type="email" required autocomplete="email" style="width:100%;padding:10px;box-sizing:border-box"></label><button style="margin-top:16px;padding:10px 16px">Send code</button></form></body></html>`);
  }
  if (req.method === "POST" && u.pathname.endsWith("/authorize/start")) {
    const form = await req.formData(), pendingId = String(form.get("pending_id") ?? ""), email = String(form.get("email") ?? "").trim().toLowerCase();
    if (!pendingId || !/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: "invalid_request" }); const { data: pending } = await db().from("aria_mcp_oauth_pending").select("id,expires_at").eq("id", pendingId).maybeSingle(); if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) return json(400, { error: "authorization_expired" });
    const { error } = await authClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false } }); if (error) return json(400, { error: "otp_send_failed" }); await db().from("aria_mcp_oauth_pending").update({ email }).eq("id", pendingId);
    return html(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Verify ARIA</title></head><body style="font-family:sans-serif;max-width:520px;margin:40px auto;padding:0 16px"><h1>Enter verification code</h1><p>A one-time code was sent to ${escapeHtml(email)}.</p><form method="post" action="${ISSUER}/authorize/verify"><input type="hidden" name="pending_id" value="${escapeHtml(pendingId)}"><input name="token" inputmode="numeric" autocomplete="one-time-code" minlength="6" maxlength="8" required style="width:100%;padding:10px;box-sizing:border-box"><button style="margin-top:16px;padding:10px 16px">Authorize</button></form></body></html>`);
  }
  if (req.method === "POST" && u.pathname.endsWith("/authorize/verify")) {
    const form = await req.formData(), pendingId = String(form.get("pending_id") ?? ""), otp = String(form.get("token") ?? "").trim(); const { data: pending } = await db().from("aria_mcp_oauth_pending").select("*").eq("id", pendingId).maybeSingle();
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now() || !pending.email || !/^\d{6,8}$/.test(otp)) return json(400, { error: "invalid_authorization" }); const { data: verified, error } = await authClient().auth.verifyOtp({ email: pending.email, token: otp, type: "email" }); if (error || !verified.session || !verified.user) return json(400, { error: "invalid_grant" });
    const code = `aria_code_${crypto.randomUUID()}`, encryptedAccessToken = await encryptSecret(verified.session.access_token); const { error: insertError } = await db().from("aria_mcp_oauth_codes").insert({ code, client_id: pending.client_id, redirect_uri: pending.redirect_uri, code_challenge: pending.code_challenge, code_challenge_method: pending.code_challenge_method, user_id: verified.user.id, encrypted_access_token: encryptedAccessToken, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() }); await db().from("aria_mcp_oauth_pending").delete().eq("id", pendingId); if (insertError) return json(500, { error: "authorization_failed" });
    const redirect = new URL(pending.redirect_uri); redirect.searchParams.set("code", code); redirect.searchParams.set("state", pending.state); redirect.searchParams.set("iss", ISSUER); return Response.redirect(redirect.toString(), 302);
  }
  if (req.method === "POST" && u.pathname.endsWith("/token")) {
    let body: any; const ct = req.headers.get("content-type") ?? ""; try { body = ct.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(await req.text())) : await req.json(); } catch { return json(400, { error: "invalid_request" }); }
    if (body.grant_type !== "authorization_code" || typeof body.code !== "string" || typeof body.code_verifier !== "string" || typeof body.client_id !== "string" || typeof body.redirect_uri !== "string") return json(400, { error: "invalid_request" }); const { data: record } = await db().from("aria_mcp_oauth_codes").select("*").eq("code", body.code).maybeSingle(); if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now()) return json(400, { error: "invalid_grant" }); if (record.client_id !== body.client_id || record.redirect_uri !== body.redirect_uri || !(await pkceMatches(body.code_verifier, record.code_challenge))) return json(400, { error: "invalid_grant" });
    const accessToken = await decryptSecret(record.encrypted_access_token); await db().from("aria_mcp_oauth_codes").update({ used_at: new Date().toISOString() }).eq("code", body.code); return json(200, { access_token: accessToken, token_type: "Bearer", expires_in: 3600, scope: record.scope ?? "openid profile email" });
  }
  return json(404, { error: "not_found" });
});