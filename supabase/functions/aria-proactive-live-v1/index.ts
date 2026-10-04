import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { VERSION, ACTION_MODE, sha256, analyze } from "./proactive-engine.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

async function liveSource() {
  const [healthRes, routerRes] = await Promise.all([
    supabase.rpc("get_operational_health_v1"),
    supabase.rpc("router_live_snapshot")
  ]);
  if (healthRes.error) throw new Error("health_rpc:" + healthRes.error.message);
  if (routerRes.error) throw new Error("router_rpc:" + routerRes.error.message);

  const health = healthRes.data ?? {};
  const router = routerRes.data ?? {};
  const summary = health.summary ?? {};
  const candidates = Array.isArray(router.candidates) ? router.candidates : [];

  const snapshot = {
    observed_at: health.generated_at ?? router.generated_at ?? new Date().toISOString(),
    source_refs: [
      "aria_internal.get_operational_health_v1",
      "aria_internal.router_live_snapshot"
    ],
    queue: {
      queued_jobs: Number(summary.queued_jobs) || 0,
      eligible_online_executors: null,
      online_executors: Number.isFinite(Number(summary.devices_online)) ? Number(summary.devices_online) : null,
      evidence_ref: health.generated_at ? "health:" + health.generated_at : null
    },
    resources: candidates.map((candidate: any) => ({
      id: candidate.model_id,
      status: candidate.live_verified === true ? "available" : "unknown",
      live_verified: candidate.live_verified === true,
      verification_status: candidate.live_verified === true ? "verified" : "unknown",
      source_ref: "router_live_snapshot:" + String(candidate.model_id || "")
    })),
    diagnostics: health.status === "degraded"
      ? [{
          id: "operational-health-v1",
          severity: "error",
          status: "degraded",
          correlation_id: "system",
          source_ref: "aria_internal.get_operational_health_v1"
        }]
      : [],
    runtime: { expected_version: "aria-operational-diagnostics-v1.0.0", observed_versions: [String(health.version || "unknown")] }
  };
  return { snapshot, health, router };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body && typeof body === "object" && body.mode && body.mode !== "snapshot") {
      return json({ ok: false, error: "unsupported_mode" }, 400);
    }

    const { snapshot, health, router } = await liveSource();
    const digest = await analyze(snapshot);
    const fingerprint = await sha256({ engine_version: VERSION, snapshot });
    const digestId = "proactive_live_" + fingerprint.slice(0, 32);

    const row = {
      digest_id: digestId,
      engine_version: VERSION,
      action_mode: ACTION_MODE,
      observed_at: snapshot.observed_at,
      fingerprint,
      snapshot,
      digest,
      source_refs: snapshot.source_refs
    };

    const { error: insertError } = await supabase
      .schema("aria_internal")
      .from("proactive_digests")
      .upsert(row, { onConflict: "digest_id", ignoreDuplicates: true });

    if (insertError) throw new Error("persist:" + insertError.message);

    const { data: persisted, error: readError } = await supabase
      .schema("aria_internal")
      .from("proactive_digests")
      .select("digest_id,engine_version,action_mode,observed_at,fingerprint,source_refs,created_at,digest")
      .eq("digest_id", digestId)
      .maybeSingle();
    if (readError) throw new Error("persist_read:" + readError.message);
    if (!persisted) throw new Error("persist_missing");

    return json({
      ok: true,
      live: true,
      persisted: true,
      engine_version: VERSION,
      action_mode: ACTION_MODE,
      digest_id: persisted.digest_id,
      fingerprint: persisted.fingerprint,
      observed_at: persisted.observed_at,
      recommendation_count: digest.recommendation_count,
      recommendations: digest.recommendations,
      sources: snapshot.source_refs,
      live_health_status: health.status ?? "unknown",
      router_candidate_count: router.candidates?.length ?? 0
    });
  } catch (error) {
    return json({
      ok: false,
      live: true,
      persisted: false,
      error: error instanceof Error ? error.message.slice(0, 400) : "proactive_live_failed"
    }, 500);
  }
});
