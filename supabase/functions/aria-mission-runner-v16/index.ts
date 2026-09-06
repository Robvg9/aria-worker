import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const PLANNER = `${URL}/functions/v1/aria-planner-v9`;
const MEMORY = `${URL}/functions/v1/aria-memory-v2`;
const WORKER = "https://aria.robvg9.workers.dev";
const GH = "https://api.github.com";
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const bearer = (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
};
const equal = (a: string, b: string) => {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
};

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(`${name}:${error.message}`);
  return data;
}

async function sha(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, "0")).join("");
}

async function auth(request: Request) {
  const direct = bearer(request);
  if (direct && SECRET && equal(direct, SECRET)) return true;
  const token = request.headers.get("x-aria-autonomy-token");
  if (!token) return false;
  return (await rpc("aria_autonomy_cron_authorize", { p_token: token })) === true;
}

async function cognitiveRecall(goal: string, token: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-aria-autonomy-token"] = token;
  else if (SECRET) headers.authorization = `Bearer ${SECRET}`;
  try {
    const response = await fetch(MEMORY, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "search", query: goal, limit: 8 })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok) {
      return { available: false, results: [], error: `memory_${response.status}` };
    }
    return { available: true, results: Array.isArray(body.results) ? body.results : [], error: null };
  } catch (error) {
    return { available: false, results: [], error: error instanceof Error ? error.message : String(error) };
  }
}

async function planner(goal: string, token: string | null, cognitiveContext: unknown = null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-aria-autonomy-token"] = token;
  else if (SECRET) headers.authorization = `Bearer ${SECRET}`;
  const response = await fetch(PLANNER, {
    method: "POST",
    headers,
    body: JSON.stringify({ goal, context: cognitiveContext || {} })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok || !Array.isArray(body.plan?.steps)) throw new Error(`planner_${response.status}`);
  return body.plan;
}

async function emit(missionId: string, eventType: string, payload: unknown) {
  return rpc("aria_mission_append_event", {
    p_mission_id: missionId,
    p_event: { event_type: eventType, payload }
  });
}

async function updateMission(missionId: string, mission: Record<string, unknown>) {
  return rpc("aria_mission_update", { p_mission_id: missionId, p_mission: mission });
}

async function githubRead(path: string, operation = "file_read") {
  const clean = String(path || "README.md").replace(/^\/+/, "");
  const url = operation === "repo_read"
    ? `${GH}/repos/Robvg9/aria-worker`
    : `${GH}/repos/Robvg9/aria-worker/contents/${encodeURIComponent(clean).replace(/%2F/g, "/")}?ref=main`;
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "user-agent": "ARIA-autonomy-runner-v16"
    }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`github_${operation}_${response.status}`);
  return { ok: true, status: response.status, data, executor_type: "connector", connector_id: "github", operation };
}

async function cloudflare(operation: string, token: string | null) {
  const root = await fetch(`${WORKER}/`, {
    method: "GET",
    headers: { "user-agent": "ARIA-autonomy-runner-v16", accept: "text/plain" }
  }).catch(() => null);
  if (root?.ok) {
    return { ok: true, status: root.status, data: { service: "aria-worker", liveness: true }, executor_type: "connector", connector_id: "cloudflare", operation, mode: "worker_root_liveness" };
  }

  const headers: Record<string, string> = {};
  if (token) headers["x-aria-autonomy-token"] = token;
  else if (SECRET) headers.authorization = `Bearer ${SECRET}`;
  const response = await fetch(`${WORKER}/admin/cloudflare?operation=${encodeURIComponent(operation)}`, { headers });
  const body = await response.json().catch(() => null);
  if (response.ok && !body?.error) return { ...body, executor_type: "connector", connector_id: "cloudflare", operation };

  const healthHeaders: Record<string, string> = {};
  if (token) healthHeaders["x-aria-autonomy-token"] = token;
  const health = await fetch(`${WORKER}/autonomy-health`, { headers: healthHeaders }).catch(() => null);
  const healthBody = await health?.json().catch(() => null);
  if (health?.ok && healthBody?.ok === true) {
    return { ok: true, status: health.status, data: healthBody, executor_type: "connector", connector_id: "cloudflare", operation, mode: "worker_health_fallback" };
  }
  throw new Error(`cloudflare_unavailable_${response.status}`);
}

async function supabaseExecutor(missionId: string, operation: string) {
  if (operation === "health") return { ok: true, status: 200, data: { service: "supabase", ok: true }, executor_type: "connector", connector_id: "supabase", operation };
  if (operation === "mission_read") return { ok: true, status: 200, data: await rpc("aria_mission_get", { p_mission_id: missionId }), executor_type: "connector", connector_id: "supabase", operation };
  throw new Error(`supabase_operation_not_allowed:${operation}`);
}

async function deviceExecute(missionId: string, step: any, attempt: number) {
  const deviceId = String(step.target?.device_id || step.input?.device_id || Deno.env.get("ARIA_DEFAULT_DEVICE_ID") || "");
  if (!deviceId) throw new Error("device_id_required");
  const jobId = `u1_${(await sha(`${missionId}:${step.id}`)).slice(0, 20)}_a${attempt}`;
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
      p_metadata: { phase1: true, idempotency_key: jobId, attempt }
    });
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    job = await rpc("get_execution_job_gateway", { p_job_id: jobId });
    if (["succeeded", "failed", "timeout", "cancelled", "blocked"].includes(job?.status)) {
      return { ...job, executor_type: "device", operation: "shell.execute", idempotency_key: jobId };
    }
    await sleep(750);
  }
  return { job_id: jobId, status: "waiting", executor_type: "device", operation: "shell.execute", idempotency_key: jobId, retryable: true };
}

async function runStep(missionId: string, step: any, attempt: number, token: string | null) {
  const type = String(step.executor_type || step.target?.type || "connector");
  if (type === "device") return deviceExecute(missionId, step, attempt);
  if (type !== "connector") throw new Error(`unsupported_executor:${type}`);
  const connector = String(step.target?.connector_id || step.connector_id || "");
  const operation = String(step.operation || "");
  if (connector === "github") return githubRead(String(step.input?.path || step.path || "README.md"), operation || "file_read");
  if (connector === "cloudflare") return cloudflare(operation || "worker_read", token);
  if (connector === "supabase") return supabaseExecutor(missionId, operation || "mission_read");
  throw new Error(`unsupported_connector:${connector}`);
}

Deno.serve(async request => {
  if (request.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await auth(request))) return out({ error: "unauthorized" }, 401);

  const body = await request.json().catch(() => ({}));
  const missionId = typeof body.mission_id === "string" ? body.mission_id : null;
  const token = request.headers.get("x-aria-autonomy-token");

  try {
    const recovered = await rpc("aria_autonomy_recover_stale_missions", { p_stale_after: "00:02:00" });
    const mission = missionId
      ? await rpc("aria_mission_get", { p_mission_id: missionId })
      : await rpc("aria_mission_claim_next_lease", { p_worker_id: "aria-mission-runner-v16", p_lease_for: "00:02:00" });

    if (!mission) return out({ ok: true, status: "idle", recovered });

    const id = mission.mission_id;
    const cognitive = await cognitiveRecall(String(mission.goal || ""), token);
    const cognitiveContext = {
      version: "cognitive-loop-v2",
      available: cognitive.available,
      recall_count: cognitive.results.length,
      memory_ids: cognitive.results.map((item: any) => item.memory_id || item.id).filter(Boolean),
      recalled_memories: cognitive.results.slice(0, 8),
      error: cognitive.error
    };

    await emit(id, "cognitive_recall_completed", {
      version: cognitiveContext.version,
      available: cognitiveContext.available,
      recall_count: cognitiveContext.recall_count,
      memory_ids: cognitiveContext.memory_ids,
      error: cognitiveContext.error
    });

    const initialCheckpoint = {
      ...(mission.checkpoint ?? {}),
      cognitive_context: cognitiveContext,
      cognitive_loop: { version: "cognitive-loop-v2", recalled_before_planning: true }
    };
    await updateMission(id, { checkpoint: initialCheckpoint });

    let plan = Array.isArray(mission.checkpoint?.plan) && mission.checkpoint.plan.length
      ? mission.checkpoint.plan
      : (await planner(String(mission.goal || ""), token, cognitiveContext)).steps;

    const checkpoint = { ...initialCheckpoint, plan };
    const done = new Set<string>(Array.isArray(checkpoint.completed_steps) ? checkpoint.completed_steps.map(String) : []);
    const attempts: Record<string, number> = checkpoint.attempts && typeof checkpoint.attempts === "object" ? { ...checkpoint.attempts } : {};

    await updateMission(id, {
      status: "running",
      total_steps: plan.length,
      current_step: done.size,
      checkpoint
    });
    await emit(id, "cognitive_planning_context_used", {
      recall_count: cognitiveContext.recall_count,
      memory_ids: cognitiveContext.memory_ids,
      planner_context_version: "cognitive-loop-v2"
    });

    for (const step of plan) {
      const stepId = String(step.id);
      if (done.has(stepId)) continue;
      const dependencies = Array.isArray(step.depends_on) ? step.depends_on.map(String) : [];
      if (!dependencies.every(dep => done.has(dep))) {
        await updateMission(id, { status: "blocked", next_action: "recovery: dependency graph waiting", lease_owner: null, lease_until: null });
        return out({ ok: false, status: "blocked", reason: "dependencies_unsatisfied", mission_id: id });
      }

      let attempt = Number(attempts[stepId] || 0);
      let passed = false;
      while (attempt < 3 && !passed) {
        attempt += 1;
        attempts[stepId] = attempt;
        await emit(id, "step_started", {
          step_id: stepId,
          operation: step.operation,
          executor_type: step.executor_type || step.target?.type || "connector",
          attempt
        });

        let result: any;
        try {
          result = await runStep(id, step, attempt, token);
        } catch (error) {
          result = {
            status: "failed",
            stderr: error instanceof Error ? error.message : String(error),
            executor_type: step.executor_type || step.target?.type || "connector",
            operation: step.operation,
            attempt
          };
        }

        passed = result?.status === "succeeded" || (result?.ok === true && result?.status !== "waiting");
        if (passed) {
          done.add(stepId);
          await emit(id, "step_succeeded", {
            step_id: stepId,
            executor_type: result.executor_type,
            connector_id: result.connector_id || null,
            operation: result.operation || step.operation || null,
            attempt
          });
          await updateMission(id, {
            current_step: done.size,
            completed_steps: done.size,
            last_stdout: typeof result.stdout === "string" ? result.stdout : JSON.stringify(result).slice(0, 4000),
            last_stderr: result.stderr || "",
            next_action: done.size < plan.length ? "next_ready_step" : "verify_goal",
            checkpoint: { ...checkpoint, completed_steps: [...done], attempts }
          });
          break;
        }

        await emit(id, "step_failed", {
          step_id: stepId,
          attempt,
          retryable: attempt < 3,
          executor_type: result?.executor_type,
          connector_id: result?.connector_id || null,
          operation: result?.operation || step.operation || null,
          reason: result?.stderr || result?.error || result?.status || "unknown"
        });

        if (result?.status === "waiting") {
          await updateMission(id, {
            status: "running",
            next_action: "resume: waiting executor",
            checkpoint: { ...checkpoint, completed_steps: [...done], attempts, waiting_step: stepId }
          });
          return out({ ok: true, status: "waiting", mission_id: id, step_id: stepId });
        }
        if (attempt < 3 && step.retryable !== false) await sleep(200 * attempt);
      }

      if (!passed) {
        const deadLetter = {
          step_id: stepId,
          attempts: attempts[stepId],
          reason: "max_attempts_exhausted",
          recorded_at: new Date().toISOString()
        };
        await updateMission(id, {
          status: "blocked",
          next_action: "recovery: dead_letter",
          last_stderr: deadLetter.reason,
          lease_owner: null,
          lease_until: null,
          checkpoint: { ...checkpoint, completed_steps: [...done], attempts, dead_letter: deadLetter }
        });
        await emit(id, "mission_dead_lettered", deadLetter);
        return out({ ok: false, status: "blocked", reason: "dead_letter", mission_id: id });
      }
    }

    await emit(id, "mission_verified", {
      steps: plan.length,
      executor_types: [...new Set(plan.map((step: any) => step.executor_type || step.target?.type || "connector"))]
    });
    await emit(id, "cognitive_loop_completed", {
      version: "cognitive-loop-v2",
      recall_count: cognitiveContext.recall_count,
      memory_ids: cognitiveContext.memory_ids,
      steps: plan.length,
      recovered,
      verified: true
    });
    await updateMission(id, {
      status: "succeeded",
      current_step: plan.length,
      completed_steps: plan.length,
      next_action: null,
      lease_owner: null,
      lease_until: null,
      finished_at: new Date().toISOString(),
      checkpoint: { ...checkpoint, completed_steps: plan.map((step: any) => String(step.id)), attempts, verified: true, cognitive_loop_completed: true }
    });
    await emit(id, "mission_succeeded", { steps: plan.length });
    return out({ ok: true, status: "succeeded", mission_id: id, steps: plan.length, cognitive: { recall_count: cognitiveContext.recall_count, memory_ids: cognitiveContext.memory_ids } });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (missionId) {
      try { await updateMission(missionId, { status: "paused", next_action: "recovery: runner exception", last_stderr: reason }); } catch (_) {}
    }
    return out({ ok: false, status: "paused", reason }, 200);
  }
});
