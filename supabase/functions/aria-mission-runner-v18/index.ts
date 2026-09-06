import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyStrategicCompletion } from "../_shared/strategic-goal-completion.mjs";
import { githubRead, githubCreateBranch, githubWrite, githubPr } from "../_shared/github-app.mjs";

const VERSION = "aria-mission-runner-v18";
const WORKER_ID = VERSION;
const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const MEMORY = `${URL}/functions/v1/aria-memory-v2`;
const PLANNER = `${URL}/functions/v1/aria-planner-v10`;
const WORKER = "https://aria.robvg9.workers.dev";
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const READ_ONLY = new Set(["file_read", "account_read", "content_read", "deployment_read", "worker_read", "health", "mission_read"]);

const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const bearer = (r: Request) => { const h = r.headers.get("authorization") ?? ""; return h.startsWith("Bearer ") ? h.slice(7) : null; };
const equal = (a: string, b: string) => { const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b); if (x.length !== y.length) return false; let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0; };
const rpc = async (name: string, args: Record<string, unknown>) => { const { data, error } = await sb.rpc(name, args); if (error) throw new Error(`${name}:${error.message}`); return data; };

async function auth(r: Request) {
  const direct = bearer(r);
  if (direct && SECRET && equal(direct, SECRET)) return true;
  const token = r.headers.get("x-aria-autonomy-token");
  return !!token && (await rpc("aria_autonomy_cron_authorize", { p_token: token })) === true;
}

async function recall(goal: string, token: string | null) {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (token) h["x-aria-autonomy-token"] = token; else if (SECRET) h.authorization = `Bearer ${SECRET}`;
  try {
    const r = await fetch(MEMORY, { method: "POST", headers: h, body: JSON.stringify({ action: "search", query: goal, limit: 8 }) });
    const b = await r.json().catch(() => null);
    return { available: r.ok && b?.ok === true, results: r.ok && Array.isArray(b?.results) ? b.results : [], error: r.ok && b?.ok === true ? null : `memory_${r.status}` };
  } catch (e) { return { available: false, results: [], error: e instanceof Error ? e.message : String(e) }; }
}

async function plan(goal: string, token: string | null, context: unknown) {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (token) h["x-aria-autonomy-token"] = token; else if (SECRET) h.authorization = `Bearer ${SECRET}`;
  const r = await fetch(PLANNER, { method: "POST", headers: h, body: JSON.stringify({ goal, context }) });
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.ok || !Array.isArray(b.plan?.steps)) throw new Error(`planner_${r.status}`);
  return b.plan.steps;
}

const emit = (id: string, type: string, payload: unknown) => rpc("aria_mission_append_event", { p_mission_id: id, p_event: { event_type: type, payload } });
const update = (id: string, mission: Record<string, unknown>) => rpc("aria_mission_update", { p_mission_id: id, p_mission: mission });

async function hash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function deviceExecute(missionId: string, step: any, attempt: number) {
  const deviceId = String(step.target?.device_id || step.input?.device_id || Deno.env.get("ARIA_DEFAULT_DEVICE_ID") || "");
  if (!deviceId) throw new Error("device_id_required");
  const jobId = `u1_${(await hash(`${missionId}:${step.id}`)).slice(0, 20)}_a${attempt}`;
  let job = await rpc("get_execution_job_gateway", { p_job_id: jobId });
  if (!job) {
    job = await rpc("enqueue_execution_job_gateway", {
      p_job_id: jobId,
      p_mission_id: missionId,
      p_device_id: deviceId,
      p_operation: "shell.execute",
      p_command: String(step.input?.command || step.command || "echo ARIA"),
      p_cwd: typeof step.input?.cwd === "string" ? step.input.cwd : null,
      p_timeout_ms: Number.isInteger(step.timeout_ms) ? step.timeout_ms : 30000,
      p_policy: step.policy && typeof step.policy === "object" ? step.policy : {},
      p_metadata: { runner: VERSION, idempotency_key: jobId, attempt }
    });
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    job = await rpc("get_execution_job_gateway", { p_job_id: jobId });
    if (["succeeded", "failed", "timeout", "cancelled", "blocked"].includes(job?.status)) return { ...job, executor_type: "device", operation: "shell.execute", idempotency_key: jobId };
    await sleep(750);
  }
  return { job_id: jobId, status: "waiting", executor_type: "device", operation: "shell.execute", idempotency_key: jobId };
}

async function cloudflare(op: string) {
  const r = await fetch(`${WORKER}/`, { headers: { "user-agent": `${VERSION}-liveness` } }).catch(() => null);
  if (r?.ok) return { ok: true, status: r.status, executor_type: "connector", connector_id: "cloudflare", operation: op, mode: "worker_root_liveness" };
  throw new Error(`cloudflare_unavailable_${r?.status ?? "network"}`);
}

async function supabaseExec(id: string, op: string) {
  if (op === "health") return { ok: true, status: 200, executor_type: "connector", connector_id: "supabase", operation: op };
  if (op === "mission_read") return { ok: true, status: 200, executor_type: "connector", connector_id: "supabase", operation: op, data: await rpc("aria_mission_get", { p_mission_id: id }) };
  throw new Error(`supabase_operation_not_allowed:${op}`);
}

async function stepExec(id: string, step: any, attempt: number) {
  const type = String(step.executor_type || step.target?.type || "connector");
  if (type === "device") return deviceExecute(id, step, attempt);
  if (type !== "connector") throw new Error(`unsupported_executor:${type}`);
  const connector = String(step.target?.connector_id || step.connector_id || "");
  const op = String(step.operation || "");
  if (connector === "github") {
    if (op === "file_read") return githubRead(String(step.input?.path || step.path || "README.md"), String(step.input?.ref || step.ref || "main"));
    if (op === "branch_create") return githubCreateBranch({ branch: String(step.input?.branch || step.branch || `aria/autonomous/${id}`), base: String(step.input?.base || step.base || "main") });
    if (op === "file_write") return githubWrite({ path: String(step.input?.path || step.path || ""), content: String(step.input?.content ?? step.content ?? ""), branch: String(step.input?.branch || step.branch || `aria/autonomous/${id}`), base: String(step.input?.base || step.base || "main"), message: String(step.input?.message || step.message || `ARIA autonomous change for ${id}`) });
    if (op === "pull_request_create") return githubPr({ branch: String(step.input?.branch || step.branch || `aria/autonomous/${id}`), base: String(step.input?.base || step.base || "main"), title: String(step.input?.title || step.title || "ARIA autonomous change"), body: String(step.input?.body || step.body || `Automated change proposed by ARIA for mission ${id}. Human review required before merge.`), draft: Boolean(step.input?.draft ?? step.draft ?? false) });
    throw new Error(`github_operation_not_allowed:${op}`);
  }
  if (connector === "cloudflare") return cloudflare(op || "worker_read");
  if (connector === "supabase") return supabaseExec(id, op || "mission_read");
  throw new Error(`unsupported_connector:${connector}`);
}

function depsReady(step: any, done: Set<string>) { const deps = Array.isArray(step?.depends_on) ? step.depends_on : []; return deps.every((d: any) => done.has(String(d))); }
function parallelSafe(step: any) {
  const type = String(step?.executor_type || step?.target?.type || "connector");
  const op = String(step?.operation || "").toLowerCase();
  const risk = String(step?.risk || "").toUpperCase();
  return type === "connector" && (risk === "READ" || READ_ONLY.has(op));
}
function readyBatch(steps: any[], done: Set<string>, limit = 2) { return steps.filter(s => !done.has(String(s.id)) && depsReady(s, done)).slice(0, limit); }

async function executeOne(id: string, step: any, attempts: Record<string, number>) {
  const sid = String(step.id); let attempt = Number(attempts[sid] || 0), passed = false, result: any = null;
  while (attempt < 3 && !passed) {
    attempt += 1; attempts[sid] = attempt;
    await emit(id, "step_started", { step_id: sid, operation: step.operation, executor_type: step.executor_type || step.target?.type || "connector", attempt, risk: step.risk || null });
    try { result = await stepExec(id, step, attempt); } catch (e) { result = { status: "failed", stderr: e instanceof Error ? e.message : String(e), executor_type: step.executor_type || step.target?.type || "connector", operation: step.operation, attempt }; }
    passed = result?.status === "succeeded" || (result?.ok === true && result?.status !== "waiting");
    if (passed) await emit(id, "step_succeeded", { step_id: sid, executor_type: result.executor_type, connector_id: result.connector_id || null, operation: result.operation || step.operation || null, attempt });
    else await emit(id, "step_failed", { step_id: sid, attempt, retryable: attempt < 3, executor_type: result?.executor_type, connector_id: result?.connector_id || null, operation: result?.operation || step.operation || null, reason: result?.stderr || result?.error || result?.status || "unknown" });
    if (!passed && attempt < 3) await sleep(200 * attempt);
  }
  return { step, result, passed, attempt };
}

Deno.serve(async r => {
  if (r.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await auth(r))) return out({ error: "unauthorized" }, 401);
  const body = await r.json().catch(() => ({}));
  const token = r.headers.get("x-aria-autonomy-token");
  try {
    const recovered = await rpc("aria_autonomy_recover_stale_missions", { p_stale_after: "00:02:00" });
    let mission = typeof body.mission_id === "string"
      ? await rpc("aria_mission_claim_by_id_lease", { p_mission_id: body.mission_id, p_worker_id: WORKER_ID, p_lease_for: "00:02:00" })
      : await rpc("aria_mission_claim_next_lease", { p_worker_id: WORKER_ID, p_lease_for: "00:02:00" });
    if (!mission) return out({ ok: true, status: "idle", recovered, runtime: VERSION });
    const id = mission.mission_id, goal = String(mission.goal || "");
    const recalled = await recall(goal, token);
    const context = { version: "cognitive-loop-v2", available: recalled.available, recall_count: recalled.results.length, memory_ids: recalled.results.map((x: any) => x.memory_id || x.id).filter(Boolean), recalled_memories: recalled.results.slice(0, 8), error: recalled.error };
    await emit(id, "cognitive_recall_completed", context);
    const baseCheckpoint = { ...(mission.checkpoint || {}), cognitive_context: context, cognitive_loop: { version: "cognitive-loop-v2", recalled_before_planning: true } };
    await update(id, { status: "planning", checkpoint: baseCheckpoint });
    const steps = Array.isArray(baseCheckpoint.plan) && baseCheckpoint.plan.length ? baseCheckpoint.plan : await plan(goal, token, context);
    if (!steps.length) throw new Error("planner_empty_steps");
    const checkpoint = { ...baseCheckpoint, plan: steps }, done = new Set<string>(Array.isArray(checkpoint.completed_steps) ? checkpoint.completed_steps.map(String) : []), attempts: Record<string, number> = checkpoint.attempts && typeof checkpoint.attempts === "object" ? { ...checkpoint.attempts } : {};
    await update(id, { status: "running", total_steps: steps.length, current_step: done.size, completed_steps: done.size, checkpoint });
    await emit(id, "cognitive_planning_context_used", { recall_count: context.recall_count, memory_ids: context.memory_ids, planner_context_version: "cognitive-loop-v2" });
    while (done.size < steps.length) {
      const unresolved = steps.filter((s: any) => !done.has(String(s.id)));
      const ready = readyBatch(unresolved, done, 2);
      if (!ready.length) { const blocked = unresolved.find((s: any) => !depsReady(s, done)); const reason = blocked ? `dependencies_unsatisfied:${blocked.id}` : "no_ready_step"; await update(id, { status: "blocked", next_action: "recovery: dependency_dead_letter", last_stderr: reason, lease_owner: null, lease_until: null, checkpoint: { ...checkpoint, completed_steps: [...done], attempts, dependency_blocked: true } }); await emit(id, "mission_dead_lettered", { reason }); return out({ ok: false, status: "blocked", mission_id: id, reason }); }
      const batch = ready.length > 1 && ready.every(parallelSafe) ? ready : ready.slice(0, 1);
      await emit(id, "step_batch_started", { batch_id: `batch_${done.size + 1}`, step_ids: batch.map((s: any) => String(s.id)), parallel: batch.length > 1, max_parallel: 2 });
      const results = await Promise.all(batch.map((s: any) => executeOne(id, s, attempts)));
      const failures = results.filter(x => !x.passed);
      for (const item of results) if (item.passed) done.add(String(item.step.id));
      await update(id, { current_step: done.size, completed_steps: done.size, next_action: done.size < steps.length ? "next_ready_batch" : "verify_goal", checkpoint: { ...checkpoint, completed_steps: [...done], attempts, active_steps: [], last_batch: batch.map((s: any) => String(s.id)), parallel_batch: batch.length > 1 } });
      if (failures.length) { const f = failures[0]; const dl = { step_id: String(f.step.id), attempts: f.attempt, reason: "max_attempts_exhausted" }; await update(id, { status: "blocked", next_action: "recovery: dead_letter", last_stderr: dl.reason, lease_owner: null, lease_until: null, checkpoint: { ...checkpoint, completed_steps: [...done], attempts, dead_letter: dl } }); await emit(id, "mission_dead_lettered", dl); return out({ ok: false, status: "blocked", mission_id: id, reason: "dead_letter", runtime: VERSION }); }
    }
    const completion = verifyStrategicCompletion({ goal, goalSource: mission.metadata?.goal_source, steps });
    if (!completion.verified) { const evidence = { ...completion, goal_source: mission.metadata?.goal_source || null, steps: steps.map((s: any) => ({ id: s.id, operation: s.operation, risk: s.risk || null, executor_type: s.executor_type || s.target?.type || "connector" })) }; await update(id, { status: "blocked", next_action: "recovery: planner_replan_required", last_stderr: completion.reason, lease_owner: null, lease_until: null, checkpoint: { ...checkpoint, completed_steps: [...done], attempts, strategic_completion: evidence } }); await emit(id, "mission_goal_completion_insufficient", evidence); return out({ ok: false, status: "blocked", mission_id: id, reason: completion.reason, runtime: VERSION }); }
    await emit(id, "mission_verified", { steps: steps.length, executor_types: [...new Set(steps.map((s: any) => s.executor_type || s.target?.type || "connector"))], goal_completion: completion });
    await emit(id, "cognitive_loop_completed", { version: "cognitive-loop-v2", recall_count: context.recall_count, memory_ids: context.memory_ids, steps: steps.length, recovered, verified: true });
    await update(id, { status: "succeeded", current_step: steps.length, completed_steps: steps.length, next_action: null, lease_owner: null, lease_until: null, finished_at: new Date().toISOString(), checkpoint: { ...checkpoint, completed_steps: steps.map((s: any) => String(s.id)), attempts, active_steps: [], parallel_execution: true, cognitive_loop_completed: true, strategic_completion: completion } });
    await emit(id, "mission_succeeded", { steps: steps.length });
    return out({ ok: true, status: "succeeded", mission_id: id, steps: steps.length, runtime: VERSION, cognitive: { recall_count: context.recall_count, memory_ids: context.memory_ids } });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (typeof body.mission_id === "string") try { await update(body.mission_id, { status: "paused", next_action: "recovery: runner exception", last_stderr: reason, lease_owner: null, lease_until: null }); } catch (_) {}
    return out({ ok: false, status: "paused", reason, runtime: VERSION }, 200);
  }
});
