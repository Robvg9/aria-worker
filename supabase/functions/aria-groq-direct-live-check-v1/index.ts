import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});
const hash = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
};
const sanitize = (value: unknown) => String(value ?? "provider error")
  .replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
  .replace(/\bgsk_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
  .slice(0, 240);
const secret = async (name: string) => {
  const { data, error } = await sb.rpc("read_aria_credential_secret", { p_name: name });
  return !error && typeof data === "string" && data.length ? data : null;
};
const rateLimit = (headers: Headers) => ({
  limit_requests: headers.get("x-ratelimit-limit-requests"),
  remaining_requests: headers.get("x-ratelimit-remaining-requests"),
  reset_requests: headers.get("x-ratelimit-reset-requests"),
  limit_tokens: headers.get("x-ratelimit-limit-tokens"),
  remaining_tokens: headers.get("x-ratelimit-remaining-tokens"),
  reset_tokens: headers.get("x-ratelimit-reset-tokens"),
  retry_after: headers.get("retry-after")
});

Deno.serve(async request => {
  if (request.method !== "GET") return out({ error: "method_not_allowed" }, 405);
  const nonce = new URL(request.url).searchParams.get("nonce") ?? "";
  if (!nonce) return out({ error: "nonce_required" }, 400);
  const nonceHash = await hash(nonce);
  const { data: consumed, error: nonceError } = await sb.rpc("aria_consume_diagnostic_nonce", {
    p_nonce_name: "groq_direct_live_check",
    p_nonce_hash: nonceHash
  });
  if (nonceError) return out({ error: "diagnostic_nonce_store_error" }, 500);
  if (consumed !== true) return out({ error: "invalid_or_consumed_nonce" }, 401);

  const apiKey = await secret("groq/groq_primary");
  if (!apiKey) return out({
    ok: false, provider: "groq", route: "direct", status: "blocked",
    reason: "credential_unavailable"
  }, 503);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [{ role: "user", content: "Reply exactly: ARIA_GROQ_DIRECT_LIVE_OK" }],
        max_completion_tokens: 96,
        reasoning_effort: "low"
      }),
      signal: controller.signal
    });
  } catch (error) {
    return out({
      ok: false, provider: "groq", route: "direct", status: "failed",
      reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "transport_error",
      latency_ms: Date.now() - started
    }, 502);
  } finally {
    clearTimeout(timer);
  }

  const json = await response.json().catch(() => null);
  const headers = rateLimit(response.headers);
  if (!response.ok) return out({
    ok: false, provider: "groq", route: "direct", model: "groq/openai/gpt-oss-120b",
    status: "failed", reason: "provider_error", provider_status: response.status,
    message: sanitize(json?.error?.message), latency_ms: Date.now() - started, rate_limit: headers
  }, 502);

  const message = json?.choices?.[0]?.message?.content;
  const text = typeof message === "string" ? message : "";
  const usage = json?.usage ?? {};
  const verified = text.trim() === "ARIA_GROQ_DIRECT_LIVE_OK";
  return out({
    ok: verified,
    provider: "groq",
    route: "direct",
    account_ref: "acct_groq_primary",
    model: "groq/openai/gpt-oss-120b",
    upstream_model: typeof json?.model === "string" ? json.model : "openai/gpt-oss-120b",
    status: verified ? "succeeded" : "failed",
    verification: verified,
    reason: verified ? null : "unexpected_completion_content",
    usage: {
      prompt_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
      completion_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
      total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null
    },
    rate_limit: headers,
    latency_ms: Date.now() - started
  });
});
