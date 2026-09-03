import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getTraceId, recordTrace, traceHeaders } from "../_shared/aria-trace.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ISSUER = `${SUPABASE_URL}/functions/v1/aria-mcp-oauth-grok-v2`;
const MCP_RESOURCE = `${SUPABASE_URL}/functions/v1/aria-mcp-server-grok-v2`;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
const CODE_TTL_MS = 60_000;
const PENDING_TTL_MS = 10 * 60_000;
const db = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const authClient = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
function json(status: number, body: Record<string, unknown>, traceId: string, extra: HeadersInit = {}) { return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...traceHeaders(traceId), ...extra } }); }
function html(status: number, body: string, traceId: string) { return new Response(body, { status, headers: { ...HTML_HEADERS, ...traceHeaders(traceId) } }); }
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const fromB64url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4)), c => c.charCodeAt(0));
const sha256 = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
async function deriveKey() { return crypto.subtle.importKey("raw", await sha256(SERVICE_ROLE_KEY), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function encryptSecret(value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await deriveKey(); const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value))); return `${b64url(iv)}.${b64url(ciphertext)}`; }
async function decryptSecret(value: string) { const [iv64, ciphertext64] = value.split("."); const key = await deriveKey(); const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(iv64) }, key, fromB64url(ciphertext64)); return new TextDecoder().decode(plaintext); }
async function pkceMatches(verifier: string, challenge: string) { return b64url(await sha256(verifier)) === challenge; }
async function cleanup() { const now = new Date().toISOString(); await db().from("aria_mcp_oauth_pending").delete().lt("expires_at", now); await db().from("aria_mcp_oauth_codes").delete().lt("expires_at", now); }
function metadata() { return { issuer: ISSUER, resource: MCP_RESOURCE, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, registration_endpoint: `${ISSUER}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: ["openid", "profile", "email"] }; }
function authorizationPage(pendingId: string) { return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Authorize ARIA</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px}input,button{font:inherit;width:100%;box-sizing:border-box;padding:10px;margin-top:8px}button{cursor:pointer}</style></head><body><h1>Authorize ARIA</h1><p>ARIA will request permission to use your ChatBending context and memory tools.</p><form method="post" action="${ISSUER}/authorize/start"><input type="hidden" name="pending_id" value="${pendingId}"><label>Email<br><input name="email" type="email" required autocomplete="email"></label><button type="submit">Continue with email</button></form></body></html>`; }
function checkEmailPage(email: string) { const safe = email.replace(/[<>&"]/g, ""); return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px"><h1>Check your email</h1><p>We sent a sign-in link to ${safe}.</p><p>Open the link in this email to authorize ARIA.</p></body></html>`; }
function magicPage(pendingId: string) { return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Completing ARIA authorization</title><style>body{font-family:system-ui,sans-serif;max-width:520px;margin:40px auto;padding:0 16px}</style></head><body><h1 id="title">Completing authorization…</h1><p id="message">Please wait while ARIA completes the secure sign-in.</p><script>(async()=>{try{const hash=new URLSearchParams(location.hash.replace(/^#/,""));const accessToken=hash.get("access_token");if(!accessToken)throw new Error("No Supabase session token was returned.");const r=await fetch(${JSON.stringify(ISSUER)}+"/authorize/consume",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({pending_id:${JSON.stringify(pendingId)},access_token:accessToken})});const d=await r.json();if(!r.ok||!d.redirect_uri)throw new Error(d.error||"authorization_failed");location.replace(d.redirect_uri)}catch(e){document.getElementById("title").textContent="Authorization failed";document.getElementById("message").textContent=String(e&&e.message?e.message:e)}})();</script></body></html>`; }

Deno.serve(async req => {
  const traceId = getTraceId(req);
  const started = Date.now();
  const u = new URL(req.url);
  await cleanup();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...JSON_HEADERS, ...traceHeaders(traceId), "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,x-aria-trace-id,authorization" } });
  const isMetadata = req.method === "GET" && (u.pathname.endsWith("/.well-known/oauth-authorization-server") || u.pathname === "/.well-known/oauth-authorization-server/functions/v1/aria-mcp-oauth-grok-v2");
  if (isMetadata) return json(200, metadata(), traceId, { "access-control-allow-origin": "*" });

  if (req.method === "POST" && u.pathname.endsWith("/register")) {
    let body: any; try { body = await req.json(); } catch { return json(400, { error: "invalid_client_metadata" }, traceId); }
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((v: unknown): v is string => typeof v === "string" && v.length > 0) : [];
    if (!redirectUris.length || typeof body.client_name !== "string" || !body.client_name.trim()) return json(400, { error: "invalid_client_metadata" }, traceId);
    for (const uri of redirectUris) if (!/^https:\/\//.test(uri) && !/^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(uri) && !/^http:\/\/localhost(?::\d+)?\//.test(uri)) return json(400, { error: "invalid_redirect_uri" }, traceId);
    const clientId = `aria_${crypto.randomUUID()}`;
    const { error } = await db().from("aria_mcp_oauth_clients").insert({ client_id: clientId, client_name: body.client_name.trim().slice(0, 120), redirect_uris: redirectUris });
    if (error) return json(500, { error: "registration_failed" }, traceId);
    return json(201, { client_id: clientId, client_name: body.client_name.trim().slice(0, 120), redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }, traceId);
  }

  if (req.method === "GET" && u.pathname.endsWith("/authorize")) {
    const clientId = u.searchParams.get("client_id") ?? "";
    const redirectUri = u.searchParams.get("redirect_uri") ?? "";
    const responseType = u.searchParams.get("response_type") ?? "";
    const state = u.searchParams.get("state") ?? "";
    const challenge = u.searchParams.get("code_challenge") ?? "";
    const method = u.searchParams.get("code_challenge_method") ?? "";
    if (responseType !== "code" || method !== "S256" || !state || !challenge) return json(400, { error: "invalid_request" }, traceId);
    const { data: client } = await db().from("aria_mcp_oauth_clients").select("client_id,redirect_uris").eq("client_id", clientId).maybeSingle();
    if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) return json(400, { error: "invalid_client" }, traceId);
    const pendingId = crypto.randomUUID();
    const { error } = await db().from("aria_mcp_oauth_pending").insert({ id: pendingId, client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: method, trace_id: traceId, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() });
    if (error) return json(500, { error: "authorization_state_failed" }, traceId);
    return html(200, authorizationPage(pendingId), traceId);
  }

  if (req.method === "POST" && u.pathname.endsWith("/authorize/start")) {
    const form = await req.formData();
    const pendingId = String(form.get("pending_id") ?? "");
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const { data: pending } = await db().from("aria_mcp_oauth_pending").select("id,expires_at,trace_id,client_id").eq("id", pendingId).maybeSingle();
    const flowTrace = pending?.trace_id ?? traceId;
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now() || !/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: "invalid_request" }, flowTrace);
    const emailRedirectTo = `${ISSUER}/authorize/magic?pending_id=${encodeURIComponent(pendingId)}`;
    const { error } = await authClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } });
    if (error) return json(400, { error: "otp_send_failed" }, flowTrace);
    await db().from("aria_mcp_oauth_pending").update({ email }).eq("id", pendingId);
    return html(200, checkEmailPage(email), flowTrace);
  }

  if (req.method === "GET" && u.pathname.endsWith("/authorize/magic")) {
    const pendingId = u.searchParams.get("pending_id") ?? "";
    const { data: pending } = await db().from("aria_mcp_oauth_pending").select("id,expires_at,trace_id").eq("id", pendingId).maybeSingle();
    const flowTrace = pending?.trace_id ?? traceId;
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) return html(400, "<!doctype html><html><body><h1>Authorization expired</h1><p>Start again from Grok.</p></body></html>", flowTrace);
    return html(200, magicPage(pendingId), flowTrace);
  }

  if (req.method === "POST" && u.pathname.endsWith("/authorize/consume")) {
    let body: any; try { body = await req.json(); } catch { return json(400, { error: "invalid_request" }, traceId); }
    const pendingId = String(body.pending_id ?? ""); const accessToken = String(body.access_token ?? "");
    if (!pendingId || !accessToken) return json(400, { error: "invalid_request" }, traceId);
    const { data: pending } = await db().from("aria_mcp_oauth_pending").select("*").eq("id", pendingId).maybeSingle();
    const flowTrace = pending?.trace_id ?? traceId;
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) return json(400, { error: "authorization_expired" }, flowTrace);
    const { data: { user }, error: userError } = await authClient().auth.getUser(accessToken);
    if (userError || !user) return json(400, { error: "invalid_session" }, flowTrace);
    const code = `aria_code_${crypto.randomUUID()}`;
    const encryptedAccessToken = await encryptSecret(accessToken);
    const { error: insertError } = await db().from("aria_mcp_oauth_codes").insert({ code, client_id: pending.client_id, redirect_uri: pending.redirect_uri, code_challenge: pending.code_challenge, code_challenge_method: pending.code_challenge_method, user_id: user.id, encrypted_access_token: encryptedAccessToken, scope: "openid profile email", trace_id: flowTrace, expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() });
    if (insertError) return json(500, { error: "authorization_failed" }, flowTrace);
    await db().from("aria_mcp_oauth_pending").delete().eq("id", pendingId);
    const redirect = new URL(pending.redirect_uri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", pending.state);
    redirect.searchParams.set("iss", ISSUER);
    return json(200, { redirect_uri: redirect.toString() }, flowTrace);
  }

  if (req.method === "POST" && u.pathname.endsWith("/token")) {
    let body: any; const ct = req.headers.get("content-type") ?? "";
    try { body = ct.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(await req.text())) : await req.json(); } catch { return json(400, { error: "invalid_request" }, traceId); }
    if (body.grant_type !== "authorization_code" || typeof body.code !== "string" || typeof body.code_verifier !== "string" || typeof body.client_id !== "string" || typeof body.redirect_uri !== "string") return json(400, { error: "invalid_request" }, traceId);
    const { data: record } = await db().from("aria_mcp_oauth_codes").select("*").eq("code", body.code).maybeSingle();
    const flowTrace = record?.trace_id ?? traceId;
    if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now()) return json(400, { error: "invalid_grant" }, flowTrace);
    if (record.client_id !== body.client_id || record.redirect_uri !== body.redirect_uri || !(await pkceMatches(body.code_verifier, record.code_challenge))) return json(400, { error: "invalid_grant" }, flowTrace);
    const accessToken = await decryptSecret(record.encrypted_access_token);
    await db().from("aria_mcp_oauth_codes").update({ used_at: new Date().toISOString() }).eq("code", body.code);
    return json(200, { access_token: accessToken, token_type: "Bearer", expires_in: 3600, scope: record.scope ?? "openid profile email" }, flowTrace);
  }

  return json(404, { error: "not_found" }, traceId);
});