import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY") ?? "";
const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hash = async (value: string) => { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes)).map((x) => x.toString(16).padStart(2, "0")).join(""); };
const sanitize = (m: unknown) => String(m ?? "error").replace(/Bearer\s+[A-Za-z0-9._-]+/g, "[redacted]").replace(/AIza[A-Za-z0-9_-]{20,}/g, "[redacted]");
Deno.serve(async (request) => {
  if (request.method !== "GET") return out({ error: "method_not_allowed" }, 405);
  const parsedUrl = new globalThis.URL(request.url);
  const nonce = parsedUrl.searchParams.get("nonce") ?? "";
  if (!nonce) return out({ error: "nonce_required" }, 400);
  const nonceHash = await hash(nonce);
  const { data: rows, error } = await sb.rpc("aria_consume_diagnostic_nonce", { p_nonce_name: "gemini_direct_live_check", p_nonce_hash: nonceHash });
  if (error) return out({ error: "diagnostic_nonce_store_error", code: error.code ?? null }, 500);
  if (rows !== true) return out({ error: "invalid_or_consumed_nonce" }, 401);
  if (!GOOGLE_API_KEY) return out({ ok: false, provider: "google", route: "direct", status: "failed", reason: "credential_unavailable" }, 503);
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": GOOGLE_API_KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Reply exactly: ARIA_GEMINI_DIRECT_LIVE_OK" }] }], generationConfig: { maxOutputTokens: 20 } })
    });
  } catch { return out({ ok: false, provider: "google", route: "direct", status: "failed", reason: "transport_error", latency_ms: Date.now() - started }, 502); }
  const body = await response.json().catch(() => null);
  if (!response.ok) return out({ ok: false, provider: "google", route: "direct", status: "failed", reason: "provider_error", provider_status: response.status, message: sanitize(body?.error?.message), latency_ms: Date.now() - started }, 502);
  const text = Array.isArray(body?.candidates?.[0]?.content?.parts) ? body.candidates[0].content.parts.filter((x: any) => typeof x?.text === "string").map((x: any) => x.text).join("") : "";
  return out({ ok: text === "ARIA_GEMINI_DIRECT_LIVE_OK", provider: "google", route: "direct", model: "google/gemini-3.5-flash-lite-direct", upstream_model: "gemini-3.5-flash-lite", status: text ? "succeeded" : "failed", verification: text === "ARIA_GEMINI_DIRECT_LIVE_OK", usage: body?.usageMetadata ? { prompt_tokens: body.usageMetadata.promptTokenCount ?? null, completion_tokens: body.usageMetadata.candidatesTokenCount ?? null, total_tokens: body.usageMetadata.totalTokenCount ?? null } : { status: "unknown" }, latency_ms: Date.now() - started });
});
