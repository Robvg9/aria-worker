// Canonical release marker: owner propagation + ARTIA mission visibility.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deriveMissionDisplayTitle, MISSION_TITLE_VERSION } from "../_shared/mission-title.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SHARED_SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const MISSION_INTAKE = `${SUPABASE_URL}/functions/v1/aria-mission-intake-v1`;
const CANONICAL_RUNTIME = `${SUPABASE_URL}/functions/v1/aria-canonical-runtime-v1`;
const MEMORY_GATEWAY = `${SUPABASE_URL}/functions/v1/aria-memory-v2`;
const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false } });
const EDGE_API_KEY = (() => { try { const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") ?? "{}"); return typeof keys?.default === "string" ? keys.default : ""; } catch { return ""; } })();

const out = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

const bearer = (request: Request) => {
  const h = request.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
};

const equal = (a: string, b: string) => {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
};

async function resolveMeditationDevice(metadata: Record<string, unknown>) {
  const explicit = typeof metadata.device_id === "string" ? metadata.device_id.trim() : "";
  if (explicit) {
    const { data } = await sb.schema("aria_internal").from("device_registry")
      .select("device_id,agent_type,status,last_seen_at")
      .eq("device_id", explicit)
      .eq("agent_type", "android-termux")
      .eq("status", "online")
      .maybeSingle();
    if (data?.device_id) return data;
  }

  const { data: control } = await sb.schema("aria_internal").from("meditation_control")
    .select("metadata")
    .eq("controller_id", "primary")
    .maybeSingle();
  const controlDevice = (control?.metadata as any)?.device_id;
  if (typeof controlDevice === "string" && controlDevice.trim()) {
    const { data } = await sb.schema("aria_internal").from("device_registry")
      .select("device_id,agent_type,status,last_seen_at")
      .eq("device_id", controlDevice.trim())
      .eq("agent_type", "android-termux")
      .eq("status", "online")
      .maybeSingle();
    if (data?.device_id) return data;
  }

  const { data } = await sb.schema("aria_internal").from("device_registry")
    .select("device_id,agent_type,status,last_seen_at")
    .eq("agent_type", "android-termux")
    .eq("status", "online")
    .order("last_seen_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

async function kickCanonicalRunner(missionId: string, reason: string) {
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${SHARED_SECRET}`,
      "x-aria-trigger": "mission-tick",
      ...(EDGE_API_KEY ? { apikey: EDGE_API_KEY } : {})
    };
    const response = await fetch(CANONICAL_RUNTIME, {
      method: "POST",
      headers,
      body: JSON.stringify({ mission_id: missionId })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        status: "kick_failed",
        mission_id: missionId,
        reason,
        http_status: response.status,
        error: body?.error ?? `canonical_runtime_http_${response.status}`
      };
    }
    return {
      status: "kick_requested",
      mission_id: missionId,
      reason,
      runtime_status: body?.status ?? null,
      runtime_response: body
    };
  } catch (error) {
    return {
      status: "kick_failed",
      mission_id: missionId,
      reason,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function scheduleCanonicalRunnerKick(missionId: string, reason: string) {
  const result = await kickCanonicalRunner(missionId, reason);
  if (result.status === "kick_failed") console.error("[aria-direct] canonical runner dispatch error", JSON.stringify(result));
  else console.log("[aria-direct] canonical runner dispatch", JSON.stringify(result));
  return result;
}

async function recall(goal: string) {
  if (!SHARED_SECRET) return [];
  try {
    const response = await fetch(MEMORY_GATEWAY, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${SHARED_SECRET}`,
        ...(EDGE_API_KEY ? { apikey: EDGE_API_KEY } : {})
      },
      body: JSON.stringify({ action: "search", query: goal, limit: 5 })
    });
    if (!response.ok) return [];
    const body = await response.json().catch(() => null);
    return Array.isArray(body?.results) ? body.results : [];
  } catch (_) {
    return [];
  }
}

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return out({
      ok: true,
      service: "aria-direct-interface",
      version: "aria-direct-v1",
      execution_authority: "aria-canonical-runtime-v1",
      mission_intake: "canonical",
      memory_authority: "aria_memory",
      capabilities: ["goal_submission", "mission_intake", "canonical_runtime", "cognitive_recall"]
    });
  }

  if (request.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!SHARED_SECRET) return out({ error: "runtime_secret_not_configured" }, 500);

  const token = bearer(request);
  if (!token || !equal(token, SHARED_SECRET)) return out({ error: "unauthorized" }, 401);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return out({ error: "invalid_json" }, 400);
  }

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) return out({ error: "goal_required" }, 400);

  const userMetadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? body.metadata
    : {};
  const traceId = typeof userMetadata.trace_id === "string" && userMetadata.trace_id.trim()
    ? userMetadata.trace_id.trim()
    : crypto.randomUUID();
  const requestId = typeof userMetadata.request_id === "string" && userMetadata.request_id.trim()
    ? userMetadata.request_id.trim()
    : traceId;
  const missionId = typeof body.mission_id === "string" && body.mission_id.trim()
    ? body.mission_id.trim()
    : undefined;
  const authenticatedUserId = request.headers.get("x-aria-user-id")?.trim() || "";


  const visualContext = userMetadata.visual_context && typeof userMetadata.visual_context === "object" ? userMetadata.visual_context : null;
  const hasExplicitVisualContext = Boolean(visualContext?.image_path || visualContext?.annotations?.length || visualContext?.annotation_summary);
  const memoryContext = hasExplicitVisualContext ? [] : await recall(goal);
  const metadata = {
    ...userMetadata,
    ...(authenticatedUserId && String(userMetadata.goal_source ?? "").toLowerCase() === "user"
      ? { user_id: authenticatedUserId, owner_user_id: authenticatedUserId }
      : {}),
    display_title: deriveMissionDisplayTitle(goal, String(userMetadata.project_name ?? "")),
    display_title_version: MISSION_TITLE_VERSION,
    trace_id: traceId,
    request_id: requestId,
    runtime_version: "aria-mission-runner-v22-universal",
    diagnostic_contract_version: "aria-operational-diagnostics-v1.0.0",
    autonomy_managed: true,
    cognitive_memory: {
      source: hasExplicitVisualContext ? "explicit_visual_context" : "aria-memory-v2",
      recalled_at: new Date().toISOString(),
      result_count: memoryContext.length,
      results: memoryContext
    }
  };

  const upstream = await fetch(MISSION_INTAKE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SHARED_SECRET}`,
      ...(EDGE_API_KEY ? { apikey: EDGE_API_KEY } : {})
    },
    body: JSON.stringify({ goal, mission_id: missionId, metadata, source: "direct_aria_interface" })
  });

  const payload = await upstream.json().catch(() => ({ error: "invalid_upstream_response" }));
  const mission = payload?.mission ?? payload?.result ?? null;
  const missionIdOut = typeof mission?.mission_id === "string" ? mission.mission_id : null;
  const sourceKind = String(metadata.goal_source ?? metadata.source_application ?? "").toLowerCase();
  const shouldQueue = sourceKind.includes("chat") || sourceKind.includes("user");

  let queue: Record<string, unknown> = {
    status: "not_requested",
    reason: shouldQueue ? "mission_missing" : "non_user_direct_submission",
  };
  let dispatch: Record<string, unknown> = {
    status: "not_requested",
    reason: shouldQueue ? "mission_missing" : "non_user_direct_submission",
  };

  if (upstream.ok && missionIdOut && shouldQueue) {
    try {
      const device = await resolveMeditationDevice(metadata);
      if (device?.device_id) {
        const { data, error } = await sb.rpc("meditation_queue_add", {
          p_device_id: String(device.device_id),
          p_item_type: "mission",
          p_item_id: missionIdOut,
        });
        if (error) throw new Error(error.message);
        queue = {
          status: "queued",
          queue_id: data?.queue_id ?? null,
          position: data?.position ?? null,
          device_id: data?.device_id ?? device.device_id,
          item_type: data?.item_type ?? "mission",
          item_id: data?.item_id ?? missionIdOut,
        };
      } else {
        queue = {
          status: "not_required",
          reason: "canonical_runner_is_execution_authority",
          detail: "No online Android Meditation queue consumer was available; canonical mission runner dispatch does not require Android.",
        };
      }

      dispatch = {
        status: "scheduled",
        authority: "aria_internal.runner_tick_for_mission",
        reason: "user_mission_immediate_dispatch",
        mission_id: missionIdOut,
        queue_status: queue.status,
      };
      dispatch = { ...dispatch, status: "requested", request: await scheduleCanonicalRunnerKick(missionIdOut, "user_mission_immediate_dispatch") };
    } catch (error) {
      queue = {
        status: "enqueue_failed",
        error: error instanceof Error ? error.message : String(error),
      };
      dispatch = {
        status: "scheduled",
        authority: "aria_internal.runner_tick_for_mission",
        reason: "user_mission_immediate_dispatch_after_queue_error",
        mission_id: missionIdOut,
        queue_status: queue.status,
      };
      dispatch = { ...dispatch, status: "requested", request: await scheduleCanonicalRunnerKick(missionIdOut, "user_mission_immediate_dispatch_after_queue_error") };
    }
  }

  return out({
    ok: upstream.ok,
    interface: "aria-direct-v1",
    canonical_runtime: "aria-canonical-runtime-v1",
    memory_recall: { count: memoryContext.length },
    queue,
    dispatch,
    ...payload
  }, upstream.status);
});
