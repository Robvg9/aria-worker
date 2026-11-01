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
  .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
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
  if (nonce.length < 32 || nonce.length > 256) return out({ error: "nonce_required" }, 400);
  const nonceHash = await hash(nonce);
  const { data: consumed, error: nonceError } = await sb.rpc("aria_consume_diagnostic_nonce", {
    p_nonce_name: "dashscope_qwen_direct_live_check",
    p_nonce_hash: nonceHash
  });
  if (nonceError) return out({ error: "diagnostic_nonce_store_error" }, 500);
  if (consumed !== true) return out({ error: "invalid_or_consumed_nonce" }, 401);

  const raw = await secret("dashscope/qwen_primary");
  if (!raw) return out({ ok: false, provider: "alibaba_dashscope", status: "blocked", reason: "credential_unavailable" }, 503);
  let credential: any;
  try { credential = JSON.parse(raw); } catch {
    return out({ ok: false, provider: "alibaba_dashscope", status: "blocked", reason: "credential_format_invalid" }, 503);
  }
  if (typeof credential?.api_key !== "string" || credential.api_key.length < 12 ||
      typeof credential?.workspace_id !== "string" || !/^[A-Za-z0-9-]{6,80}$/.test(credential.workspace_id) ||
      credential.region !== "ap-southeast-1") {
    return out({ ok: false, provider: "alibaba_dashscope", status: "blocked", reason: "credential_fields_invalid" }, 503);
  }
  if (credential.free_quota_only !== true) {
    return out({ ok: false, provider: "alibaba_dashscope", status: "blocked", reason: "free_quota_only_not_confirmed" }, 423);
  }
  const quotaExpires = Date.parse(String(credential.free_quota_expires_at || ""));
  if (!Number.isFinite(quotaExpires) || quotaExpires <= Date.now()) {
    return out({ ok: false, provider: "alibaba_dashscope", status: "blocked", reason: "free_quota_expired_or_unknown" }, 423);
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let response: Response;
  try {
    response = await fetch(`https://${credential.workspace_id}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3.8-max",
        messages: [{ role: "user", content: "Reply exactly: ARIA_DASHSCOPE_QWEN_LIVE_OK" }],
        max_tokens: 64,
        temperature: 0
      }),
      signal: controller.signal
    });
  } catch (error) {
    return out({
      ok: false, provider: "alibaba_dashscope", status: "failed",
      reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "transport_error",
      latency_ms: Date.now() - started
    }, 502);
  } finally {
    clearTimeout(timer);
  }

  const json = await response.json().catch(() => null);
  const headers = rateLimit(response.headers);
  const providerCode = String(json?.code || json?.error?.code || "");
  if (!response.ok) {
    const failure = providerCode === "AllocationQuota.FreeTierOnly"
      ? "quota_exhausted"
      : response.status === 429 ? "rate_limit" : "provider_error";
    return out({
      ok: false, provider: "alibaba_dashscope", route: "direct",
      model: "alibaba_dashscope/qwen3.8-max", status: "failed",
      reason: failure, provider_status: response.status,
      provider_code: providerCode || null,
      message: sanitize(json?.message || json?.error?.message),
      latency_ms: Date.now() - started, rate_limit: headers
    }, 502);
  }

  const content = json?.choices?.[0]?.message?.content;
  const text = typeof content === "string" ? content.trim() : "";
  const usage = json?.usage ?? {};
  const verified = text === "ARIA_DASHSCOPE_QWEN_LIVE_OK";
  return out({
    ok: verified,
    provider: "alibaba_dashscope",
    route: "direct",
    account_ref: "acct_dashscope_primary",
    model: "alibaba_dashscope/qwen3.8-max",
    upstream_model: typeof json?.model === "string" ? json.model : "qwen3.8-max",
    status: verified ? "succeeded" : "failed",
    verification: verified,
    reason: verified ? null : "unexpected_completion_content",
    usage: {
      prompt_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
      completion_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
      total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null
    },
    rate_limit: headers,
    region: "ap-southeast-1",
    free_quota_guard: "free_quota_only",
    free_quota_expires_at: new Date(quotaExpires).toISOString(),
    latency_ms: Date.now() - started
  });
});
