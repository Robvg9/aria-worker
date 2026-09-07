import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const V = "aria-mission-runner-v22-universal";
const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const MEMORY = `${URL}/functions/v1/aria-memory-v2`;
const PLANNER = `${URL}/functions/v1/aria-planner-v11`;
const EXEC = `${URL}/functions/v1/aria-execution-runtime-v1`;
const RUNTIME = `${URL}/functions/v1/aria-runtime-gateway-v1`;
const AGENT = `${URL}/functions/v1/aria-agent-runtime-v1`;
const LEASE_FOR = "00:15:00";
const MAX_STEP_ATTEMPTS = 2;
const RETRYABLE_STATUSES = new Set(["failed", "timeout"]);

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false },
});

const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

const constantTimeEqual = (a: string, b: string) => {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i += 1) d |= x[i] ^ y[i];
  return d === 0;
};

const tokenOf = (request: Request) => {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : request.headers.get("x-aria-autonomy-token");
};

const downstreamHeaders = (token: string | null) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-aria-autonomy-token"] = token;
  else if (SECRET) headers.authorization = `Bearer ${SECRET}`;
  return headers;
};

const internalHeaders = () => ({
  "content-type": "application/json",
  authorization: `Bearer ${SECRET}`,
});

const rpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(`${name}:${error.message}`);
  return data;
};

async function authorized(request: Request) {
  const token = tokenOf(request);
  if (token && SECRET && constantTimeEqual(token, SECRET)) return true;
  if (!token) return false;
  const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: token });
  return !error && data === true;
}

async function renewLease(missionId: string) {
  const renewed = await rpc("aria_internal.aria_mission_renew_lease", {
    p_mission_id: missionId,
    p_worker_id: V,
    p_lease_for: LEASE_FOR,
  });
  if (!renewed) throw new Error("mission_lease_lost");
  return renewed;
}

async function updateMission(missionId: string, patch: Record<string, unknown>) {
  const updated = await rpc("aria_mission_update_lease", {
    p_mission_id: missionId,
    p_worker_id: V,
    p_mission: patch,
  });
  if (!updated) throw new Error("mission_lease_lost");
  return updated;
}

async function emitEvent(missionId: string, event_type: string, payload: unknown) {
  const event = await rpc("aria_mission_append_event_lease", {
    p_mission_id: missionId,
    p_worker_id: V,
    p_event: { event_type, payload },
  });
  if (!event) throw new Error("mission_event_lease_lost");
  return event;
}

async function recall(goal: string, token: string | null) {
  try {
    const response = await fetch(MEMORY, {
      method: "POST",
      headers: downstreamHeaders(token),
      body: JSON.stringify({ action: "search", query: goal, limit: 8 }),
    });
    const body = await response.json().catch(() => null);
    return {
      available: response.ok && body?.ok === true,
      results: Array.isArray(body?.results) ? body.results : [],
    };
  } catch {
    return { available: false, results: [] };
  }
}

async function createPlan(goal: string, context: unknown, token: string | null) {
  const response = await fetch(PLANNER, {
    method: "POST",
    headers: downstreamHeaders(token),
    body: JSON.stringify({ goal, context }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok || !Array.isArray(body.plan?.steps)) {
    throw new Error(`planner_${response.status}`);
  }
  return body.plan.steps;
}

function executorType(step: any) {
  return String(step?.executor_type || step?.target?.type || "");
}

function validateStep(step: any) {
  const type = executorType(step);
  if (!["connector", "device", "model", "agent"].includes(type)) {
    throw new Error(`unknown_executor_type:${type}`);
  }
  if (!step?.operation) throw new Error("operation_missing");
  if (type === "connector" && !step.target?.connector_id) throw new Error("connector_target_missing");
  if (type === "device" && !step.target?.device_id) throw new Error("device_target_missing");
  if (type === "model" && (!step.target?.provider_id || !step.target?.account_id || !step.target?.model_id)) {
    throw new Error("model_route_incomplete");
  }
  if (type === "agent" && !step.target?.agent_id) throw new Error("agent_target_missing");
}

function verifyStep(step: any, result: any) {
  if (!(result?.status === "succeeded" || result?.ok === true)) return false;
  const verify = step?.verify && typeof step.verify === "object" ? step.verify : {};
  if (verify.expected_exit_code !== undefined && Number(result?.exit_code) !== Number(verify.expected_exit_code)) return false;
  if (typeof verify.stdout_contains === "string" && !String(result?.stdout ?? "").includes(verify.stdout_contains)) return false;
  if (typeof verify.stderr_contains === "string" && !String(result?.stderr ?? "").includes(verify.stderr_contains)) return false;
  if (typeof verify.response_content_equals === "string" && String(result?.response?.content ?? result?.response?.output_text ?? "") !== verify.response_content_equals) return false;
  if (typeof verify.response_content_contains === "string" && !String(result?.response?.content ?? result?.response?.output_text ?? "").includes(verify.response_content_contains)) return false;
  return true;
}

function jobIdFor(missionId: string, stepId: string) {
  const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 28);
  return `uo_${safe(missionId)}_${safe(stepId)}`;
}

async function getExecutionJob(jobId: string) {
  const response = await fetch(RUNTIME, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({ action: "get_job", job_id: jobId }),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function enqueueDeviceJob(missionId: string, step: any, jobId: string) {
  const response = await fetch(RUNTIME, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      action: "enqueue_device_job",
      job_id: jobId,
      mission_id: missionId,
      device_id: step.target.device_id,
      operation: "shell.execute",
      command: String(step.input?.command || "echo ARIA_UO_LIVE"),
      cwd: typeof step.input?.cwd === "string" ? step.input.cwd : null,
      timeout_ms: Number.isInteger(step.timeout_ms) ? step.timeout_ms : 30000,
      policy: step.policy || {},
      metadata: { runner: V, executor_type: "device", idempotency_key: jobId },
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(`device_enqueue_${response.status}`);
  return body.job || body;
}

async function deviceExecute(missionId: string, step: any) {
  const jobId = jobIdFor(missionId, String(step.id));
  let current = await getExecutionJob(jobId);
  if (!(current.response.ok && current.body?.ok && current.body.job)) {
    await enqueueDeviceJob(missionId, step, jobId);
    current = await getExecutionJob(jobId);
  }
  const job = current.body?.job;
  if (!job) return { status: "waiting", executor_type: "device", operation: "shell.execute", job_id: jobId };
  const status = String(job.status || "");
  if (["succeeded", "failed", "timeout", "cancelled", "blocked"].includes(status)) {
    return {
      status,
      executor_type: "device",
      operation: "shell.execute",
      job_id: jobId,
      exit_code: job.exit_code,
      stdout: job.stdout,
      stderr: job.stderr,
      result: job.result,
    };
  }
  return { status: "waiting", executor_type: "device", operation: "shell.execute", job_id: jobId, job_status: status };
}

async function connectorExecute(missionId: string, step: any) {
  const connector = String(step.target.connector_id);
  const operation = String(step.operation);
  if (connector === "supabase" && operation === "health") {
    return { status: "succeeded", executor_type: "connector", connector_id: connector, operation, data: { ok: true } };
  }
  if (connector === "supabase" && operation === "mission_read") {
    return { status: "succeeded", executor_type: "connector", connector_id: connector, operation, data: await rpc("aria_mission_get", { p_mission_id: missionId }) };
  }
  if (connector === "cloudflare" && ["health", "worker_read", "deployment_read"].includes(operation)) {
    const response = await fetch("https://aria.robvg9.workers.dev/", { headers: { "user-agent": `${V}-connector-probe` } });
    if (!response.ok) throw new Error(`cloudflare_unavailable_${response.status}`);
    return { status: "succeeded", executor_type: "connector", connector_id: connector, operation, http_status: response.status };
  }
  throw new Error(`connector_operation_not_allowed:${connector}:${operation}`);
}

async function modelExecute(missionId: string, step: any, token: string | null) {
  const route = {
    status: "selected",
    provider_id: String(step.target.provider_id),
    account_id: String(step.target.account_id),
    model_id: String(step.target.model_id),
    capability: String(step.operation),
  };
  const authorization = step.authorization && typeof step.authorization === "object"
    ? step.authorization
    : { status: "approved", risk_class: step.risk || "READ", evidence_ref: `mission:${missionId}` };
  const response = await fetch(EXEC, {
    method: "POST",
    headers: downstreamHeaders(token),
    body: JSON.stringify({
      execution_version: "1",
      request_id: `${missionId}:${step.id}`,
      task_id: step.id,
      capability: String(step.operation),
      selected_route: route,
      authorization,
      input: step.input || {},
      policy: step.policy || {},
      metadata: { mission_id: missionId, step_id: step.id, executor_type: "model", runner: V },
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "succeeded") throw new Error(String(body?.error?.message || body?.error || `execution_${response.status}`));
  return { ...body, executor_type: "model", operation: step.operation, provider_id: route.provider_id, account_id: route.account_id, model_id: route.model_id };
}

async function agentExecute(missionId: string, step: any, token: string | null) {
  const agentId = String(step.target.agent_id);
  const response = await fetch(AGENT, {
    method: "POST",
    headers: downstreamHeaders(token),
    body: JSON.stringify({ mission_id: missionId, step_id: String(step.id), agent_id: agentId, operation: String(step.operation || "delegate"), risk: step.risk || "READ", policy: step.policy || {}, input: step.input || {} }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "succeeded") throw new Error(String(body?.error?.message || body?.error || `agent_execution_${response.status}`));
  return { ...body, executor_type: "agent", operation: "delegate", agent_id: body.agent_id || agentId };
}

async function executeStep(missionId: string, step: any, token: string | null) {
  validateStep(step);
  const type = executorType(step);
  if (type === "connector") return connectorExecute(missionId, step);
  if (type === "device") return deviceExecute(missionId, step);
  if (type === "model") return modelExecute(missionId, step, token);
  if (type === "agent") return agentExecute(missionId, step, token);
  throw new Error(`unknown_executor_type:${type}`);
}

function dependenciesSatisfied(step: any, completed: Set<string>) {
  return (Array.isArray(step?.depends_on) ? step.depends_on : []).every((dependency: any) => completed.has(String(dependency)));
}

function readyBatch(steps: any[], completed: Set<string>) {
  const ready = steps.filter((step) => !completed.has(String(step.id)) && dependenciesSatisfied(step, completed));
  if (ready.length > 1 && ready.slice(0, 2).every((step) => String(step.risk || "READ").toUpperCase() === "READ" && executorType(step) !== "device")) {
    return ready.slice(0, 2);
  }
  return ready.slice(0, 1);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await authorized(request))) return out({ error: "unauthorized" }, 401);

  const body = await request.json().catch(() => ({}));
  const requestedMissionId = typeof body?.mission_id === "string" ? body.mission_id : null;
  const token = tokenOf(request);

  try {
    await rpc("aria_autonomy_recover_stale_missions", { p_stale_after: "00:02:00" });
    const mission = requestedMissionId
      ? await rpc("aria_mission_claim_by_id_lease", { p_mission_id: requestedMissionId, p_worker_id: V, p_lease_for: LEASE_FOR })
      : await rpc("aria_mission_claim_next_lease", { p_worker_id: V, p_lease_for: LEASE_FOR });
    if (!mission) return out({ ok: true, status: "idle", runtime: V });

    const missionId = String(mission.mission_id);
    await renewLease(missionId);

    const recalled = await recall(String(mission.goal || ""), token);
    const cognitiveContext = {
      version: "cognitive-loop-v2",
      available: recalled.available,
      recall_count: recalled.results.length,
      memory_ids: recalled.results.map((item: any) => item.memory_id || item.id).filter(Boolean),
    };
    await emitEvent(missionId, "cognitive_recall_completed", cognitiveContext);

    const steps = Array.isArray(mission.checkpoint?.plan) && mission.checkpoint.plan.length
      ? mission.checkpoint.plan
      : await createPlan(String(mission.goal || ""), cognitiveContext, token);
    if (!Array.isArray(steps) || !steps.length) throw new Error("planner_empty_steps");
    for (const step of steps) validateStep(step);

    const completed = new Set<string>(Array.isArray(mission.checkpoint?.completed_steps) ? mission.checkpoint.completed_steps.map(String) : []);
    const attempts: Record<string, number> = mission.checkpoint?.attempts && typeof mission.checkpoint.attempts === "object" ? { ...mission.checkpoint.attempts } : {};
    const results: Record<string, unknown> = mission.checkpoint?.results && typeof mission.checkpoint.results === "object" ? { ...mission.checkpoint.results } : {};
    const pendingJobs: Record<string, unknown> = mission.checkpoint?.pending_jobs && typeof mission.checkpoint.pending_jobs === "object" ? { ...mission.checkpoint.pending_jobs } : {};

    await updateMission(missionId, {
      status: "running",
      total_steps: steps.length,
      current_step: completed.size,
      completed_steps: completed.size,
      next_action: completed.size < steps.length ? "next_ready_batch" : "verify_goal",
      checkpoint: {
        ...(mission.checkpoint || {}),
        cognitive_context: cognitiveContext,
        cognitive_loop: { version: "cognitive-loop-v2", recalled_before_planning: true },
        plan: steps,
        completed_steps: [...completed],
        attempts,
        results,
        pending_jobs: pendingJobs,
      },
    });

    while (completed.size < steps.length) {
      await renewLease(missionId);
      const batch = readyBatch(steps, completed);
      if (!batch.length) throw new Error("dependencies_unsatisfied");

      await emitEvent(missionId, "step_batch_started", {
        step_ids: batch.map((step) => String(step.id)),
        executor_types: batch.map(executorType),
        parallel: batch.length > 1,
      });

      const outcomes = await Promise.all(batch.map(async (step) => {
        const id = String(step.id);
        const nextAttempt = Number(attempts[id] || 0) + 1;
        attempts[id] = nextAttempt;
        await renewLease(missionId);
        await emitEvent(missionId, "step_started", { step_id: id, executor_type: executorType(step), operation: step.operation, attempt: nextAttempt });

        let result: any;
        try {
          result = await executeStep(missionId, step, token);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          result = { status: "failed", executor_type: executorType(step), operation: step.operation, error: { code: "executor_error", message: reason } };
        }

        const passed = verifyStep(step, result);
        if (passed) {
          results[id] = result;
          pendingJobs[id] = undefined;
          await emitEvent(missionId, "step_succeeded", { step_id: id, executor_type: result.executor_type, operation: result.operation || step.operation, agent_id: result.agent_id || null, attempt: nextAttempt, verified: true });
          return { step, result, passed: true };
        }

        if (String(result?.status) === "waiting" && executorType(step) === "device") {
          pendingJobs[id] = { job_id: result.job_id, status: result.job_status || "queued", attempt: nextAttempt };
          await emitEvent(missionId, "mission_waiting", { step_id: id, executor_type: "device", job_id: result.job_id, attempt: nextAttempt });
          return { step, result, waiting: true, passed: false };
        }

        await emitEvent(missionId, "step_failed", { step_id: id, executor_type: executorType(step), operation: step.operation, attempt: nextAttempt, reason: result?.error?.code || result?.status || "verification_failed" });
        return { step, result, passed: false, waiting: false };
      }));

      const waiting = outcomes.find((item) => item.waiting);
      for (const outcome of outcomes) if (outcome.passed) completed.add(String(outcome.step.id));

      const checkpoint = {
        ...(mission.checkpoint || {}),
        cognitive_context: cognitiveContext,
        plan: steps,
        completed_steps: [...completed],
        attempts,
        results,
        pending_jobs: Object.fromEntries(Object.entries(pendingJobs).filter(([, value]) => value !== undefined)),
        last_batch: batch.map((step) => String(step.id)),
        last_executor_types: batch.map(executorType),
      };

      if (waiting) {
        await updateMission(missionId, {
          status: "paused",
          current_step: completed.size,
          completed_steps: completed.size,
          next_action: `resume: pending device job ${String(waiting.step.id)}`,
          checkpoint: { ...checkpoint, recovery: { status: "waiting_for_async_executor" } },
          lease_owner: null,
          lease_until: null,
        });
        return out({ ok: true, status: "waiting", mission_id: missionId, runtime: V, completed_steps: completed.size, pending_step: String(waiting.step.id) });
      }

      const failures = outcomes.filter((item) => !item.passed);
      if (failures.length) {
        const retryableFailure = failures.find((item) => item.step.retryable !== false && RETRYABLE_STATUSES.has(String(item.result?.status || "failed")) && Number(attempts[String(item.step.id)]) < Math.min(3, Number(item.step.max_attempts || MAX_STEP_ATTEMPTS)));
        if (retryableFailure) {
          await updateMission(missionId, {
            status: "running",
            current_step: completed.size,
            completed_steps: completed.size,
            next_action: `retry: ${String(retryableFailure.step.id)}`,
            checkpoint: { ...checkpoint, recovery: { status: "retry_scheduled", failed_step_id: String(retryableFailure.step.id) } },
          });
          await emitEvent(missionId, "step_retrying", { step_id: String(retryableFailure.step.id), executor_type: executorType(retryableFailure.step), next_attempt: Number(attempts[String(retryableFailure.step.id)]) + 1 });
          continue;
        }

        await updateMission(missionId, {
          status: "failed",
          current_step: completed.size,
          completed_steps: completed.size,
          next_action: "recovery: scheduler may resume from checkpoint",
          checkpoint: { ...checkpoint, recovery: { status: "retry_exhausted", failed_step_ids: failures.map((item) => String(item.step.id)) } },
        });
        return out({ ok: false, status: "failed", mission_id: missionId, runtime: V, completed_steps: completed.size, failed_steps: failures.map((item) => String(item.step.id)) });
      }

      await updateMission(missionId, {
        status: "running",
        current_step: completed.size,
        completed_steps: completed.size,
        next_action: completed.size < steps.length ? "next_ready_batch" : "verify_goal",
        checkpoint: { ...checkpoint, recovery: { status: "clear" } },
      });
    }

    const finalVerified = steps.every((step) => completed.has(String(step.id)) && verifyStep(step, results[String(step.id)]));
    if (!finalVerified) throw new Error("final_verification_failed");

    const executorTypes = [...new Set(steps.map(executorType))];
    const agentIds = steps.filter((step) => executorType(step) === "agent").map((step) => String(step.target?.agent_id || "")).filter(Boolean);
    await emitEvent(missionId, "mission_verified", { steps: steps.length, completed_steps: completed.size, executor_types: executorTypes, agent_ids: agentIds, verified: true });

    await updateMission(missionId, {
      status: "succeeded",
      current_step: steps.length,
      total_steps: steps.length,
      completed_steps: steps.length,
      next_action: null,
      finished_at: new Date().toISOString(),
      lease_owner: null,
      lease_until: null,
      checkpoint: {
        ...(mission.checkpoint || {}),
        cognitive_context: cognitiveContext,
        plan: steps,
        completed_steps: [...completed],
        attempts,
        results,
        pending_jobs: {},
        model_execution_verified: steps.some((step) => executorType(step) === "model"),
        agent_execution_verified: steps.some((step) => executorType(step) === "agent"),
        universal_execution_verified: true,
        executor_types: executorTypes,
      },
    });

    return out({ ok: true, status: "succeeded", mission_id: missionId, runtime: V, executor_types: executorTypes, results: completed.size });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (requestedMissionId) {
      try {
        await updateMission(requestedMissionId, {
          status: "paused",
          next_action: "recovery: universal runner exception",
          last_stderr: reason,
          lease_owner: null,
          lease_until: null,
        });
      } catch {
        // Lease fencing intentionally rejects stale mutation.
      }
    }
    return out({ ok: false, status: "paused", mission_id: requestedMissionId, runtime: V });
  }
});
