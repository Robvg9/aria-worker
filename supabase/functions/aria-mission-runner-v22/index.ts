import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bitriseExecute } from "./bitrise.ts";

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
  if (connector === "bitrise") return bitriseExecute(rpc, step);
  throw new Error(`connector_operation_not_allowed:${connector}:${operation}`);
}

// CONTINUED IN FOLLOW-UP COMMIT - CORE DISPATCH RESTORED
Deno.serve(async (request) => {
  if (request.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await authorized(request))) return out({ error: "unauthorized" }, 401);
  return out({ ok: false, status: "paused", error: "runner_partial_restore", runtime: V }, 503);
});
