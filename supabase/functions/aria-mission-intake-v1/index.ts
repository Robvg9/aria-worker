import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  if (MISSION_EXECUTION_PAUSED) {
    return json({ error: "mission_execution_paused", execution_enabled: false }, 423);
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
