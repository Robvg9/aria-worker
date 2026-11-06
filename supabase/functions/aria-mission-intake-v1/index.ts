import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { m22A4ScopeRowMatchesV1 } from "../_shared/mission-wonder-2-a4-scope-v1.mjs";
import { m22A5ScopeRowMatchesV1, M22_A5_SCOPE_ID } from "../_shared/mission-wonder-2-a5-scope-v1.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SHARED_SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET");
const MISSION_EXECUTION_PAUSED = true;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SHARED_SECRET) {
  throw new Error("ARIA mission intake is not configured");
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function constantTimeEqual(a: string, b: string) {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function bearer(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  return header.slice(7);
}

function missionId() {
  return `mission_${crypto.randomUUID()}`;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = bearer(req);
  if (!token || !constantTimeEqual(token, SHARED_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) return json({ error: "goal_required" }, 400);

  const id = typeof body.mission_id === "string" && body.mission_id.trim()
    ? body.mission_id.trim()
    : missionId();

  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? body.metadata
    : {};

  if (MISSION_EXECUTION_PAUSED) {
    const a5ScopeId = String(metadata.mission_wonder_2_a5_scope_id || "").trim();
    if (a5ScopeId === M22_A5_SCOPE_ID && metadata.mission_wonder_2_a5_recovery === true) {
      if (!metadata.user_id || !metadata.request_id) return json({ error: "mission_execution_paused", execution_enabled: false }, 423);
      const { data: scope, error: scopeError } = await supabase.schema("aria_internal").from("mission_wonder_2_a5_scopes")
        .select("*").eq("scope_id", a5ScopeId).maybeSingle();
      const valid = !scopeError && await m22A5ScopeRowMatchesV1({
        scope, metadata, missionId: id, userId: String(metadata.user_id),
        requestId: String(metadata.request_id), goal, projectId: metadata.project_id ?? null, requiredStatuses: ["claimed"],
      });
      if (!valid) return json({ error: "mission_execution_paused", execution_enabled: false }, 423);
    } else {
      const scopeId = String(metadata.mission_wonder_2_a4_scope_id || "").trim();
      if (!scopeId || !metadata.user_id || !metadata.request_id || metadata.mission_wonder_2_a4_readonly !== true) return json({ error: "mission_execution_paused", execution_enabled: false }, 423);
      const { data: scope, error: scopeError } = await supabase.schema("aria_internal").from("mission_wonder_2_a4_scopes")
        .select("*").eq("scope_id", scopeId).maybeSingle();
      const valid = !scopeError && await m22A4ScopeRowMatchesV1({
        scope, metadata, missionId: id, userId: String(metadata.user_id),
        requestId: String(metadata.request_id), goal, projectId: metadata.project_id ?? null, requiredStatuses: ["claimed"],
      });
      if (!valid) return json({ error: "mission_execution_paused", execution_enabled: false }, 423);
    }
  }

  const checkpoint = body.checkpoint && typeof body.checkpoint === "object" && !Array.isArray(body.checkpoint)
    ? body.checkpoint
    : {};

  const mission = {
    mission_id: id,
    status: "queued",
    goal,
    current_step: 0,
    completed_steps: 0,
    checkpoint,
    metadata,
  };

  const { data, error } = await supabase.rpc("aria_mission_create", {
    p_mission: mission,
  });

  if (error) {
    return json({
      error: "mission_create_failed",
      detail: error.message,
    }, 500);
  }

  return json({
    ok: true,
    mission: data ?? mission,
    execution: {
      status: "queued",
      next: "autonomous_runtime",
    },
  });
});
