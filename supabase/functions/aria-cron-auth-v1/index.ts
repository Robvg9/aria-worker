import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const CANONICAL = URL + "/functions/v1/aria-canonical-runtime-v1";
const A6_DISPATCHER_HEADER = "mission-wonder-2-a6";
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function cronTokenAuthorized(token: string) {
  if (!token) return false;
  const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: token });
  return !error && data === true;
}

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await sb.schema("aria_internal").rpc(name, args);
  if (error) throw new Error(name + ":" + error.message);
  return data;
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

async function dispatchA6(request: Request) {
  const token = request.headers.get("x-aria-autonomy-token") || "";
  if (!(await cronTokenAuthorized(token))) return json({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (body.action !== "dispatch_due") return json({ ok: false, error: "unsupported_action" }, 400);

  let runId = "";
  let scopeId = "";
  try {
    const reconciled = await rpc("aria_m22_a6_reconcile_v1");
    const claimed = await rpc("aria_m22_a6_claim_due_scope_v1");
    if (!claimed || typeof claimed !== "object") {
      return json({ ok: true, status: "idle", reconciled, heartbeat_sampled_by_database_cron: true });
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

    const response = await fetch(CANONICAL, {
      method: "POST",
      headers: {
        apikey: API_KEY,
        "x-aria-autonomy-token": token,
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
    if (!response.ok || runtimePayload.ok !== true) {
      throw new Error("a6_canonical_runtime_http_" + response.status + ":" +
        String(runtimePayload.error || runtimePayload.status || "not_accepted"));
    }

    const { data: queuedJob, error: queuedJobError } = await sb.schema("aria_internal")
      .from("execution_jobs")
      .select("job_id,mission_id,device_id,operation,command,status,metadata")
      .eq("job_id", String(scope.job_id || ""))
      .maybeSingle();
    if (queuedJobError || !queuedJob ||
        queuedJob.mission_id !== missionId ||
        queuedJob.device_id !== String(scope.allowed_device_id || "") ||
        queuedJob.operation !== "shell.execute" ||
        queuedJob.command !== String(scope.command || "") ||
        !["queued", "claimed", "running", "succeeded"].includes(String(queuedJob.status || "")) ||
        queuedJob.metadata?.idempotency_key !== queuedJob.job_id) {
      throw new Error("a6_canonical_runtime_did_not_enqueue_exact_scoped_job");
    }

    return json({
      ok: true,
      status: "dispatched",
      run_id: runId,
      scope_id: scopeId,
      mission_id: missionId,
      job_id: queuedJob.job_id,
      materialized,
      reconciled,
      heartbeat_sampled_by_database_cron: true,
      canonical: {
        http_status: response.status,
        status: runtimePayload.status || null,
        accepted: true,
        exactJobReadback: true,
      },
    }, 202);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (runId && scopeId) await block(runId, scopeId, reason);
    return json({
      ok: false,
      status: "blocked",
      run_id: runId || null,
      scope_id: scopeId || null,
      error: reason,
      automatic_retry: false,
    }, 503);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // This explicit header routes only the dedicated A6 cron request to the dispatcher.
  // Every legacy cron-auth request keeps its original response contract unchanged.
  if (req.headers.get("x-aria-dispatcher") === A6_DISPATCHER_HEADER) {
    return await dispatchA6(req);
  }

  const token = req.headers.get("x-aria-autonomy-token") ?? "";
  if (!token) return json({ authorized: false }, 200);
  const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: token });
  if (error) return json({ authorized: false }, 200);
  return json({ authorized: Boolean(data) });
});
