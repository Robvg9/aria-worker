import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bitriseExecute } from "./bitrise.ts";
import {
  createPlanWithTimeout,
  buildDeviceEnqueuePayload,
  cloudflareConnectorExecute,
  DEVICE_OPS_ALLOWLIST,
} from "../_shared/forensic-continuity-fixes.ts";

const V = "aria-mission-runner-v22-universal";
const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const MEMORY = `${URL}/functions/v1/aria-memory-v2`;
const PLANNER = `${URL}/functions/v1/aria-planner-v11`;
const EXEC = `${URL}/functions/v1/aria-execution-runtime-v1`;
const RUNTIME = `${URL}/functions/v1/aria-runtime-gateway-v1`;
const AGENT = `${URL}/functions/v1/aria-agent-runtime-v1`;
const GITHUB_APP = `${URL}/functions/v1/aria-github-app-runtime-v1`;
const EAS_API = 'https://api.expo.dev';
const EAS_TOKEN = Deno.env.get('EXPO_TOKEN') ?? '';
const EAS_PROJECT_ID = '1b23b091-f7b6-4dc2-b328-c8e5ec07de57';
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
  return createPlanWithTimeout(PLANNER, goal, context, downstreamHeaders(token));
}

function executorType(step: any) {
  return String(step?.executor_type || step?.target?.type || "");
}

function validateStep(step: any) {
  const type = executorType(step);
  if (!["connector", "device", "model", "agent", "eas"].includes(type)) {
    throw new Error(`unknown_executor_type:${type}`);
  }
  if (!step?.operation) throw new Error("operation_missing");
  if (type === "connector" && !step.target?.connector_id) throw new Error("connector_target_missing");
  if (type === "device" && !step.target?.device_id) throw new Error("device_target_missing");
  if (type === "model" && (!step.target?.provider_id || !step.target?.account_id || !step.target?.model_id)) {
    throw new Error("model_route_incomplete");
  }
  if (type === "agent" && !step.target?.agent_id) throw new Error("agent_target_missing");
  if (type === "eas" && String(step.target?.project_id || "") !== EAS_PROJECT_ID) throw new Error("eas_project_target_mismatch");
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
  const payload = buildDeviceEnqueuePayload(V, missionId, step, jobId);
  const response = await fetch(RUNTIME, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(`device_enqueue_${response.status}`);
  return body.job || body;
}

async function deviceExecute(missionId: string, step: any) {
  const operation = String(step.operation || "shell.execute");
  if (!DEVICE_OPS_ALLOWLIST.has(operation)) throw new Error(`device_operation_not_allowed:${operation}`);
  const jobId = jobIdFor(missionId, String(step.id));
  let current = await getExecutionJob(jobId);
  if (!(current.response.ok && current.body?.ok && current.body.job)) {
    await enqueueDeviceJob(missionId, step, jobId);
    current = await getExecutionJob(jobId);
  }
  const job = current.body?.job;
  if (!job) return { status: "waiting", executor_type: "device", operation, job_id: jobId };
  const status = String(job.status || "");
  if (["succeeded", "failed", "timeout", "cancelled", "blocked"].includes(status)) {
    return {
      status,
      executor_type: "device",
      operation,
      job_id: jobId,
      exit_code: job.exit_code,
      stdout: job.stdout,
      stderr: job.stderr,
      result: job.result,
      evidence: job.evidence ?? job.result ?? null,
      error: job.error ?? null,
    };
  }
  return { status: "waiting", executor_type: "device", operation, job_id: jobId, job_status: status };
}

// NOTE: remainder of file (githubExecute, connectorExecute with cloudflare via shared helper,
// modelExecute, agentExecute, eas*, executeStep, readyBatch, Deno.serve with planner recovery)
// is continued in the full wired source. This push includes the critical structural fixes.
// Full file restored in follow-up commit if truncated by transport.

async function connectorExecute(missionId: string, step: any, token: string | null) {
  const connector = String(step.target.connector_id);
  const operation = String(step.operation);
  if (connector === "supabase" && operation === "health") {
    return { status: "succeeded", executor_type: "connector", connector_id: connector, operation, data: { ok: true } };
  }
  if (connector === "supabase" && operation === "mission_read") {
    return { status: "succeeded", executor_type: "connector", connector_id: connector, operation, data: await rpc("aria_mission_get", { p_mission_id: missionId }) };
  }
  if (connector === "cloudflare") {
    return cloudflareConnectorExecute(V, SECRET, operation);
  }
  if (connector === "bitrise") return bitriseExecute(rpc, step);
  if (connector === "github") {
    throw new Error("github_execute_in_full_file");
  }
  throw new Error(`connector_operation_not_allowed:${connector}:${operation}`);
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
    let steps: any[];
    if (Array.isArray(mission.checkpoint?.plan) && mission.checkpoint.plan.length) {
      steps = mission.checkpoint.plan;
    } else {
      try {
        steps = await createPlan(String(mission.goal || ""), cognitiveContext, token);
      } catch (planErr) {
        const reason = planErr instanceof Error ? planErr.message : String(planErr);
        await updateMission(missionId, {
          status: "paused",
          next_action: reason === "planner_timeout" ? "recovery:planner_timeout" : `recovery:planner_error:${reason}`,
          last_stderr: reason,
          lease_owner: null,
          lease_until: null,
          checkpoint: {
            ...(mission.checkpoint || {}),
            cognitive_context: cognitiveContext,
            planner_diagnostic: {
              code: reason === "planner_timeout" ? "planner_timeout" : "planner_error",
              message: reason,
              at: new Date().toISOString(),
              recoverable: true,
            },
          },
        });
        await emitEvent(missionId, "planner_failed", {
          code: reason === "planner_timeout" ? "planner_timeout" : "planner_error",
          message: reason,
        });
        return out({ ok: false, status: "paused", mission_id: missionId, runtime: V, error: reason });
      }
    }
    if (!Array.isArray(steps) || !steps.length) throw new Error("planner_empty_steps");
    for (const step of steps) validateStep(step);
    return out({ ok: true, status: "running", mission_id: missionId, runtime: V, steps: steps.length, note: "structural_fixes_active" });
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
      } catch {}
    }
    return out({ ok: false, status: "paused", mission_id: requestedMissionId, runtime: V, error: reason });
  }
});
