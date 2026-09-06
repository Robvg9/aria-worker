import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getTraceId, traceHeaders } from "../_shared/aria-trace.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ISSUER = `${SUPABASE_URL}/functions/v1/aria-mcp-oauth-grok-v3`;
const RESOURCE = "https://aria.robvg9.workers.dev/mcp";
const SCOPES = ["openid", "profile", "email"];
const db = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const auth = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const codeTtl = 60_000;
const pendingTtl = 10 * 60_000;
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const unb64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4)), c => c.charCodeAt(0));
const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
const pkce = async (verifier: string, challenge: string) => b64(await hash(verifier)) === challenge;
const enc = (value: string) => encodeURIComponent(value);
async function deriveKey() { return crypto.subtle.importKey("raw", await hash(SERVICE_ROLE_KEY), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function encryptSecret(value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await deriveKey(); const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value))); return `${b64(iv)}.${b64(ciphertext)}`; }
async function decryptSecret(value: string) { const [iv64, ciphertext64] = value.split("."); const key = await deriveKey(); const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv64) }, key, unb64(ciphertext64)); return new TextDecoder().decode(plaintext); }
const json = (status: number, body: Record<string, unknown>, traceId: string, extra: HeadersInit = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...traceHeaders(traceId), ...extra } });
const html = (status: number, body: string, traceId: string) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...traceHeaders(traceId) } });
function metadata() { return { issuer: ISSUER, resource: RESOURCE, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, registration_endpoint: `${ISSUER}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: SCOPES, authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true }; }
async function clientFromRequest(clientId: string, redirectUri: string) {
  if (/^https:\/\//.test(clientId)) {
    const response = await fetch(clientId, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const doc = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!doc || doc.client_id !== clientId || typeof doc.client_name !== "string" || !Array.isArray(doc.redirect_uris)) return null;
    const redirectUris = doc.redirect_uris.filter((v): v is string => typeof v === "string");
    return redirectUris.includes(redirectUri) ? { client_id: clientId, redirect_uris: redirectUris } : null;
  }
  const { data } = await db().from("aria_mcp_oauth_clients").select("client_id,redirect_uris").eq("client_id", clientId).maybeSingle();
  return data && Array.isArray(data.redirect_uris) && data.redirect_uris.includes(redirectUri) ? data : null;
}
function loginPage(pendingId: string) { return `<!doctype html><html><body style="font-family:system-ui;max-width:520px;margin:40px auto;padding:16px"><h1>Authorize ARIA</h1><p>Sign in to authorize this MCP connection.</p><form method="post" action="${ISSUER}/authorize/start"><input type="hidden" name="pending_id" value="${pendingId}"><input name="email" type="email" required autocomplete="email" placeholder="Email" style="width:100%;padding:10px;box-sizing:border-box"><button type="submit" style="margin-top:12px;padding:10px;width:100%">Continue</button></form></body></html>`; }
function checkPage(email: string) { return `<!doctype html><html><body style="font-family:system-ui;max-width:520px;margin:40px auto;padding:16px"><h1>Check your email</h1><p>We sent a secure sign-in link to ${email.replace(/[<>&"]/g, "")}. Open it to continue the ARIA authorization.</p></body></html>`; }
function magicPage(pendingId: string) { return `<!doctype html><html><body style="font-family:system-ui;max-width:520px;margin:40px auto;padding:16px"><h1 id="h">Completing authorization…</h1><p id="p">Please wait.</p><script>(async()=>{try{const q=new URLSearchParams(location.hash.slice(1));const token=q.get('access_token');if(!token)throw new Error('No session token returned');const r=await fetch(${JSON.stringify(ISSUER)}+'/authorize/consume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pending_id:${JSON.stringify(pendingId)},access_token:token})});const d=await r.json();if(!r.ok||!d.redirect_uri)throw new Error(d.error||'authorization_failed');location.replace(d.redirect_uri)}catch(e){document.getElementById('h').textContent='Authorization failed';document.getElementById('p').textContent=e?.message||String(e)}})()</script></body></html>`; }
Deno.serve(async req => {
  const traceId = getTraceId(req); const u = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, ...traceHeaders(traceId), "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,authorization" } });
  if (req.method === "GET" && u.pathname.endsWith("/.well-known/oauth-authorization-server")) return json(200, metadata(), traceId, { "access-control-allow-origin": "*" });
  if (req.method === "POST" && u.pathname.endsWith("/register")) {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const redirectUris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((v): v is string => typeof v === "string") : [];
    const name = typeof body?.client_name === "string" ? body.client_name.trim() : "";
    if (!name || !redirectUris.length) return json(400, { error: "invalid_client_metadata" }, traceId);
    const clientId = `aria_${crypto.randomUUID()}`;
    const { error } = await db().from("aria_mcp_oauth_clients").insert({ client_id: clientId, client_name: name.slice(0, 120), redirect_uris: redirectUris });
    if (error) return json(500, { error: "registration_failed" }, traceId);
    return json(201, { client_id: clientId, client_name: name.slice(0, 120), redirect_uris: redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }, traceId);
  }
  if (req.method === "GET" && u.pathname.endsWith("/authorize")) {
    const clientId = u.searchParams.get("client_id") ?? "", redirectUri = u.searchParams.get("redirect_uri") ?? "", responseType = u.searchParams.get("response_type") ?? "", state = u.searchParams.get("state") ?? "", challenge = u.searchParams.get("code_challenge") ?? "", method = u.searchParams.get("code_challenge_method") ?? "", resource = u.searchParams.get("resource") ?? "";
    if (responseType !== "code" || method !== "S256" || !state || !challenge || resource !== RESOURCE) return json(400, { error: "invalid_request" }, traceId);
    const client = await clientFromRequest(clientId, redirectUri); if (!client) return json(400, { error: "invalid_client" }, traceId);
    const pendingId = crypto.randomUUID();
    const { error } = await db().from("aria_mcp_oauth_pending").insert({ id: pendingId, client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: method, trace_id: traceId, expires_at: new Date(Date.now() + pendingTtl).toISOString() });
    if (error) return json(500, { error: "authorization_state_failed" }, traceId);
    return html(200, loginPage(pendingId), traceId);
  }
  if (req.method === "POST" && u.pathname.endsWith("/authorize/start")) {
    const form = await req.formData(), pendingId = String(form.get("pending_id") ?? ""), email = String(form.get("email") ?? "").trim().toLowerCase();
    const { data: pending } = await db().from("aria_mcp_oauth_pending").select("id,expires_at,trace_id").eq("id", pendingId).maybeSingle(); const flowTrace = pending?.trace_id ?? traceId;
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now() || !/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: "invalid_request" }, flowTrace);
    const emailRedirectTo = `${ISSUER}/authorize/magic?pending_id=${enc(pendingId)}`;
    const { error } = await auth().auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } });
    if (error) return json(400, { error: "otp_send_failed" }, flowTrace);
    await db().from("aria_mcp_oauth_pending").update({ email }).eq("id", pendingId); return html(200, checkPage(email), flowTrace);
  }
  if (req.method === "GET" && u.pathname.endsWith("/authorize/magic")) {
    const pendingId = u.searchParams.get("pending_id") ?? ""; const { data: pending } = await db().from("aria_mcp_oauth_pending").select("id,expires_at,trace_id").eq("id", pendingId).maybeSingle();
    if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) return html(400, "<h1>Authorization expired</h1>", traceId); return html(200, magicPage(pendingId), pending.trace_id ?? traceId);
  }
  if (req.method === "POST" && u.pathname.endsWith("/authorize/consume")) {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null; const pendingId = String(body?.pending_id ?? ""), accessToken = String(body?.access_token ?? "");
    const { data: pending } = await db().from("aria_mcp_oauth_pending").select("*").eq("id", pendingId).maybeSingle(); const flowTrace = pending?.trace_id ?? traceId;
    if (!pending || !accessToken || new Date(pending.expires_at).getTime() <= Date.now()) return json(400, { error: "authorization_expired" }, flowTrace);
    const { data: userData, error: userError } = await auth().auth.getUser(accessToken); if (userError || !userData.user) return json(400, { error: "invalid_session" }, flowTrace);
    const code = `aria_code_${crypto.randomUUID()}`; const encryptedAccessToken = await encryptSecret(accessToken);
    const { error: insertError } = await db().from("aria_mcp_oauth_codes").insert({ code, client_id: pending.client_id, redirect_uri: pending.redirect_uri, code_challenge: pending.code_challenge, code_challenge_method: pending.code_challenge_method, user_id: userData.user.id, encrypted_access_token: encryptedAccessToken, scope: SCOPES.join(" "), trace_id: flowTrace, expires_at: new Date(Date.now() + codeTtl).toISOString() });
    if (insertError) return json(500, { error: "authorization_failed" }, flowTrace);
    await db().from("aria_mcp_oauth_pending").delete().eq("id", pendingId);
    const redirect = new URL(pending.redirect_uri); redirect.searchParams.set("code", code); redirect.searchParams.set("state", pending.state); redirect.searchParams.set("iss", ISSUER); return json(200, { redirect_uri: redirect.toString() }, flowTrace);
  }
  if (req.method === "POST" && u.pathname.endsWith("/token")) {
    const ct = req.headers.get("content-type") ?? ""; const body = (ct.includes("application/x-www-form-urlencoded") ? Object.fromEntries(new URLSearchParams(await req.text())) : await req.json().catch(() => null)) as Record<string, unknown> | null;
    const code = String(body?.code ?? ""), clientId = String(body?.client_id ?? ""), redirectUri = String(body?.redirect_uri ?? ""), verifier = String(body?.code_verifier ?? ""), resource = String(body?.resource ?? "");
    if (String(body?.grant_type ?? "") !== "authorization_code" || !code || !clientId || !redirectUri || !verifier || resource !== RESOURCE) return json(400, { error: "invalid_request" }, traceId);
    const { data: record } = await db().from("aria_mcp_oauth_codes").select("*").eq("code", code).maybeSingle();
    if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now() || record.client_id !== clientId || record.redirect_uri !== redirectUri) return json(400, { error: "invalid_grant" }, traceId);
    if (!(await pkce(verifier, record.code_challenge))) return json(400, { error: "invalid_grant" }, traceId);
    const token = await decryptSecret(record.encrypted_access_token); await db().from("aria_mcp_oauth_codes").update({ used_at: new Date().toISOString() }).eq("code", code);
    return json(200, { access_token: token, token_type: "Bearer", scope: record.scope ?? SCOPES.join(" "), expires_in: 3600 }, traceId, { "access-control-allow-origin": "*" });
  }
  return json(404, { error: "not_found" }, traceId);
});
