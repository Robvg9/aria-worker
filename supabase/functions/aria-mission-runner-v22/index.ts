import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bitriseExecute } from "./bitrise.ts";
import { createPlanWithTimeout, buildDeviceEnqueuePayload, cloudflareConnectorExecute, DEVICE_OPS_ALLOWLIST } from "../_shared/forensic-continuity-fixes.ts";

const V = "aria-mission-runner-v22-universal";
const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const MEMORY = `${URL}/functions/v1/aria-memory-v2`;
const CANONICAL = `${URL}/functions/v1/aria-canonical-runtime-v1`;
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

type AuthContext = {
  kind: "authorization" | "autonomy-token" | "none";
  token: string | null;
};

const authContextOf = (request: Request): AuthContext => {
  const auth = request.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) return { kind: "authorization", token: auth.slice(7) };
  const autonomy = request.headers.get("x-aria-autonomy-token");
  if (autonomy) return { kind: "autonomy-token", token: autonomy };
  return { kind: "none", token: null };
};

const tokenOf = (request: Request) => authContextOf(request).token;

const downstreamHeaders = (auth: AuthContext) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.kind === "authorization" && auth.token) headers.authorization = `Bearer ${auth.token}`;
  else if (auth.kind === "autonomy-token" && auth.token) headers["x-aria-autonomy-token"] = auth.token;
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
  try {
    const event = await rpc("aria_mission_append_event_lease", {
      p_mission_id: missionId,
      p_worker_id: V,
      p_event: { event_type, payload },
    });
    if (!event) throw new Error("mission_event_lease_lost");
    return { persisted: true, event };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (/statement timeout|canceling statement|query canceled|timeout/i.test(reason)) {
      return {
        persisted: false,
        deferred: true,
        event_type,
        reason,
      };
    }
    throw error;
  }
}

async function recall(goal: string, auth: AuthContext) {
  try {
    const response = await fetch(MEMORY, {
      method: "POST",
      headers: downstreamHeaders(auth),
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

async function createPlan(goal: string, context: unknown, auth: AuthContext) {
  return createPlanWithTimeout(PLANNER, goal, context, downstreamHeaders(auth));
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

function explicitlyUnverified(step: any, result: any) {
  const verificationStatuses = [
    result?.verification_status,
    result?.repair?.verification_status,
    result?.response?.verification_status,
  ].map((value) => String(value ?? "").toLowerCase());

  if ([result?.verified, result?.repair?.verified, result?.response?.verified].some((value) => value === false)) {
    return true;
  }

  if (verificationStatuses.some((value) => ["unverified", "failed", "error", "none"].includes(value))) {
    return true;
  }

  const mutationRequired = step?.policy?.mutating_operation_required === true
    || String(step?.risk ?? "").toUpperCase().includes("WRITE");
  if (mutationRequired && result?.repair?.changed === false && result?.repair?.verified !== true) {
    return true;
  }

  if (mutationRequired && /NO_CHANGE_REQUIRED/i.test(String(result?.repair?.summary ?? result?.response?.content ?? "")) && result?.repair?.verified !== true) {
    return true;
  }

  return false;
}

function verifyStep(step: any, result: any) {
  if (!(result?.status === "succeeded" || result?.ok === true)) return false;
  if (result?.error) return false;
  if (explicitlyUnverified(step, result)) return false;
  const verify = step?.verify && typeof step.verify === "object" ? step.verify : {};
  if (verify.expected_exit_code !== undefined && Number(result?.exit_code) !== Number(verify.expected_exit_code)) return false;
  if (typeof verify.stdout_contains === "string" && !String(result?.stdout ?? "").includes(verify.stdout_contains)) return false;
  if (typeof verify.stderr_contains === "string" && !String(result?.stderr ?? "").includes(verify.stderr_contains)) return false;
  if (typeof verify.response_content_equals === "string" && String(result?.response?.content ?? result?.response?.output_text ?? "") !== verify.response_content_equals) return false;
  if (typeof verify.response_content_contains === "string" && !String(result?.response?.content ?? result?.response?.output_text ?? "").includes(verify.response_content_contains)) return false;
  return true;
}

function realHumanGate(mission: any) {
  const gate = mission?.metadata?.human_gate;
  if (!gate || typeof gate !== "object") return null;
  if (gate.enabled !== true) return null;
  const method = String(gate.method || "").trim();
  if (!method) return null;
  return {
    method,
    instructions: String(gate.instructions || "Confirmar manualmente la verificación requerida."),
    reason: String(gate.reason || "Verificación humana requerida antes del cierre."),
  };
}

function humanGateCompleted(mission: any) {
  const gate = mission?.checkpoint?.human_gate;
  return gate?.status === "completed" && gate?.verified === true;
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

async function githubExecute(step: any, token: string | null) {
  const operation = String(step.operation || "");
  const input = step.input && typeof step.input === "object" ? step.input : {};
  const readOps = new Set(["repo_read", "file_read"]);
  const writeOps = new Set(["create_branch", "file_write", "open_pr"]);
  if (!readOps.has(operation) && !writeOps.has(operation)) {
    throw new Error(`github_operation_not_allowed:${operation}`);
  }
  if (writeOps.has(operation)) {
    if (String(step.risk || "READ").toUpperCase() !== "LOW_RISK_WRITE") throw new Error("github_write_risk_not_allowed");
    if (step.authorization?.status !== "approved") throw new Error("github_write_authorization_required");
  }
  if (!token && !SECRET) throw new Error("github_runtime_auth_unavailable");
  const response = await fetch(GITHUB_APP, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      operation,
      owner: input.owner || step.target?.owner || "Robvg9",
      repo: input.repo || step.target?.repo || "battlecruiser",
      branch: input.branch || step.target?.branch || "main",
      base: input.base || "main",
      path: input.path,
      content: input.content,
      message: input.message,
      title: input.title,
      body: input.body,
      risk_level: String(step.risk || "READ").toLowerCase().includes("low") ? "low" : "high",
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error(String(result?.error || `github_http_${response.status}`));
  return { status: "succeeded", executor_type: "connector", connector_id: "github", operation, data: result.data };
}

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
  if (connector === "github") return githubExecute(step, token);
  throw new Error(`connector_operation_not_allowed:${connector}:${operation}`);
}

async function verifiedModelFallbackRoutes(original: any, operation: string) {
  if (operation !== "text_generation") return [];
  if (String(original?.provider_id || "") !== "openrouter") return [];
  const risk = String(original?.risk || "READ").toUpperCase();
  if (risk !== "READ") return [];

  // Cross-provider fallback is intentionally READ-only. The primary route remains
  // unchanged; only already-verified, enabled routes registered in ARIA may be used.
  const [modelsRes, capsRes, accountsRes] = await Promise.all([
    sb.schema("aria_internal").from("model_registry")
      .select("model_id,provider_id,status,enabled")
      .in("provider_id", ["openrouter", "google"]),
    sb.schema("aria_internal").from("capability_matrix")
      .select("model_id,status,verified_at")
      .eq("capability_id","text_generation")
      .eq("status","verified"),
    sb.schema("aria_internal").from("account_registry")
      .select("account_id,provider_id,status,enabled,models")
      .in("provider_id", ["openrouter", "google"]),
  ]);
  if (modelsRes.error || capsRes.error || accountsRes.error) return [];

  const caps = new Map((capsRes.data || []).map((x:any) => [String(x.model_id), x]));
  const accounts = (accountsRes.data || []).filter((x:any) =>
    x.enabled && ["available","active"].includes(String(x.status))
  );

  const out:any[] = [];
  for (const model of modelsRes.data || []) {
    const modelId = String(model.model_id || "");
    const providerId = String(model.provider_id || "");
    const cap = caps.get(modelId);
    if (!model.enabled || String(model.status) !== "available" || !cap) continue;

    // Preserve the existing free-only contract for OpenRouter. Google direct
    // routes are selected only from the explicitly registered Gemini-free account.
    if (providerId === "openrouter" && !modelId.endsWith(":free")) continue;
    if (providerId === "google" && !modelId.endsWith("-direct")) continue;

    const account = accounts.find((a:any) =>
      a.provider_id === providerId &&
      Array.isArray(a.models) &&
      a.models.includes(modelId)
    );
    if (!account) continue;

    out.push({
      status: "selected",
      provider_id: providerId,
      account_id: String(account.account_id),
      model_id: modelId,
      capability: operation,
      _verified_at: cap.verified_at || null,
      // Prefer a different provider before spending remaining same-provider
      // fallback attempts when the primary provider is exhausted.
      _provider_priority: providerId === "google" ? 0 : 1,
    });
  }

  out.sort((a:any,b:any) =>
    Number(a._provider_priority ?? 9) - Number(b._provider_priority ?? 9) ||
    String(b._verified_at || "").localeCompare(String(a._verified_at || "")) ||
    String(a.model_id).localeCompare(String(b.model_id))
  );

  return out.map(({_verified_at,_provider_priority,...route}:any) => route);
}

async function modelExecute(missionId: string, step: any, auth: AuthContext) {
  const primary = {
    status: "selected",
    provider_id: String(step.target.provider_id),
    account_id: String(step.target.account_id),
    model_id: String(step.target.model_id),
    capability: String(step.operation),
  };
  const fallbackRoutes = await verifiedModelFallbackRoutes({ ...primary, risk: step.risk }, String(step.operation));
  const routes = [primary, ...fallbackRoutes.filter((r:any) => r.provider_id !== primary.provider_id || r.account_id !== primary.account_id || r.model_id !== primary.model_id)].slice(0,4);
  const failures:any[] = [];
  const authorization = step.authorization && typeof step.authorization === "object"
    ? step.authorization
    : { status: "approved", risk_class: step.risk || "READ", evidence_ref: `mission:${missionId}` };

  for (const route of routes) {
    const response = await fetch(EXEC, {
      method: "POST",
      headers: downstreamHeaders(auth),
      body: JSON.stringify({
        execution_version: "1",
        request_id: `${missionId}:${step.id}:${crypto.randomUUID()}`,
        task_id: step.id,
        capability: String(step.operation),
        selected_route: route,
        authorization,
        input: step.input || {},
        policy: step.policy || {},
        metadata: { mission_id: missionId, step_id: step.id, executor_type: "model", runner: V, fallback_route: route.model_id !== primary.model_id },
      }),
    });
    const body = await response.json().catch(() => null);
    if (response.ok && body?.status === "succeeded") {
      return { ...body, executor_type: "model", operation: step.operation, provider_id: route.provider_id, account_id: route.account_id, model_id: route.model_id, model_fallback_used: route.model_id !== primary.model_id, model_fallback_attempts: failures.length };
    }
    const err = body?.error && typeof body.error === "object" ? body.error : { message: String(body?.error || body?.reason || `execution_${response.status}`) };
    failures.push({
      provider_id: route.provider_id,
      account_id: route.account_id,
      model_id: route.model_id,
      http_status: response.status,
      code: String(err.code || "execution_failed"),
      message: String(err.message || "model execution failed"),
      provider_status: err.provider_status ?? null,
    });
  }

  const last = failures[failures.length - 1] || { code: "execution_failed", message: "model execution failed" };
  return {
    status: "failed",
    executor_type: "model",
    operation: step.operation,
    provider_id: primary.provider_id,
    account_id: primary.account_id,
    model_id: primary.model_id,
    error: {
      code: "model_execution_failed",
      message: String(last.message || "model execution failed"),
      provider_status: last.provider_status ?? null,
      attempts: failures.length,
    },
    model_execution_failures: failures.map((x:any) => ({ provider_id:x.provider_id, model_id:x.model_id, http_status:x.http_status, code:x.code, message:x.message, provider_status:x.provider_status })),
  };
}

async function agentExecute(missionId: string, step: any, auth: AuthContext) {
  const agentId = String(step.target.agent_id);
  const response = await fetch(AGENT, {
    method: "POST",
    headers: downstreamHeaders(auth),
    body: JSON.stringify({ mission_id: missionId, step_id: String(step.id), agent_id: agentId, operation: String(step.operation || "delegate"), risk: step.risk || "READ", policy: step.policy || {}, input: step.input || {} }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.status !== "succeeded") throw new Error(String(body?.error?.message || body?.error || `agent_execution_${response.status}`));
  return { ...body, executor_type: "agent", operation: "delegate", agent_id: body.agent_id || agentId };
}

async function easGraphQL(query: string, variables: Record<string, unknown> = {}) {
  if (!EAS_TOKEN) throw new Error("eas_credential_unavailable");
  const response = await fetch(EAS_API + "/graphql", {
    method: "POST",
    headers: { authorization: "Bearer " + EAS_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 12000) }; }
  if (!response.ok || body?.errors?.length) throw new Error("eas_graphql_" + response.status);
  return body;
}

async function easRest(path: string, init: RequestInit = {}) {
  if (!EAS_TOKEN) throw new Error("eas_credential_unavailable");
  const response = await fetch(EAS_API + path, {
    ...init,
    headers: { authorization: "Bearer " + EAS_TOKEN, "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 12000) }; }
  if (!response.ok) throw new Error("eas_http_" + response.status);
  return body;
}

async function easExecute(step: any) {
  const operation = String(step.operation || "");
  const projectId = String(step.target?.project_id || "");
  if (projectId !== EAS_PROJECT_ID) throw new Error("eas_project_target_mismatch");
  if (operation === "eas.connection_status") return { data: await easGraphQL("query App($appId: String!) { app { byId(appId: $appId) { id name slug ownerAccount { id name } } } }", { appId: projectId }), status: "succeeded", executor_type: "eas", operation, project_id: projectId };
  if (operation === "eas.workflow_definitions") return { data: await easGraphQL("query Workflows($appId: String!) { app { byId(appId: $appId) { id workflows { id name fileName createdAt updatedAt } } } }", { appId: projectId }), status: "succeeded", executor_type: "eas", operation, project_id: projectId };
  if (operation === "eas.workflow_list") { const limit = Math.max(1, Math.min(Number(step.input?.limit) || 20, 100)); const status = typeof step.input?.status === "string" ? step.input.status : null; return { data: await easGraphQL("query Runs($appId: String!, $status: WorkflowRunStatus, $limit: Int!) { app { byId(appId: $appId) { id workflowRunsPaginated(first: $limit, filter: { status: $status }) { edges { node { id status gitCommitHash requestedGitRef createdAt updatedAt errors { title message } workflow { id name fileName } } } } } } }", { appId: projectId, status, limit }), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }
  if (operation === "eas.workflow_info") { const runId = String(step.input?.runId || ""); if (!runId) throw new Error("eas_run_id_required"); return { data: await easRest("/v2/workflows/runs/" + encodeURIComponent(runId)), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }
  if (operation === "eas.workflow_dispatch") { const confirm = step.confirm === true || step.input?.confirm === true; if (!confirm) return { status: "blocked", executor_type: "eas", operation, project_id: projectId, error: { code: "confirmation_required", message: "workflow dispatch requires confirm=true" } }; const gitRef = String(step.input?.gitRef || ""); const fileName = String(step.input?.fileName || ""); if (!gitRef || !fileName) throw new Error("eas_dispatch_input_missing"); return { data: await easRest("/v2/workflows/dispatch", { method: "POST", body: JSON.stringify({ appId: projectId, gitRef, fileName, ...(step.input?.inputs ? { inputs: step.input.inputs } : {}) }) }), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }
  if (operation === "eas.build_list") { const limit = Math.max(1, Math.min(Number(step.input?.limit) || 20, 50)); const offset = Math.max(0, Number(step.input?.offset) || 0); return { data: await easGraphQL("query Builds($appId: String!, $offset: Int!, $limit: Int!) { app { byId(appId: $appId) { id builds(offset: $offset, limit: $limit) { id status platform error { errorCode message docsUrl } artifacts { buildUrl applicationArchiveUrl buildArtifactsUrl } logFiles buildProfile appIdentifier sdkVersion appVersion appBuildVersion gitCommitHash gitCommitMessage createdAt updatedAt completedAt } } } }", { appId: projectId, offset, limit }), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }
  if (operation === "eas.build_info") { const buildId = String(step.input?.buildId || ""); if (!buildId) throw new Error("eas_build_id_required"); return { data: await easGraphQL("query Build($buildId: ID!) { builds { byId(buildId: $buildId) { id status platform error { errorCode message docsUrl } artifacts { buildUrl applicationArchiveUrl buildArtifactsUrl } logFiles buildProfile appIdentifier sdkVersion appVersion appBuildVersion gitCommitHash gitCommitMessage createdAt updatedAt completedAt } } }", { buildId }), status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }
  if (operation === "eas.build_logs") { const buildId = String(step.input?.buildId || ""); if (!buildId) throw new Error("eas_build_id_required"); const info = await easGraphQL("query Build($buildId: ID!) { builds { byId(buildId: $buildId) { id status logFiles } } }", { buildId }); const build = info?.data?.builds?.byId || null; const logs = []; for (const url of Array.isArray(build?.logFiles) ? build.logFiles.slice(0, 10) : []) { if (typeof url !== "string") continue; const response = await fetch(url); logs.push({ url, ok: response.ok, status: response.status, content: (await response.text()).slice(-50000) }); } return { build, logs, status: "succeeded", executor_type: "eas", operation, project_id: projectId }; }
  throw new Error("eas_operation_not_supported:" + operation);
}

async function executeStep(missionId: string, step: any, auth: AuthContext) {
  validateStep(step);
  const type = executorType(step);
  if (type === "connector") return connectorExecute(missionId, step, auth.token);
  if (type === "device") return deviceExecute(missionId, step);
  if (type === "model") return modelExecute(missionId, step, auth);
  if (type === "agent") return agentExecute(missionId, step, auth);
  if (type === "eas") return easExecute(step);
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

async function chainNextMeditationMission(depth: number) {
  if (depth >= 8) return { status: "chain_limit_reached", depth };
  const next = await rpc("aria_mission_claim_next_lease", { p_worker_id: V, p_lease_for: LEASE_FOR });
  const nextMissionId = next?.mission_id ? String(next.mission_id) : null;
  if (!nextMissionId) return { status: "idle", depth };
  try {
    const response = await fetch(CANONICAL, {
      method: "POST",
      headers: { ...internalHeaders(), "x-aria-trigger": "meditation-ia" },
      body: JSON.stringify({ mission_id: nextMissionId, chain_depth: depth + 1 })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.ok !== true) throw new Error(String(payload?.error || payload?.status || `chained_runtime_http_${response.status}`));
    return { status: "chained", mission_id: nextMissionId, child_status: payload.status || null, child_runtime: payload.runtime || null, child_chain: payload.chained || null, depth: depth + 1 };
  } catch (error) {
    // Do not requeue here: the child may already have been accepted/executing.
    // Leaving the lease fenced lets stale-mission recovery decide safely without duplicating side effects.
    return {
      status: "chain_invoke_failed",
      mission_id: nextMissionId,
      error: error instanceof Error ? error.message : String(error),
      depth,
      recovery: "lease_preserved_for_stale_recovery",
    };
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return out({ error: "method_not_allowed" }, 405);
  if (!(await authorized(request))) return out({ error: "unauthorized" }, 401);

  const body = await request.json().catch(() => ({}));
  const requestedMissionId = typeof body?.mission_id === "string" ? body.mission_id : null;
  const chainDepth = Math.max(0, Math.min(8, Number(body?.chain_depth || 0)));
  const meditationChain = request.headers.get("x-aria-trigger") === "meditation-ia";
  const rwhtGuardMission = "mission_rwht_final_20260920_02";
  if (requestedMissionId !== rwhtGuardMission) {
    return out({ ok:true, status:"paused_load_guard", runtime:V, reason:"temporary_rwht_exclusive_run" });
  }
  const auth = authContextOf(request);
  const token = auth.token;

  let activeMissionId: string | null = null;

  try {
    let staleRecovery: { status: "ok" | "deferred"; reason?: string } = { status: "ok" };
    try {
      await rpc("aria_autonomy_recover_stale_missions", { p_stale_after: "00:02:00" });
    } catch (recoveryError) {
      const reason = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
      if (/schema cache|retrying|statement timeout|timeout/i.test(reason)) {
        staleRecovery = { status: "deferred", reason };
      } else {
        throw recoveryError;
      }
    }

    const mission = requestedMissionId
      ? await rpc("aria_mission_claim_by_id_lease", { p_mission_id: requestedMissionId, p_worker_id: V, p_lease_for: LEASE_FOR })
      : await rpc("aria_mission_claim_next_lease", { p_worker_id: V, p_lease_for: LEASE_FOR });
    if (!mission) return out({ ok: true, status: "idle", runtime: V });

    const missionId = String(mission.mission_id);
    activeMissionId = missionId;
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
          result = await executeStep(missionId, step, auth);
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
          lease_owner: null,
          lease_until: null,
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

    const humanGate = realHumanGate(mission);
    if (humanGate && !humanGateCompleted(mission)) {
      const alreadyRequested = mission?.checkpoint?.human_gate?.status === "pending";
      if (!alreadyRequested) {
        await emitEvent(missionId, "human_gate_requested", {
          required: true,
          method: humanGate.method,
          instructions: humanGate.instructions,
          reason: humanGate.reason,
        });
      }
      await updateMission(missionId, {
        status: "paused",
        current_step: completed.size,
        completed_steps: completed.size,
        next_action: "human_gate:confirm",
        checkpoint: {
          ...(mission.checkpoint || {}),
          plan: steps,
          completed_steps: [...completed],
          attempts,
          results,
          human_gate: {
            required: true,
            status: "pending",
            verified: false,
            method: humanGate.method,
            instructions: humanGate.instructions,
            reason: humanGate.reason,
          },
        },
        lease_owner: null,
        lease_until: null,
      });
      return out({
        ok: true,
        status: "human_gate_required",
        mission_id: missionId,
        runtime: V,
        completed_steps: completed.size,
        human_gate: { status: "pending", method: humanGate.method, instructions: humanGate.instructions },
      });
    }

    const executorTypes = [...new Set(steps.map(executorType))];
    const agentSteps = steps.filter((step) => executorType(step) === "agent");
    const modelSteps = steps.filter((step) => executorType(step) === "model");
    const agentIds = agentSteps.map((step) => String(step.target?.agent_id || "")).filter(Boolean);
    const verifiedTerminalMarkers = {
      universal_execution_verified: true,
      model_execution_verified: modelSteps.length > 0 && modelSteps.every((step) => verifyStep(step, results[String(step.id)])),
      agent_execution_verified: agentSteps.length > 0 && agentSteps.every((step) => verifyStep(step, results[String(step.id)])),
    };
    await emitEvent(missionId, "mission_verified", {
      steps: steps.length,
      completed_steps: completed.size,
      executor_types: executorTypes,
      agent_ids: agentIds,
      verified: true,
      ...verifiedTerminalMarkers,
    });

    const finalized = await rpc("aria_mission_finalize_verified_lease", {
      p_mission_id: missionId,
      p_worker_id: V,
    });
    if (!finalized) throw new Error("verified_terminalization_lease_lost");

    const chained = meditationChain ? await chainNextMeditationMission(chainDepth) : null;
    if (chained?.status === "chained" && chained?.child_status === "succeeded" && chained?.mission_id) {
      try {
        await rpc("aria_internal.record_mission_chain_evidence", {
          p_parent_mission_id: missionId,
          p_child_mission_id: String(chained.mission_id),
          p_worker_id: V,
          p_depth: Number(chained.depth || chainDepth + 1),
        });
      } catch {
        // Chain execution succeeded; proof persistence is best-effort and never rewrites a terminal mission.
      }
    }
    return out({ ok: true, status: "succeeded", mission_id: missionId, runtime: V, executor_types: executorTypes, results: completed.size, chained });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const failedMissionId = activeMissionId || requestedMissionId;
    let recoveryUpdate = "not_attempted";
    if (failedMissionId) {
      try {
        const recovered = await updateMission(failedMissionId, {
          status: "paused",
          next_action: "recovery: universal runner exception",
          last_stderr: reason,
          lease_owner: null,
          lease_until: null,
        });
        recoveryUpdate = recovered ? "applied" : "lease_lost";
      } catch (recoveryError) {
        recoveryUpdate = `failed:${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`;
      }
    }
    return out({ ok: false, status: "paused", mission_id: failedMissionId, runtime: V, error: reason, recovery_update: recoveryUpdate });
  }
});