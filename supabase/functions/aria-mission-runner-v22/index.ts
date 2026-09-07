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
const DEVICE_POLL_MS = 30000;
const DEVICE_POLL_INTERVAL_MS = 500;
const RETRYABLE_STATUSES = new Set(["failed", "timeout", "waiting", "blocked"]);

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false },
});

const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), {
  status: s,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

const eq = (a: string, b: string) => {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i += 1) d |= x[i] ^ y[i];
  return d === 0;
};

const tokenOf = (r: Request) => {
  const h = r.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : r.headers.get("x-aria-autonomy-token");
};

const headersFor = (token: string | null) => {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (token) h["x-aria-autonomy-token"] = token;
  else if (SECRET) h.authorization = `Bearer ${SECRET}`;
  return h;
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

async function auth(r: Request) {
  const token = tokenOf(r);
  if (token && SECRET && eq(token, SECRET)) return true;
  if (!token) return false;
  const { data, error } = await sb.rpc("aria_autonomy_cron_authorize", { p_token: token });
  return !error && data === true;
}

async function recall(goal: string, token: string | null) {
  try {
    const r = await fetch(MEMORY, {
      method: "POST",
      headers: headersFor(token),
      body: JSON.stringify({ action: "search", query: goal, limit: 8 }),
    });
    const b = await r.json().catch(() => null);
    return {
      available: r.ok && b?.ok === true,
      results: Array.isArray(b?.results) ? b.results : [],
    };
  } catch {
    return { available: false, results: [] };
  }
}

async function plan(goal: string, context: unknown, token: string | null) {
  const r = await fetch(PLANNER, {
    method: "POST",
    headers: headersFor(token),
    body: JSON.stringify({ goal, context }),
  });
  const b = await r.json().catch(() => null);
  if (!r.ok || !b?.ok || !Array.isArray(b.plan?.steps)) throw new Error(`planner_${r.status}`);
  return b.plan.steps;
}

async function renewLease(id: string, workerId = V) {
  const renewed = await rpc("aria_internal.aria_mission_renew_lease", {
    p_mission_id: id,
    p_worker_id: workerId,
    p_lease_for: LEASE_FOR,
  });
  if (!renewed) throw new Error("mission_lease_lost");
  return renewed;
}

async function emit(id: string, event_type: string, payload: unknown) {
  const result = await rpc("aria_mission_append_event_lease", {
    p_mission_id: id,
    p_worker_id: V,
    p_event: { event_type, payload },
  });
  if (!result) throw new Error("mission_event_lease_lost");
  return result;
}

async function update(id: string, patch: Record<string, unknown>) {
  const result = await rpc("aria_mission_update_lease", {
    p_mission_id: id,
    p_worker_id: V,
    p_mission: patch,
  });
  if (!result) throw new Error("mission_lease_lost");
  return result;
}

function targetType(step: any) {
  return String(step?.executor_type || step?.target?.type || "");
}

function validateStep(step: any) {
  const type = targetType(step);
  const operation = String(step?.operation || "");
  if (!["connector", "device", "model", "agent"].includes(type)) throw new Error(`unknown_executor_type:${type}`);
  if (!operation) throw new Error("operation_missing");
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

async function connectorExecute(id: string, step: any) {
  const connector = String(step.target.connector_id);
  const op = String(step.operation);
  if (connector === "supabase" && (op === "health" || op === "mission_read")) {
    return {
      status: "succeeded",
      executor_type: "connector",
      connector_id: connector,
      operation: op,
      data: op === "mission_read" ? await rpc("aria_mission_get", { p_mission_id: id }) : { ok: true },
    };
  }
  if (connector === "cloudflare" && ["health", "worker_read", "deployment_read"].includes(op)) {
    const r = await fetch("https://aria.robvg9.workers.dev/", { headers: { "user-agent": `${V}-connector-probe` } });
    if (!r.ok) throw new Error(`cloudflare_unavailable_${r.status}`);
    return { status: "succeeded", executor_type: "connector", connector_id: connector, operation: op, http_status: r.status };
  }
  throw new Error(`connector_operation_not_allowed:${connector}:${op}`);
}

async function readJob(jobId: string) {
  const r = await fetch(RUNTIME, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({ action: "get_job", job_id: jobId }),
  });
  const b = await r.json().catch(() => null);
  return { r, b };
}

async function deviceExecute(id: string, step: any, attempt: number) {
  const safeId = (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
  const jobId = `uo_${safeId(id)}_${safeId(String(step.id))}_a${attempt}`;
  const terminal = ["succeeded", "failed", "timeout", "cancelled", "blocked"];
  let current = await readJob(jobId);
  if (!(current.r.ok && current.b?.ok && current.b.job)) {
    const req = {
      action: "enqueue_device_job",
      job_id: jobId,
      mission_id: id,
      device_id: step.target.device_id,
      operation: "shell.execute",
      command: String(step.input?.command || "echo ARIA_UO_LIVE"),
      cwd: typeof step.input?.cwd === "string" ? step.input.cwd : null,
      timeout_ms: Number.isInteger(step.timeout_ms) ? step.timeout_ms : 30000,
      policy: step.policy || {},
      metadata: { runner: V, executor_type: "device", attempt, idempotency_key: jobId },
    };
    const enq = await fetch(RUNTIME, { method: "POST", headers: internalHeaders(), body: JSON.stringify(req) });
    const b = await enq.json().catch(() => null);
    if (!enq.ok || !b?.ok) throw new Error(`device_enqueue_${enq.status}`);
  }
  const deadline = Date.now() + DEVICE_POLL_MS;
  while (Date.now() < deadline) {
    await renewLease(id);
    current = await readJob(jobId);
    const job = current.b?.job;
    const status = String(job?.status || "");
    if (current.r.ok && current.b?.ok && job && terminal.includes(status)) {
      return {
        status,
        executor_type: "device",
        operation: "shell.execute",
        job_id: jobId,
        exit_code: job.exit_code,
        stdout: job.stdout,
        stderr: job.stderr,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, DEVICE_POLL_INTERVAL_MS));
  }
  return { status: "waiting", executor_type: "device", operation: "shell.execute", job_id: jobId };
}

async function modelExecute(id: string, step: any, token: string | null) {
  const route = {
    status: "selected",
    provider_id: String(step.target.provider_id),
    account_id: String(step.target.account_id),
    model_id: String(step.target.model_id),
    capability: String(step.operation),
  };
  const authorization = step.authorization && typeof step.authorization === "object"
    ? step.authorization
    : { status: "approved", risk_class: step.risk || "READ", evidence_ref: `mission:${id}` };
  const r = await fetch(EXEC, {
    method: "POST",
    headers: headersFor(token),
    body: JSON.stringify({
      execution_version: "1",
      request_id: `${id}:${step.id}`,
      task_id: step.id,
      capability: String(step.operation),
      selected_route: route,
      authorization,
      input: step.input || {},
      policy: step.policy || {},
      metadata: { mission_id: id, step_id: step.id, executor_type: "model", runner: V },
    }),
  });
  const b = await r.json().catch(() => null);
  if (!r.ok || b?.status !== "succeeded") throw new Error(String(b?.error?.message || b?.error || `execution_${r.status}`));
  return {
    ...b,
    executor_type: "model",
    operation: step.operation,
    provider_id: route.provider_id,
    account_id: route.account_id,
    model_id: route.model_id,
  };
}

async function agentExecute(id: string, step: any, token: string | null) {
  const agentId = String(step.target?.agent_id || step.agent_id || "");
  const r = await fetch(AGENT, {
    method: "POST",
    headers: headersFor(token),
    body: JSON.stringify({
      mission_id: id,
      step_id: String(step.id),
      agent_id: agentId,
      operation: String(step.operation || "delegate"),
      risk: step.risk || "READ",
      policy: step.policy || {},
      input: step.input || {},
    }),
  });
  const b = await r.json().catch(() => null);
  if (!r.ok || b?.status !== "succeeded") throw new Error(String(b?.error?.message || b?.error || `agent_execution_${r.status}`));
  return { ...b, executor_type: "agent", operation: "delegate", agent_id: b.agent_id || agentId };
}

async function executeStep(id: string, step: any, attempt: number, token: string | null) {
  validateStep(step);
  const type = targetType(step);
  if (type === "connector") return connectorExecute(id, step);
  if (type === "device") return deviceExecute(id, step, attempt);
  if (type === "model") return modelExecute(id, step, token);
  if (type === "agent") return agentExecute(id, step, token);
  throw new Error(`unknown_executor_type:${type}`);
}

function depsReady(step: any, done: Set<string>) {
  return (Array.isArray(step?.depends_on) ? step.depends_on : []).every((d: any) => done.has(String(d)));
}

function parallelSafe(step: any) {
  const t = targetType(step);
  const r = String(step?.risk || "READ").toUpperCase();
  return (t === "connector" || t === "model" || t === "agent") && r === "READ";
}

function batch(steps: any[], done: Set<string>) {
  const ready = steps.filter((s) => !done.has(String(s.id)) && depsReady(s, done));
  return ready.length > 1 && ready.slice(0, 2).every(parallelSafe) ? ready.slice(0, 2) : ready.slice(0, 1);
}

Deno.serve(async (r) => {
  if (r.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await auth(r))) return out({ error: "unauthorized" }, 401);

  const body = await r.json().catch(() => ({}));
  const token = tokenOf(r);
  const requestedMissionId = typeof body?.mission_id === "string" ? body.mission_id : null;

  try {
    await rpc("aria_autonomy_recover_stale_missions", { p_stale_after: "00:02:00" });

    const mission = requestedMissionId
      ? await rpc("aria_mission_claim_by_id_lease", {
          p_mission_id: requestedMissionId,
          p_worker_id: V,
          p_lease_for: LEASE_FOR,
        })
      : await rpc("aria_mission_claim_next_lease", {
          p_worker_id: V,
          p_lease_for: LEASE_FOR,
        });

    if (!mission) return out({ ok: true, status: "idle", runtime: V });

    const id = String(mission.mission_id);
    const goal = String(mission.goal || "");
    await renewLease(id);

    const recalled = await recall(goal, token);
    const context = {
      version: "cognitive-loop-v2",
      available: recalled.available,
      recall_count: recalled.results.length,
      memory_ids: recalled.results.map((x: any) => x.memory_id || x.id).filter(Boolean),
    };
    await emit(id, "cognitive_recall_completed", context);

    const steps = Array.isArray(mission.checkpoint?.plan) && mission.checkpoint.plan.length
      ? mission.checkpoint.plan
      : await plan(goal, context, token);
    if (!Array.isArray(steps) || !steps.length) throw new Error("planner_empty_steps");
    for (const step of steps) validateStep(step);

    const done = new Set<string>(Array.isArray(mission.checkpoint?.completed_steps)
      ? mission.checkpoint.completed_steps.map(String)
      : []);
    const attempts: Record<string, number> = mission.checkpoint?.attempts && typeof mission.checkpoint.attempts === "object"
      ? { ...mission.checkpoint.attempts }
      : {};
    const results: Record<string, unknown> = mission.checkpoint?.results && typeof mission.checkpoint.results === "object"
      ? { ...mission.checkpoint.results }
      : {};

    let checkpoint: Record<string, unknown> = {
      ...(mission.checkpoint || {}),
      cognitive_context: context,
      cognitive_loop: { version: "cognitive-loop-v2", recalled_before_planning: true },
      plan: steps,
      completed_steps: [...done],
      attempts,
      results,
    };

    await update(id, {
      status: "running",
      total_steps: steps.length,
      current_step: done.size,
      completed_steps: done.size,
      next_action: done.size < steps.length ? "next_ready_batch" : "verify_goal",
      checkpoint,
    });

    while (done.size < steps.length) {
      await renewLease(id);
      const b = batch(steps, done);
      if (!b.length) throw new Error("dependencies_unsatisfied");

      await emit(id, "step_batch_started", {
        step_ids: b.map((s: any) => String(s.id)),
        executor_types: b.map((s: any) => targetType(s)),
        parallel: b.length > 1,
      });

      const batchResults = await Promise.all(b.map(async (step: any) => {
        const sid = String(step.id);
        const maxAttempts = Math.min(
          Math.max(1, Number.isInteger(step.max_attempts) ? step.max_attempts : MAX_STEP_ATTEMPTS),
          3,
        );

        let result: any = null;
        let passed = false;
        let finalAttempt = Number(attempts[sid] || 0);

        for (let localAttempt = 1; localAttempt <= maxAttempts; localAttempt += 1) {
          finalAttempt += 1;
          attempts[sid] = finalAttempt;
          await renewLease(id);
          await emit(id, "step_started", {
            step_id: sid,
            operation: step.operation,
            executor_type: targetType(step),
            attempt: finalAttempt,
          });

          try {
            result = await executeStep(id, step, finalAttempt, token);
            passed = verifyStep(step, result);
            if (passed) {
              results[sid] = result;
              await emit(id, "step_succeeded", {
                step_id: sid,
                executor_type: result.executor_type,
                operation: result.operation || step.operation,
                agent_id: result.agent_id || null,
                attempt: finalAttempt,
                verified: true,
              });
              break;
            }
            await emit(id, "step_failed", {
              step_id: sid,
              executor_type: targetType(step),
              operation: step.operation,
              attempt: finalAttempt,
              status: result?.status || "verification_failed",
              reason: "verification_failed",
            });
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            result = {
              status: "failed",
              executor_type: targetType(step),
              operation: step.operation,
              error: { code: "executor_error", message: reason },
            };
            passed = false;
            await emit(id, "step_failed", {
              step_id: sid,
              executor_type: targetType(step),
              operation: step.operation,
              attempt: finalAttempt,
              reason,
              agent_id: step.target?.agent_id || null,
            });
          }

          const retryable = step.retryable !== false && RETRYABLE_STATUSES.has(String(result?.status || "failed"));
          if (!passed && retryable && localAttempt < maxAttempts) {
            await emit(id, "step_retrying", {
              step_id: sid,
              executor_type: targetType(step),
              previous_attempt: finalAttempt,
              next_attempt: finalAttempt + 1,
              max_attempts: maxAttempts,
              reason: result?.error?.code || result?.status || "verification_failed",
            });
          }
        }

        return { step, result, passed, attempt: finalAttempt };
      }));

      const failures = batchResults.filter((x: any) => !x.passed);
      for (const x of batchResults) if (x.passed) done.add(String(x.step.id));

      checkpoint = {
        ...checkpoint,
        completed_steps: [...done],
        attempts,
        results,
        last_batch: b.map((s: any) => String(s.id)),
        last_executor_types: b.map((s: any) => targetType(s)),
      };

      if (failures.length) {
        checkpoint = {
          ...checkpoint,
          recovery: {
            status: "retry_exhausted",
            failed_step_ids: failures.map((x: any) => String(x.step.id)),
            attempted_at: new Date().toISOString(),
          },
        };
        await update(id, {
          status: "failed",
          current_step: done.size,
          completed_steps: done.size,
          next_action: "recovery: scheduler may resume from checkpoint",
          checkpoint,
        });
        return out({
          ok: false,
          status: "failed",
          mission_id: id,
          runtime: V,
          completed_steps: done.size,
          failed_steps: failures.map((x: any) => String(x.step.id)),
        }, 200);
      }

      checkpoint = {
        ...checkpoint,
        recovery: { status: "clear" },
      };
      await update(id, {
        current_step: done.size,
        completed_steps: done.size,
        next_action: done.size < steps.length ? "next_ready_batch" : "verify_goal",
        checkpoint,
      });
    }

    const finalVerification = steps.every((step: any) => done.has(String(step.id)) && verifyStep(step, results[String(step.id)]));
    if (!finalVerification) throw new Error("final_verification_failed");

    const executorTypes = [...new Set(steps.map((s: any) => targetType(s)))];
    const agentIds = steps.filter((s: any) => targetType(s) === "agent")
      .map((s: any) => String(s.target?.agent_id || s.agent_id || ""))
      .filter(Boolean);

    await emit(id, "mission_verified", {
      steps: steps.length,
      completed_steps: done.size,
      executor_types: executorTypes,
      agent_ids: agentIds,
      verified: true,
    });

    await update(id, {
      status: "succeeded",
      current_step: steps.length,
      total_steps: steps.length,
      completed_steps: steps.length,
      next_action: null,
      lease_owner: null,
      lease_until: null,
      finished_at: new Date().toISOString(),
      checkpoint: {
        ...checkpoint,
        completed_steps: [...done],
        attempts,
        results,
        model_execution_verified: steps.some((s: any) => targetType(s) === "model"),
        agent_execution_verified: steps.some((s: any) => targetType(s) === "agent"),
        universal_execution_verified: true,
        executor_types: executorTypes,
      },
    });

    return out({
      ok: true,
      status: "succeeded",
      mission_id: id,
      runtime: V,
      executor_types: executorTypes,
      results: done.size,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    const id = requestedMissionId;
    if (id) {
      try {
        await update(id, {
          status: "paused",
          next_action: "recovery: universal runner exception",
          last_stderr: reason,
          lease_owner: null,
          lease_until: null,
        });
      } catch {
        // Lease fencing intentionally prevents a stale worker from mutating mission state.
      }
    }
    return out({ ok: false, status: "paused", mission_id: id, runtime: V }, 200);
  }
});
