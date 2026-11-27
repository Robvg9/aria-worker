import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RUNTIME_SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const sb = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hash = async (value: string) => { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(bytes)).map((x) => x.toString(16).padStart(2, "0")).join(""); };
Deno.serve(async (request) => {
  if (request.method !== "GET") return out({ error: "method_not_allowed" }, 405);
  const parsedUrl = new globalThis.URL(request.url);
  const missionId = (parsedUrl.searchParams.get("mission_id") ?? "").trim();
  const stepId = (parsedUrl.searchParams.get("step_id") ?? "").trim();
  if (!missionId || !stepId) {
    return out({ ok: false, status: "blocked", error: { code: "mission_budget_mission_context_missing" } }, 423);
  }
  if (missionId.length + stepId.length + 42 > 240) {
    return out({ ok: false, status: "blocked", error: { code: "mission_budget_request_identity_invalid" } }, 423);
  }
  if (!RUNTIME_SECRET) return out({ ok: false, status: "blocked", error: { code: "runtime_secret_unavailable" } }, 503);
  const nonce = parsedUrl.searchParams.get("nonce") ?? "";
  if (!nonce) return out({ error: "nonce_required" }, 400);
  const nonceHash = await hash(nonce);
  const { data: rows, error } = await sb.rpc("aria_consume_diagnostic_nonce", { p_nonce_name: "gemini_direct_live_check", p_nonce_hash: nonceHash });
  if (error) return out({ error: "diagnostic_nonce_store_error", code: error.code ?? null }, 500);
  if (rows !== true) return out({ error: "invalid_or_consumed_nonce" }, 401);

  const requestId = missionId + ":" + stepId + ":" + crypto.randomUUID();
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(SUPABASE_URL + "/functions/v1/aria-execution-runtime-v1", {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: "Bearer " + RUNTIME_SECRET, "x-aria-trigger": "gemini-direct-live-check" },
      body: JSON.stringify({
        execution_version: "1",
        request_id: requestId,
        task_id: stepId,
        capability: "text_generation",
        selected_route: {
          status: "selected",
          provider_id: "google",
          account_id: "acct_google_gemini_free",
          model_id: "google/gemini-3.5-flash-lite-direct",
          capability: "text_generation"
        },
        authorization: {
          status: "approved",
          risk_class: "READ",
          evidence_ref: "gemini-direct-live-check:" + nonceHash
        },
        input: { payload: { prompt: "Reply exactly: ARIA_GEMINI_DIRECT_LIVE_OK", generationConfig: { maxOutputTokens: 20 } } },
        policy: { risk: "READ", runtime_probe: true, diagnostic_nonce_consumed: true },
        metadata: {
          mission_id: missionId,
          step_id: stepId,
          executor_type: "model",
          runner: "aria-gemini-direct-live-check-v1",
          diagnostic_nonce_hash: nonceHash
        }
      })
    });
  } catch {
    return out({ ok: false, provider: "google", route: "direct", status: "failed", reason: "runtime_transport_error", latency_ms: Date.now() - started }, 502);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "succeeded") {
    return out({
      ok: false,
      provider: "google",
      route: "direct",
      status: body?.status || "failed",
      reason: body?.error?.code || body?.reason || "runtime_error",
      runtime_http_status: response.status,
      latency_ms: Date.now() - started
    }, response.status);
  }
  const text = typeof body?.response?.content === "string" ? body.response.content : "";
  return out({
    ok: text === "ARIA_GEMINI_DIRECT_LIVE_OK",
    provider: "google",
    route: "direct",
    model: "google/gemini-3.5-flash-lite-direct",
    status: text ? "succeeded" : "failed",
    verification: text === "ARIA_GEMINI_DIRECT_LIVE_OK",
    usage: body?.usage || { status: "unknown" },
    runtime_metadata: body?.metadata || null,
    latency_ms: Date.now() - started
  });
});
