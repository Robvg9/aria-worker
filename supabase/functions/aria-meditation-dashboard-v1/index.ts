import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,apikey,x-client-info,content-type",
  "access-control-allow-methods": "GET,OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
});
const bearer = (req: Request) => {
  const value = req.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
};
function serviceClient() {
  if (!KEY) throw new Error("service_role_not_configured");
  return createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false } });
}
async function requireUser(token: string) {
  if (!token) throw Object.assign(new Error("missing_authorization"), { status: 401 });
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data?.user?.id) throw Object.assign(new Error("invalid_or_expired_session"), { status: 401 });
  return data.user;
}

const terminal = new Set(["succeeded", "failed", "blocked", "cancelled"]);
const weightFor = (step: any) => {
  const explicit = Number(step?.weight);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const risk = String(step?.risk ?? "READ").toUpperCase();
  const base = risk === "DESTRUCTIVE" ? 3 : risk === "HIGH_RISK_WRITE" ? 2.2 : risk === "LOW_RISK_WRITE" ? 1.4 : 1;
  const executor = String(step?.executor_type || step?.target?.type || "").toLowerCase();
  return base * (executor === "device" || executor === "self_improvement" ? 1.25 : executor === "agent" ? 1.15 : 1);
};

function classifyReason(mission: any) {
  const raw = [mission?.next_action, mission?.last_stderr, mission?.checkpoint?.recovery?.status, mission?.checkpoint?.human_gate?.original_risk]
    .filter(Boolean).join(" ").toLowerCase();
  if (/credential|token|secret|auth|login|api key/.test(raw)) return "credential";
  if (/payment|billing|subscription|plan/.test(raw)) return "payment";
  if (/human_gate|approval|approve|authorize|permission/.test(raw)) return "approval";
  if (/device|windows|offline|agent/.test(raw)) return "device";
  return "execution";
}

const toMs = (value: string | null | undefined) => value ? Date.parse(value) : NaN;

function stepRows(mission: any) {
  const plan = Array.isArray(mission?.checkpoint?.plan) ? mission.checkpoint.plan : [];
  const completed = new Set((Array.isArray(mission?.checkpoint?.completed_steps) ? mission.checkpoint.completed_steps : []).map(String));
  const results = mission?.checkpoint?.results && typeof mission.checkpoint.results === "object" ? mission.checkpoint.results : {};
  const recovery = mission?.checkpoint?.recovery && typeof mission.checkpoint.recovery === "object" ? mission.checkpoint.recovery : {};
  return plan.map((step: any, index: number) => {
    const id = String(step?.id ?? `step_${index + 1}`);
    let status = completed.has(id) ? "succeeded" : "pending";
    if (!completed.has(id) && mission?.status === "blocked" && (recovery.failed_step_ids || []).map?.(String).includes(id)) status = "blocked";
    if (!completed.has(id) && mission?.status === "paused" && recovery.status === "waiting_for_async_executor") status = String(mission?.checkpoint?.pending_jobs?.[id] ? "waiting" : "pending");
    if (!completed.has(id) && mission?.status === "running" && Number(mission?.current_step ?? 0) === index) status = "running";
    if (!completed.has(id) && results[id]?.status === "failed") status = "failed";
    return {
      index: index + 1,
      id,
      title: String(step?.title ?? step?.operation ?? `Paso ${index + 1}`),
      status,
      risk: String(step?.risk ?? "READ"),
      executor_type: String(step?.executor_type || step?.target?.type || ""),
      operation: String(step?.operation ?? ""),
      depends_on: Array.isArray(step?.depends_on) ? step.depends_on.map(String) : [],
      weight: Number(weightFor(step).toFixed(3)),
      timeout_ms: Number.isFinite(Number(step?.timeout_ms)) ? Number(step.timeout_ms) : null,
      result: results[id] ?? null,
    };
  });
}

async function historicalEta(sb: ReturnType<typeof serviceClient>, mission: any, rows: any[]) {
  const remaining = rows.filter((s) => s.status !== "succeeded" && s.status !== "skipped");
  if (!remaining.length) return { eta_seconds: 0, basis: "complete" };
  const operations = [...new Set(remaining.map((s) => s.operation).filter(Boolean))];
  const executors = [...new Set(remaining.map((s) => s.executor_type).filter(Boolean))];
  let historical: number[] = [];
  if (operations.length) {
    const { data } = await sb.schema("aria_internal").from("mission_steps")
      .select("operation,executor_type:agent_id,started_at,completed_at")
      .in("operation", operations)
      .not("started_at", "is", null)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(120);
    historical = (data ?? []).map((r: any) => {
      const ms = toMs(r.started_at) >= 0 && toMs(r.completed_at) >= 0 ? toMs(r.completed_at) - toMs(r.started_at) : NaN;
      return Number.isFinite(ms) && ms > 0 && ms < 86_400_000 ? ms / 1000 : NaN;
    }).filter(Number.isFinite);
  }
  const defaultSeconds = (step: any) => {
    const timeout = Number(step?.timeout_ms);
    if (Number.isFinite(timeout) && timeout > 0) return Math.max(5, Math.min(900, timeout / 1000 * 0.35));
    if (executors.includes("device") || step.executor_type === "device") return 30;
    return 12;
  };
  const median = historical.length ? [...historical].sort((a,b)=>a-b)[Math.floor(historical.length/2)] : null;
  const seconds = remaining.reduce((sum, step) => sum + ((median && step.operation ? median : defaultSeconds(step)) * (Number(step.weight) || 1)), 0);
  return { eta_seconds: Math.max(0, Math.round(seconds)), basis: historical.length ? "historical_operation_median" : "step_estimate", samples: historical.length };
}

async function buildOverview(userId: string) {
  const sb = serviceClient();
  const { data: controller, error: controllerError } = await sb.schema("aria_internal").from("meditation_control")
    .select("controller_id,owner_user_id,desired_mode,session_id,revision,last_command,last_command_at,last_cloud_tick_at,last_cloud_status,metadata,updated_at")
    .eq("controller_id", "primary").maybeSingle();
  if (controllerError) throw new Error(controllerError.message);
  if (controller?.owner_user_id && controller.owner_user_id !== userId) {
    return { mode: "stopped", controller: null, active_mission: null, missions: [], human_gates: [], blocked: [], counts: { missions: 0, human_gates: 0, blocked: 0 } };
  }

  const { data: missions, error: missionError } = await sb.schema("aria_internal").from("mission_state")
    .select("mission_id,goal,status,current_step,total_steps,completed_steps,next_action,last_stdout,last_stderr,finished_at,checkpoint,metadata,created_at,updated_at")
    .order("updated_at", { ascending: false }).limit(80);
  if (missionError) throw new Error(missionError.message);
  const owned = (missions ?? []).filter((m: any) => {
    const md = m?.metadata && typeof m.metadata === "object" ? m.metadata : {};
    return md.user_id === userId || md.owner_user_id === userId || (controller?.session_id && md.meditation_session_id === controller.session_id);
  });
  const enriched = await Promise.all(owned.slice(0, 30).map(async (mission: any) => {
    const steps = stepRows(mission);
    const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0);
    const doneWeight = steps.filter((s) => s.status === "succeeded" || s.status === "skipped").reduce((sum, step) => sum + step.weight, 0);
    const progress = totalWeight > 0 ? Math.max(0, Math.min(100, Math.round(doneWeight / totalWeight * 1000) / 10)) : (mission.total_steps ? Math.round((mission.completed_steps || 0) / mission.total_steps * 1000) / 10 : 0);
    const eta = await historicalEta(sb, mission, steps);
    return { ...mission, progress_percent: progress, steps, step_count: steps.length, eta, terminal: terminal.has(String(mission.status)) };
  }));
  const activeMission = enriched.find((m) => ["running","queued","planning","paused","waiting"].includes(String(m.status))) ?? null;

  const gateMissions = enriched.filter((m) => !terminal.has(String(m.status)));
  const { data: gateEvents, error: gateError } = await sb.schema("aria_internal").from("mission_events")
    .select("mission_id,step_index,event_type,payload,created_at")
    .in("event_type", ["human_gate_requested", "self_improvement_human_gate"])
    .order("created_at", { ascending: false }).limit(100);
  if (gateError) throw new Error(gateError.message);
  const gateByMission = new Map(enriched.map((m) => [m.mission_id, m]));
  const gates = [] as any[];
  for (const e of gateEvents ?? []) {
    const mission = gateByMission.get(String(e.mission_id));
    if (!mission || terminal.has(String(mission.status))) continue;
    const payload = e.payload && typeof e.payload === "object" ? e.payload : {};
    const step = mission.steps.find((s: any) => s.id === String(payload.step_id ?? "")) ?? null;
    gates.push({ id: `${e.mission_id}:${e.created_at}`, mission_id: e.mission_id, step_id: payload.step_id ?? null, event_type: e.event_type,
      reason: payload.stop_reason ?? "human_gate_required", risk: step?.risk ?? mission.metadata?.human_gate_required?.[0] ?? "HIGH_RISK_WRITE",
      mission_goal: mission.goal, operation: step?.operation ?? null, target: step ? { executor_type: step.executor_type, operation: step.operation } : null,
      instructions: [
        `Revisa la misión: ${mission.goal}`,
        `Confirma el paso ${step?.index ?? payload.step_id ?? "pendiente"} y su operación ${step?.operation ?? "indicada por el gate"}.`,
        `Verifica el riesgo declarado (${step?.risk ?? "HIGH_RISK_WRITE"}) y el objetivo antes de aprobar.`,
        "Usa el control Human Gate de ARIA para aprobar o rechazar la continuación.",
      ],
      source: e.created_at,
    });
  }
  for (const mission of gateMissions) {
    const required = mission?.metadata?.human_gate_required;
    if (!Array.isArray(required) || !required.length) continue;
    if (gates.some((g) => g.mission_id === mission.mission_id)) continue;
    gates.push({ id: `${mission.mission_id}:policy`, mission_id: mission.mission_id, step_id: null, event_type: "policy_gate", reason: "human_gate_required", risk: String(required[0]), mission_goal: mission.goal,
      operation: null, target: null,
      instructions: ["Revisa la misión y el cambio propuesto.", `Confirma la categoría de riesgo: ${String(required[0])}.`, "Aprueba o rechaza la continuación desde Human Gate de ARIA."], source: mission.updated_at });
  }

  const blocked = enriched.filter((m) => String(m.status) === "blocked").map((mission) => ({
    mission_id: mission.mission_id, goal: mission.goal, status: mission.status, reason_type: classifyReason(mission), reason: mission.last_stderr || mission.next_action || mission.checkpoint?.recovery?.status || "La misión quedó bloqueada.",
    next_action: mission.next_action, step: mission.steps.find((s) => ["blocked","failed","running"].includes(s.status)) ?? null,
    instructions: ["Revisa el motivo indicado.", mission.next_action ? `Siguiente acción: ${mission.next_action}` : "Determina qué recurso o autorización falta.", "Corrige el bloqueo y vuelve a ejecutar la misión desde el checkpoint."],
    updated_at: mission.updated_at,
  }));

  return {
    version: "aria-meditation-dashboard-v1",
    mode: String(controller?.desired_mode ?? "stopped"),
    controller,
    active_mission: activeMission,
    missions: enriched,
    human_gates: gates.slice(0, 30),
    blocked: blocked.slice(0, 30),
    counts: { missions: enriched.length, human_gates: gates.length, blocked: blocked.length },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  try {
    const user = await requireUser(bearer(req));
    return json({ ok: true, ...(await buildOverview(user.id)) });
  } catch (e) {
    const status = (e as any)?.status === 401 ? 401 : 500;
    return json({ ok: false, error: String((e as any)?.message ?? e) }, status);
  }
});
