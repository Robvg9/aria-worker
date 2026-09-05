import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SHARED_SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const MISSION_INTAKE = `${SUPABASE_URL}/functions/v1/aria-mission-intake-v1`;

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

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return out({
      ok: true,
      service: "aria-direct-interface",
      version: "aria-direct-v1",
      execution_authority: "aria-canonical-runtime-v1",
      mission_intake: "canonical",
      memory_authority: "aria_memory",
      capabilities: ["goal_submission", "mission_intake", "canonical_runtime"]
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

  const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
    ? body.metadata
    : {};
  const missionId = typeof body.mission_id === "string" && body.mission_id.trim()
    ? body.mission_id.trim()
    : undefined;

  const upstream = await fetch(MISSION_INTAKE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SHARED_SECRET}`
    },
    body: JSON.stringify({ goal, mission_id: missionId, metadata, source: "direct_aria_interface" })
  });

  const payload = await upstream.json().catch(() => ({ error: "invalid_upstream_response" }));
  return out({
    ok: upstream.ok,
    interface: "aria-direct-v1",
    canonical_runtime: "aria-canonical-runtime-v1",
    ...payload
  }, upstream.status);
});
