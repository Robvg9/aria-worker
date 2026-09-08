import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ARIA_RUNTIME_SHARED_SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const DIRECT_ARIA = `${SUPABASE_URL}/functions/v1/aria-direct-v1`;
const MEMORY = `${SUPABASE_URL}/functions/v1/aria-memory-v2`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, x-client-info, x-aria-trace-id, content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}

function bearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function authenticate(token: string) {
  if (!ANON_KEY) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

function serviceClient() {
  if (!SERVICE_ROLE_KEY) throw new Error("service_role_not_configured");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false },
  });
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await serviceClient().rpc(name, args);
  if (error) throw new Error(`${name}:${error.message}`);
  return data;
}

async function callDirectAria(payload: Record<string, unknown>) {
  if (!ARIA_RUNTIME_SHARED_SECRET) throw new Error("runtime_secret_not_configured");
  const response = await fetch(DIRECT_ARIA, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${ARIA_RUNTIME_SHARED_SECRET}` },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { response, body };
}

async function recallForUser(query: string, userId: string) {
  if (!ARIA_RUNTIME_SHARED_SECRET) return { available: false, results: [] as unknown[] };
  try {
    const response = await fetch(MEMORY, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ARIA_RUNTIME_SHARED_SECRET}` },
      body: JSON.stringify({ action: "search", query, limit: 8 }),
    });
    const body = await response.json().catch(() => null);
    const results = Array.isArray(body?.results)
      ? body.results.filter((item: any) => {
          const owner = item?.metadata?.user_id ?? item?.provenance?.user_id ?? null;
          return owner === null || owner === userId;
        })
      : [];
    return { available: response.ok && body?.ok === true, results };
  } catch {
    return { available: false, results: [] as unknown[] };
  }
}

function toConversationResponse(body: any, fallbackText: string, conversationId: string) {
  const mission = body?.mission ?? body?.data?.mission ?? null;
  const missionId = mission?.mission_id ?? body?.mission_id ?? null;
  const status = body?.status ?? body?.execution?.status ?? mission?.status ?? "queued";
  const visualState = status === "queued"
    ? "planning"
    : status === "succeeded"
      ? "success"
      : status === "failed"
        ? "error"
        : status === "paused"
          ? "waiting"
          : "executing";
  return {
    ok: body?.ok !== false,
    conversationId,
    messageId: crypto.randomUUID(),
    visualState,
    parts: [{ type: "text", text: body?.response?.content ?? body?.message ?? fallbackText }],
    missionId,
    mission: mission
      ? {
          mission_id: mission.mission_id,
          status: mission.status,
          goal: mission.goal,
          current_step: mission.current_step ?? 0,
          completed_steps: mission.completed_steps ?? 0,
          total_steps: mission.total_steps ?? null,
          next_action: mission.next_action ?? null,
          last_stderr: mission.last_stderr ?? null,
        }
      : undefined,
  };
}

async function getMissionForUser(missionId: string, userId: string) {
  const mission = await rpc("aria_mission_get", { p_mission_id: missionId });
  if (!mission) return null;
  const owner = mission?.metadata?.user_id ?? mission?.metadata?.owner_user_id ?? null;
  if (owner && owner !== userId) return null;
  return mission;
}

async function getMissionEventsForUser(missionId: string, userId: string) {
  const mission = await getMissionForUser(missionId, userId);
  if (!mission) return null;
  const events = await rpc("aria_mission_events_get", { p_mission_id: missionId });
  return Array.isArray(events) ? events : [];
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const token = bearer(request);
  if (!token) return json({ error: "unauthorized" }, 401);
  const user = await authenticate(token);
  if (!user) return json({ error: "invalid_or_expired_session" }, 401);

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "");

  try {
    if (request.method === "GET" && pathname.endsWith("/session")) {
      return json({ ok: true, service: "aria-app-api-v2", user: { id: user.id, email: user.email ?? null } });
    }

    if (request.method === "GET" && pathname.endsWith("/system")) {
      const response = await fetch(DIRECT_ARIA, { method: "GET" });
      const body = await response.json().catch(() => null);
      return json({ ok: response.ok, service: "aria-app-api-v2", user_id: user.id, aria: body });
    }

    if (request.method === "GET" && pathname.includes("/missions/") && pathname.endsWith("/events")) {
      const missionId = decodeURIComponent(pathname.split("/missions/")[1].replace(/\/events$/, ""));
      const events = await getMissionEventsForUser(missionId, user.id);
      if (!events) return json({ error: "mission_not_found" }, 404);
      return json(events);
    }

    if (request.method === "GET" && pathname.includes("/missions/")) {
      const missionId = decodeURIComponent(pathname.split("/missions/")[1]);
      const mission = await getMissionForUser(missionId, user.id);
      if (!mission) return json({ error: "mission_not_found" }, 404);
      return json({ mission });
    }

    if (request.method === "POST" && pathname.endsWith("/conversation")) {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_json" }, 400);
      const parts = Array.isArray(body.parts) ? body.parts : [];
      const text = parts.filter((part: any) => part?.type === "text").map((part: any) => String(part.text ?? "").trim()).filter(Boolean).join("\n");
      if (!text) return json({ error: "text_required_for_v1" }, 400);
      const traceId = request.headers.get("x-aria-trace-id") ?? crypto.randomUUID();
      const conversationId = typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : crypto.randomUUID();
      const direct = await callDirectAria({
        goal: text,
        mission_id: typeof body.missionId === "string" ? body.missionId : undefined,
        metadata: { source_application: "aria-app-v1", user_id: user.id, conversation_id: conversationId, client_message_id: body.clientMessageId ?? null, trace_id: traceId },
      });
      if (!direct.response.ok) return json({ error: direct.body?.error ?? "aria_direct_failed" }, direct.response.status);
      return json(toConversationResponse(direct.body, "ARIA recibió tu solicitud y la está procesando.", conversationId));
    }

    if (request.method === "POST" && pathname.endsWith("/missions")) {
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "invalid_json" }, 400);
      const goal = typeof body.goal === "string" ? body.goal.trim() : "";
      if (!goal) return json({ error: "goal_required" }, 400);
      const direct = await callDirectAria({
        goal,
        mission_id: typeof body.missionId === "string" ? body.missionId : undefined,
        metadata: { source_application: "aria-app-v1", user_id: user.id, goal_source: "user" },
      });
      if (!direct.response.ok) return json({ error: direct.body?.error ?? "aria_direct_failed" }, direct.response.status);
      return json(toConversationResponse(direct.body, "Misión recibida.", crypto.randomUUID()));
    }

    if (request.method === "POST" && pathname.endsWith("/memory/search")) {
      const body = await request.json().catch(() => null);
      const query = typeof body?.query === "string" ? body.query.trim() : "";
      if (!query) return json({ error: "query_required" }, 400);
      const result = await recallForUser(query, user.id);
      return json({ ok: true, query, result_count: result.results.length, results: result.results });
    }

    return json({ error: "not_found" }, 404);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return json({ error: "internal_error", detail }, 500);
  }
});
