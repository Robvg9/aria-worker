import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const CANONICAL = URL + "/functions/v1/aria-canonical-runtime-v1";
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await sb.schema("aria_internal").rpc(name, args);
  if (error) throw new Error(name + ":" + error.message);
  return data;
}

async function authorized(request: Request) {
  const token = request.headers.get("x-aria-autonomy-token") || "";
  if (!token) return false;
  const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: token });
  return !error && data === true;
}

async function block(runId: string, scopeId: string, reason: string) {
  try {
    await rpc("aria_m22_a6_block_run_v1", {
      p_run_id: runId,
      p_scope_id: scopeId,
      p_reason: reason.slice(0, 1000),
    });
  } catch {
    // A failed telemetry/block RPC must never trigger a retry or a wider route.
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return out({ ok: false, error: "method_not_allowed" }, 405);
  if (!(await authorized(request))) return out({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return out({ ok: false, error: "invalid_json" }, 400);
  }
  if (body.action !== "dispatch_due") {
    return out({ ok: false, error: "unsupported_action" }, 400);
  }

  let runId = "";
  let scopeId = "";
  try {
    const reconciled = await rpc("aria_m22_a6_reconcile_v1");
    const heartbeat = await rpc("aria_m22_a6_sample_runtime_v1");
    const claimed = await rpc("aria_m22_a6_claim_due_scope_v1");
    if (!claimed || typeof claimed !== "object") {
      return out({ ok: true, status: "idle", reconciled, heartbeat });
    }

    const claim = claimed as Record<string, unknown>;
    const run = claim.run as Record<string, unknown> | undefined;
    const scope = claim.scope as Record<string, unknown> | undefined;
    runId = typeof run?.run_id === "string" ? run.run_id : "";
    scopeId = typeof scope?.scope_id === "string" ? scope.scope_id : "";
    if (!runId || !scopeId) throw new Error("a6_claimed_scope_identity_missing");

    const materialized = await rpc("aria_m22_a6_materialize_due_mission_v1", {
      p_run_id: runId,
      p_scope_id: scopeId,
    });
    const missionId = String((materialized as Record<string, unknown> | null)?.mission_id || "");
    if (!missionId) throw new Error("a6_materialized_mission_id_missing");
    if (!API_KEY) throw new Error("supabase_project_apikey_missing");

    const token = request.headers.get("x-aria-autonomy-token") || "";
    const response = await fetch(CANONICAL, {
      method: "POST",
      headers: {
        apikey: API_KEY,
        "x-aria-autonomy-token": token,
        "x-aria-trigger": "mission-tick",
        "content-type": "application/json",
      },
      body: JSON.stringify({ mission_id: missionId }),
    });
    const responseText = await response.text();
    let runtimePayload: Record<string, unknown> = {};
    try {
      runtimePayload = responseText ? JSON.parse(responseText) : {};
    } catch {
      throw new Error("a6_canonical_runtime_invalid_json");
    }
    if (!response.ok) {
      throw new Error("a6_canonical_runtime_http_" + response.status + ":" +
        String(runtimePayload.error || runtimePayload.status || "rejected"));
    }

    return out({
      ok: true,
      status: "dispatched",
      run_id: runId,
      scope_id: scopeId,
      mission_id: missionId,
      materialized,
      reconciled,
      heartbeat,
      canonical: {
        http_status: response.status,
        status: runtimePayload.status || null,
        accepted: runtimePayload.ok === true || response.status === 202,
      },
    }, 202);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (runId && scopeId) await block(runId, scopeId, reason);
    return out({
      ok: false,
      status: "blocked",
      run_id: runId || null,
      scope_id: scopeId || null,
      error: reason,
      automatic_retry: false,
    }, 503);
  }
});
