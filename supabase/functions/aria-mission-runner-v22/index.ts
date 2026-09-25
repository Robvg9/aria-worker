// Canonical deploy trigger: mission recovery policy v8 / Android-aware fallback routing.\nimport "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bitriseExecute } from "./bitrise.ts";
import { createPlanWithTimeout, buildDeviceEnqueuePayload, cloudflareConnectorExecute, DEVICE_OPS_ALLOWLIST } from "./forensic-continuity-fixes.ts";

const V_LOGICAL = "aria-mission-runner-v22-universal";
// Per-invocation fence: unique lease owner per tick.
// Prevents concurrent same-worker re-entry races.
// Cross-tick reclaim: running + lease_owner IS NULL.
const V = `${V_LOGICAL}:${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const MEMORY = `${URL}/functions/v1/aria-memory-v2`;
const CANONICAL = `${URL}/functions/v1/aria-canonical-runtime-v1`;
const PLANNER = `${URL}/functions/v1/aria-planner-v11`;
const EXEC = `${URL}/functions/v1/aria-execution-runtime-v1`;
const RUNTIME = `${URL}/functions/v1/aria-runtime-gateway-v1`;
const AGENT = `${URL}/functions/v1/aria-agent-runtime-v1`;
const SMART_VERIFIER = `${URL}/functions/v1/aria-smart-verifier-v1`;
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

async function validateLearningGate(goal: string, steps: any[]) {
  try {
    const { data: result, error } = await sb.rpc("aria_validate_learning_preflight", {
      p_goal: goal,
      p_plan: { steps },
    });
    if (error) throw new Error(error.message);
    return result && typeof result === "object"
      ? result
      : { version: "mastery-learning-loop-v1", passed: true, required: [], applied_memory_ids: [], missing: [] };
  } catch (error) {
    throw new Error(`learning_gate_unavailable:${error instanceof Error ? error.message : String(error)}`);
  }
}

async function verifyLearningApplication(goal: string, steps: any[], results: Record<string, unknown>, appliedMemoryIds: unknown) {
  try {
    const { data: result, error } = await sb.rpc("aria_verify_learning_application", {
      p_goal: goal,
      p_steps: steps,
      p_results: results,
      p_applied_memory_ids: Array.isArray(appliedMemoryIds) ? appliedMemoryIds : [],
    });
    if (error) throw new Error(error.message);
    return result && typeof result === "object"
      ? result
      : { version: "mastery-learning-loop-v1", passed: true, required_memory_ids: [], verified_memory_ids: [], missing_memory_ids: [] };
  } catch (error) {
    throw new Error(`learning_application_verification_unavailable:${error instanceof Error ? error.message : String(error)}`);
  }
}

function executorType(step: any) {
  return String(step?.executor_type || step?.target?.type || "");
}

const AGENT_RECOVERY_FALLBACKS: Record<string, string> = {
  "aria-agent-reviewer-v1": "aria-agent-verifier-openrouter-v1",
  "aria-agent-verifier-openrouter-v1": "aria-agent-coding-openrouter-v1",
  "aria-agent-verifier-gemini35-v1": "aria-agent-verifier-openrouter-v1",
};

function recoveryTargetsAndroid(recovery: any, step: any) {
  const raw = JSON.stringify({
    goal: recovery?.original_goal,
    failure: recovery?.block_details,
    previous: recovery?.previous_results,
    plan: recovery?.previous_plan,
    step,
  }).toLowerCase();
  return /android-ui-agent|mainactivity\.kt|build\.gradle|viewpager2|android-only|apk/.test(raw);
}

function applyRecoveryAgentFallbacks(steps: any[], recovery: any) {
  if (!recovery?.replan_required) return steps;
  const failed = new Set((Array.isArray(recovery.failed_step_ids) ? recovery.failed_step_ids : []).map(String));
  const androidRecovery = recoveryTargetsAndroid(recovery, {});
  return steps.map((step: any) => {
    if (executorType(step) !== "agent") return step;
    const current = String(step?.target?.agent_id || "");
    const shouldRoute = failed.has(String(step?.id)) || androidRecovery;
    if (!shouldRoute) return step;
    const fallback = recoveryTargetsAndroid(recovery, step)
      ? (current === "aria-agent-coding-v1" || current === "aria-agent-coding-openrouter-v1"
        ? "aria-agent-android-coding-openrouter-v1"
        : current === "aria-agent-reviewer-v1" || current === "aria-agent-verifier-openrouter-v1"
          ? "aria-agent-verifier-openrouter-v1"
          : AGENT_RECOVERY_FALLBACKS[current])
      : AGENT_RECOVERY_FALLBACKS[current];
    if (!fallback) return step;
    return {
      ...step,
      target: { ...(step.target || {}), agent_id: fallback },
      input: {
        ...(step.input || {}),
        recovery_rerouted_from_agent: current,
        recovery_rerouted: true,
      },
    };
  });
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

  if (mutationRequired) {
    const type = executorType(step);
    if (type === "agent") {
      const repair = result?.repair;
      const changed = repair?.changed === true;
      const writes = Array.isArray(repair?.writes) && repair.writes.length > 0;
      const verified = repair?.verified === true;
      if (!(changed && writes && verified)) return true;
    } else if (Object.keys(step?.verify && typeof step.verify === "object" ? step.verify : {}).length === 0) {
      return true;
    }
  }

  if (mutationRequired && /NO_CHANGE_REQUIRED/i.test(String(result?.repair?.summary ?? result?.response?.content ?? "")) && result?.repair?.verified !== true) {
    return true;
  }

  return false;
}

function verificationPending(step: any, result: any) {
  const mutationRequired = step?.policy?.mutating_operation_required === true
    || String(step?.risk ?? "").toUpperCase().includes("WRITE");
  const status = String(result?.repair?.verification_status ?? result?.verification_status ?? "").toLowerCase();
  return mutationRequired && [
    "awaiting_ci_or_live_verification",
    "awaiting_verification",
    "verification_pending",
  ].includes(status);
}

function verifyStep(step: any, result: any) {
  if (result?.__aria_verified_by_runner === true && result?.__aria_verification_evidence?.verified === true) {
    return true;
  }
  if (!(result?.status === "succeeded" || result?.ok === true)) return false;
  if (result?.error) return false;
  if (explicitlyUnverified(step, result)) return false;
  const verify = step?.verify && typeof step.verify === "object" ? step.verify : {};
  if (verify.expected_exit_code !== undefined && Number(result?.exit_code) !== Number(verify.expected_exit_code)) return false;
  if (typeof verify.stdout_contains === "string" && !String(result?.stdout ?? "").includes(verify.stdout_contains)) return false;
  if (typeof verify.stderr_contains === "string" && !String(result?.stderr ?? "").includes(verify.stderr_contains)) return false;
  if (typeof verify.response_content_equals === "string" && String(result?.response?.content ?? result?.response?.output_text ?? "") !== verify.response_content_equals) return false;
  const responseContent = String(result?.response?.content ?? result?.response?.output_text ?? "").trim();
  if (verify.response_content_nonempty === true && !responseContent) return false;
  if (typeof verify.response_content_contains === "string" && !responseContent.includes(verify.response_content_contains)) return false;
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

async function githubExecute(step: any, token: string | null, mission: any = null) {
  const operation = String(step.operation || "");
  const input = step.input && typeof step.input === "object" ? step.input : {};
  const readOps = new Set(["repo_read", "file_read", "pr_find", "pr_read", "pr_checks", "main_workflow_runs"]);
  const writeOps = new Set(["create_branch", "file_write", "open_pr", "pr_merge"]);
  if (!readOps.has(operation) && !writeOps.has(operation)) {
    throw new Error(`github_operation_not_allowed:${operation}`);
  }
  if (writeOps.has(operation)) {
    if (String(step.risk || "READ").toUpperCase() !== "LOW_RISK_WRITE") throw new Error("github_write_risk_not_allowed");
    if (step.authorization?.status !== "approved") throw new Error("github_write_authorization_required");
  }
  const projectId = String(mission?.metadata?.project_id || step?.target?.project_id || step?.input?.project_id || '').toLowerCase();
  const repo = String(input.repo || step.target?.repo || 'battlecruiser');
  if (projectId === 'battlecruiser' && repo.toLowerCase() === 'battlecruiser') {
    if (writeOps.has(operation)) {
      const branch = String(input.branch || step.target?.branch || '');
      if (operation === 'create_branch' && !branch.startsWith('aria/sandbox/')) throw new Error('battlecruiser_sandbox_branch_required');
      if (operation === 'file_write' && !branch.startsWith('aria/sandbox/')) throw new Error('battlecruiser_file_write_must_use_sandbox');
      if (operation === 'open_pr' && (!branch.startsWith('aria/sandbox/') || String(input.base || 'main') !== 'main')) throw new Error('battlecruiser_pr_must_promote_sandbox_to_main');
      if (operation === 'pr_merge') throw new Error('battlecruiser_auto_merge_forbidden');
    }
  }
  if (!token && !SECRET) throw new Error("github_runtime_auth_unavailable");
  const response = await fetch(GITHUB_APP, {
    method: "POST",
    headers: internalHeaders(),
    body: JSON.stringify({
      operation,
      owner: input.owner || step.target?.owner || "Robvg9",
      repo,
      branch: input.branch || step.target?.branch || "main",
      base: input.base || "main",
      path: input.path,
      content: input.content,
      message: input.message,
      title: input.title,
      body: input.body,
      number: input.number,
      commit_sha: input.commit_sha,
      paths: input.paths,
      auto_merge: input.auto_merge,
      commit_title: input.commit_title,
      commit_message: input.commit_message,
      risk_level: String(step.risk || "READ").toLowerCase().includes("low") ? "low" : "high",
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.ok !== true) throw new Error(String(result?.error || `github_http_${response.status}`));
  return {
    status: "succeeded",
    executor_type: "connector",
    connector_id: "github",
    operation,
    data: result.data,
    response: { content: JSON.stringify(result.data ?? {}) },
  };
}

async function connectorExecute(missionId: string, step: any, token: string | null, mission: any = null) {
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
  if (connector === "github") return githubExecute(step, token, mission);
  throw new Error(`connector_operation_not_allowed:${connector}:${operation}`);
}

async function latestVerificationEvidence(missionId: string, stepId: string, result: any) {
  if (result?.repair?.pr || result?.pr || result?.verification_evidence) return result;
  const { data, error } = await sb.schema("aria_internal").from("mission_events")
    .select("payload,created_at")
    .eq("mission_id", missionId)
    .in("event_type", ["agent_executor_diagnostic", "step_succeeded", "step_failed"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return result;
  for (const event of data || []) {
    const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
    if (String(payload?.step_id || "") !== stepId) continue;
    if (payload?.repair?.pr || payload?.pr || payload?.verification_evidence) return payload;
  }
  return result;
}

function verificationPaths(step: any, evidence: any) {
  const writes = evidence?.repair?.writes;
  const paths = Array.isArray(writes)
    ? writes.map((x: any) => String(x?.path || "")).filter(Boolean)
    : [];
  return paths.length ? paths : [String(step?.input?.path || "")].filter(Boolean);
}

function pendingVerificationResult(step: any, evidence: any) {
  const repair = evidence?.repair && typeof evidence.repair === "object" ? evidence.repair : {};
  const pr = repair?.pr ?? evidence?.pr ?? null;
  const branch = String(repair?.branch || pr?.head_ref || evidence?.branch || "");
  const number = Number(pr?.number || 0);
  const policy = step?.policy && typeof step.policy === "object" ? step.policy : {};
  return {
    pr,
    branch,
    number: Number.isInteger(number) && number > 0 ? number : null,
    policy,
    paths: verificationPaths(step, evidence),
  };
}

async function verifyPendingMutation(missionId: string, step: any, result: any, auth: AuthContext) {
  const evidence = await latestVerificationEvidence(missionId, String(step.id), result);
  const pending = pendingVerificationResult(step, evidence);
  if (!pending.number && !pending.branch) {
    return {
      status: "blocked" as const,
      reason: "verification_evidence_missing",
      details: {
        kind: "verification_evidence_missing",
        recoverable: true,
        reason: "ARIA ejecutó el cambio, pero no conservó una referencia verificable del cambio para completar la comprobación.",
        next_action: "replan: reconstruct verification evidence",
        remediation: "Reconstruir la evidencia del cambio (rama/PR/commit) y volver a ejecutar la verificación gobernada.",
        evidence: { step_id: String(step.id) },
      },
    };
  }

  let prData: any = null;
  let prNumber = pending.number;
  if (!prNumber && pending.branch) {
    try {
      const found = await githubExecute({
        operation: "pr_find",
        risk: "READ",
        target: { connector_id: "github" },
        input: { owner: "Robvg9", repo: String(step?.input?.repo || "aria-worker"), branch: pending.branch, base: "main", state: "all" },
        authorization: { status: "approved", risk_class: "READ", evidence_ref: "mission:" + missionId },
      }, null);
      prNumber = Number(found?.data?.items?.find((x: any) => ["open", "closed"].includes(String(x?.state)))?.number || 0) || null;
    } catch {}
  }

  if (!prNumber) {
    return {
      status: "blocked" as const,
      reason: "verification_pr_not_found",
      details: {
        kind: "verification_pr_not_found",
        recoverable: true,
        reason: "ARIA hizo el cambio pero todavía no encuentra la PR gobernada que debe certificarlo.",
        next_action: "replan: locate or recreate governed PR",
        remediation: "Localizar o recrear la PR de reparación y reintentar la verificación automática.",
        evidence: { branch: pending.branch || null, paths: pending.paths },
      },
    };
  }

  try {
    prData = await githubExecute({
      operation: "pr_read",
      risk: "READ",
      target: { connector_id: "github" },
      input: { owner: "Robvg9", repo: String(step?.input?.repo || "aria-worker"), number: prNumber },
      authorization: { status: "approved", risk_class: "READ", evidence_ref: "mission:" + missionId },
    }, null);
  } catch (e) {
    return {
      status: "waiting" as const,
      reason: "verification_transport_unavailable",
      details: {
        kind: "verification_pending",
        recoverable: true,
        reason: "La referencia de cambio existe, pero el verificador GitHub no respondió todavía.",
        next_action: "verification:retry_external_check",
        remediation: "Esperar la próxima pasada automática del verificador; no repetir la modificación.",
        evidence: { pr_number: prNumber, error: e instanceof Error ? e.message : String(e) },
      },
    };
  }

  const pr = prData?.data || {};
  if (pr.merged === true) {
    const mergeSha = String(pr.merge_commit_sha || "");
    if (!mergeSha) {
      return {
        status: "waiting" as const,
        reason: "verification_merge_commit_pending",
        details: {
          kind: "verification_pending",
          recoverable: true,
          reason: "La PR aparece fusionada, pero GitHub todavía no entregó el commit de merge necesario para validar main.",
          next_action: "verification:retry_external_check",
          remediation: "Repetir la verificación automática sin volver a ejecutar el cambio.",
          evidence: { pr_number: prNumber, head_sha: pr.head_sha || null },
        },
      };
    }
    let mainRuns: any;
    try {
      mainRuns = await githubExecute({
        operation: "main_workflow_runs",
        risk: "READ",
        target: { connector_id: "github" },
        input: { owner: "Robvg9", repo: String(step?.input?.repo || "aria-worker"), commit_sha: mergeSha },
        authorization: { status: "approved", risk_class: "READ", evidence_ref: "mission:" + missionId },
      }, null);
    } catch (e) {
      return {
        status: "waiting" as const,
        reason: "verification_transport_unavailable",
        details: {
          kind: "verification_pending",
          recoverable: true,
          reason: "La PR ya está fusionada, pero falta comprobar los workflows del commit de main.",
          next_action: "verification:retry_main_workflows",
          remediation: "Esperar la siguiente comprobación automática del commit fusionado.",
          evidence: { pr_number: prNumber, merge_sha: mergeSha, error: e instanceof Error ? e.message : String(e) },
        },
      };
    }
    const md = mainRuns?.data || {};
    if (Number(md.failed || 0) > 0) {
      return {
        status: "replan" as const,
        reason: "main_verification_failed",
        details: {
          kind: "verification_failed",
          recoverable: true,
          reason: "La PR se fusionó, pero la certificación del commit de main encontró workflows fallidos.",
          next_action: "replan: repair failed main verification",
          remediation: "Analizar los workflows fallidos y generar una estrategia nueva; no repetir automáticamente el mismo cambio.",
          evidence: { pr_number: prNumber, merge_sha: mergeSha, failed: md.failed, runs: md.runs || [] },
        },
      };
    }
    if (Number(md.pending || 0) > 0 || Number(md.total || 0) === 0) {
      return {
        status: "waiting" as const,
        reason: "main_verification_pending",
        details: {
          kind: "verification_pending",
          recoverable: true,
          reason: "La PR ya está fusionada; ARIA espera la certificación del commit de main.",
          next_action: "verification:await_main_workflows",
          remediation: "Esperar los workflows del commit fusionado y volver a verificar automáticamente.",
          evidence: { pr_number: prNumber, merge_sha: mergeSha, pending: md.pending, total: md.total },
        },
      };
    }
    if (md.all_passed === true) {
      const verifiedResult = {
        ...(evidence || result || {}),
        __aria_verified_by_runner: true,
        __aria_verification_evidence: {
          verified: true,
          source: "github_pr_and_main_workflows",
          pr_number: prNumber,
          merge_sha: mergeSha,
          checked_at: new Date().toISOString(),
        },
        repair: {
          ...(evidence?.repair || result?.repair || {}),
          verified: true,
          verification_status: "verified",
        },
      };
      return { status: "verified" as const, result: verifiedResult };
    }
  }

  if (String(pr.state || "") === "closed" && pr.merged !== true) {
    return {
      status: "replan" as const,
      reason: "verification_pr_closed_without_merge",
      details: {
        kind: "verification_failed",
        recoverable: true,
        reason: "La PR de reparación se cerró sin merge. La misma estrategia ya no debe repetirse.",
        next_action: "replan: create a different repair strategy",
        remediation: "Crear una nueva estrategia de reparación con la evidencia de esta tentativa.",
        evidence: { pr_number: prNumber, head_sha: pr.head_sha || null, state: pr.state },
      },
    };
  }

  let checks: any;
  try {
    checks = await githubExecute({
      operation: "pr_checks",
      risk: "READ",
      target: { connector_id: "github" },
      input: { owner: "Robvg9", repo: String(step?.input?.repo || "aria-worker"), number: prNumber, paths: pending.paths },
      authorization: { status: "approved", risk_class: "READ", evidence_ref: "mission:" + missionId },
    }, null);
  } catch (e) {
    return {
      status: "waiting" as const,
      reason: "verification_transport_unavailable",
      details: {
        kind: "verification_pending",
        recoverable: true,
        reason: "La PR existe y está abierta; falta que el verificador pueda leer sus checks.",
        next_action: "verification:retry_external_check",
        remediation: "Esperar la siguiente pasada automática del verificador; no repetir la modificación.",
        evidence: { pr_number: prNumber, error: e instanceof Error ? e.message : String(e) },
      },
    };
  }

  const checkData = checks?.data || {};
  if (Number(checkData.failed || 0) > 0) {
    return {
      status: "replan" as const,
      reason: "verification_checks_failed",
      details: {
        kind: "verification_failed",
        recoverable: true,
        reason: "La PR de reparación tiene verificaciones fallidas.",
        next_action: "replan: repair or replace the failed strategy",
        remediation: "Usar los checks fallidos como evidencia y generar una estrategia distinta; no repetir la misma operación sin cambios.",
        evidence: { pr_number: prNumber, runs: checkData.runs || [], failed: checkData.failed },
      },
    };
  }

  if (Number(checkData.pending || 0) > 0 || Number(checkData.relevant_total || 0) === 0) {
    return {
      status: "waiting" as const,
      reason: "verification_checks_pending",
      details: {
        kind: "verification_pending",
        recoverable: true,
        reason: "La PR existe pero sus verificaciones todavía no han terminado.",
        next_action: "verification:await_ci_or_live_verification",
        remediation: "Esperar la próxima pasada automática; no volver a ejecutar la modificación mientras la verificación está pendiente.",
        evidence: { pr_number: prNumber, pending: checkData.pending, relevant_total: checkData.relevant_total, runs: checkData.runs || [] },
      },
    };
  }

  if (checkData.all_passed === true) {
    const canAutoMerge =
      pending.policy?.auto_merge_low_risk === true &&
      String(step?.risk || "").toUpperCase() === "LOW_RISK_WRITE" &&
      pending.policy?.production_merge_requires_human_gate !== true;
    if (!canAutoMerge) {
      return {
        status: "waiting" as const,
        reason: "verification_ready_for_governed_merge",
        details: {
          kind: "human_gate",
          recoverable: true,
          reason: "La PR ya tiene checks verdes, pero su política requiere la continuación gobernada antes del merge.",
          next_action: "human_gate:confirm_merge",
          remediation: "Aprobar el merge mediante el Human Gate correspondiente; no volver a ejecutar el cambio.",
          evidence: { pr_number: prNumber, runs: checkData.runs || [] },
        },
      };
    }
    try {
      const merged = await githubExecute({
        operation: "pr_merge",
        risk: "LOW_RISK_WRITE",
        target: { connector_id: "github" },
        input: {
          owner: "Robvg9",
          repo: String(step?.input?.repo || "aria-worker"),
          number: prNumber,
          branch: pending.branch || pr.head_ref || "",
          base: "main",
          risk_level: "LOW_RISK_WRITE",
          auto_merge: true,
          paths: pending.paths,
          commit_title: "ARIA: verified governed repair",
          commit_message: "Merged automatically after governed CI verification.",
        },
        authorization: { status: "approved", risk_class: "LOW_RISK_WRITE", evidence_ref: "mission:" + missionId },
      }, null);
      if (merged?.data?.merged === true) {
        return await verifyPendingMutation(missionId, { ...step, policy: { ...(step.policy || {}), post_merge_verification_required: true } }, { ...(evidence || result || {}), repair: { ...(evidence?.repair || result?.repair || {}), pr: { ...(pending.pr || {}), number: prNumber, head_ref: pr.head_ref || pending.branch }, branch: pending.branch || pr.head_ref } }, auth);
      }
    } catch {}
  }

  return {
    status: "waiting" as const,
    reason: "verification_pending",
    details: {
      kind: "verification_pending",
      recoverable: true,
      reason: "El cambio existe y la verificación gobernada continúa; ARIA no volverá a ejecutar el mismo cambio mientras espera evidencia.",
      next_action: "verification:retry_external_check",
      remediation: "Esperar la siguiente pasada automática de verificación.",
      evidence: { pr_number: prNumber, branch: pending.branch || pr.head_ref || null },
    },
  };
}

async function verifiedModelFallbackRoutes(original: any, operation: string) {
  if (operation !== "text_generation") return [];
  const primaryProvider = String(original?.provider_id || "");
  // Allow fallback from any primary (openrouter OR google) so unauthorized/invalid
  // Google direct routes can recover via other verified routes. Never retry the same route.
  if (primaryProvider !== "openrouter" && primaryProvider !== "google") return [];
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

  const injectFault = typeof step?.input?.fault_injection === "string" ? String(step.input.fault_injection) : "";
  const injectAll = step?.input?.fault_all_routes === true;
  for (const route of routes) {
    const isPrimary = route.provider_id === primary.provider_id && route.account_id === primary.account_id && route.model_id === primary.model_id;
    const doInject = injectFault && (injectAll || isPrimary);
    const authForRoute = doInject
      ? { ...authorization, evidence_ref: `live-resilience-inject:${missionId}:${step.id}` }
      : authorization;
    const response = await fetch(EXEC, {
      method: "POST",
      headers: downstreamHeaders(auth),
      body: JSON.stringify({
        execution_version: "1",
        request_id: `${missionId}:${step.id}:${crypto.randomUUID()}`,
        task_id: step.id,
        capability: String(step.operation),
        selected_route: route,
        authorization: authForRoute,
        input: step.input || {},
        policy: step.policy || {},
        metadata: {
          mission_id: missionId,
          step_id: step.id,
          executor_type: "model",
          runner: V,
          fallback_route: route.model_id !== primary.model_id,
          ...(doInject ? { fault_injection: injectFault } : {}),
        },
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
  const originalAgentId = String(step.target.agent_id);
  const attempted = new Set<string>();
  let agentId = originalAgentId;
  const fallbackTrail: string[] = [];

  for (let hop = 0; hop < 3; hop += 1) {
    attempted.add(agentId);
    const response = await fetch(AGENT, {
      method: "POST",
      headers: downstreamHeaders(auth),
      body: JSON.stringify({
        mission_id: missionId,
        step_id: String(step.id),
        agent_id: agentId,
        operation: String(step.operation || "delegate"),
        risk: step.risk || "READ",
        policy: step.policy || {},
        input: step.input || {},
      }),
    });
    const body = await response.json().catch(() => null);

    if (response.ok && body?.status === "succeeded") {
      return {
        ...body,
        executor_type: "agent",
        operation: "delegate",
        agent_id: body.agent_id || agentId,
        recovery_agent_fallback_used: agentId !== originalAgentId,
        recovery_agent_fallback_from: agentId !== originalAgentId ? originalAgentId : null,
        recovery_agent_fallback_trail: fallbackTrail,
      };
    }

    const providerStatus = Number(body?.error?.provider_status ?? body?.provider_status ?? response.status);
    const message = String(body?.error?.message || body?.error || `agent_execution_${response.status}`);
    const retryableProviderFailure =
      providerStatus === 429
      || providerStatus >= 500
      || /quota|rate.?limit|too many requests|resource exhausted|timed out|timeout|network|fetch failed|connection reset|gateway/i.test(message);

    if (!retryableProviderFailure) throw new Error(message);

    const fallback = AGENT_RECOVERY_FALLBACKS[agentId];
    if (!fallback || attempted.has(fallback)) throw new Error(message);

    fallbackTrail.push(agentId + " -> " + fallback);
    agentId = fallback;
  }

  throw new Error(`agent_fallback_exhausted:${originalAgentId}`);
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

async function independentVerify(mission:any, step:any, result:any){
  const project=String(mission?.metadata?.project_id||step?.target?.project_id||'').toLowerCase();
  const risk=String(step?.risk||'READ').toUpperCase();
  if(project==='battlecruiser'
    && executorType(step)==='connector'
    && String(step.operation)==='create_branch'
    && String(step.input?.branch||'').startsWith('aria/sandbox/')
    && result?.status==='succeeded'
    && result?.data?.recovered_existing_branch===true
    && result?.data?.existing_base_mismatch===true){
    return {
      passed:true,
      skipped:false,
      reason:'governed_existing_sandbox_recovery',
      verification:{passed:true,source:'runner',existing_sandbox_branch:true}
    };
  }
  if(project!=='battlecruiser' && !['HIGH_RISK_WRITE','DESTRUCTIVE'].includes(risk)) return {passed:true,skipped:true,reason:'not_required'};
  const response=await fetch(SMART_VERIFIER,{method:'POST',headers:internalHeaders(),body:JSON.stringify({goal:mission?.goal||'',plan:{steps:[step]},step,result})});
  const body=await response.json().catch(()=>null);
  if(!response.ok||body?.verification?.passed!==true) return {passed:false,skipped:false,reason:'independent_verification_failed',verification:body?.verification||null};
  return {passed:true,skipped:false,verification:body.verification};
}

function planStrategySignature(steps:any[]) {
  const normalized = (Array.isArray(steps) ? steps : []).map((step:any) => ({
    id: String(step?.id || ""),
    executor_type: executorType(step),
    operation: String(step?.operation || ""),
    target: {
      type: String(step?.target?.type || executorType(step) || ""),
      connector_id: step?.target?.connector_id ?? null,
      device_id: step?.target?.device_id ?? null,
      agent_id: step?.target?.agent_id ?? null,
      provider_id: step?.target?.provider_id ?? null,
      account_id: step?.target?.account_id ?? null,
      model_id: step?.target?.model_id ?? null,
      project_id: step?.target?.project_id ?? null,
    },
  })).sort((a:any,b:any) => a.id.localeCompare(b.id));
  return JSON.stringify(normalized);
}

function objectivePlanAlignment(goal:string, steps:any[]){
  const text=String(goal||'').toLowerCase();
  const ops=(steps||[]).map((s:any)=>String(s?.operation||'').toLowerCase());
  const executors=(steps||[]).map((s:any)=>executorType(s));
  const isComputerDiagnostic=(
    /(diagnostica|diagnóstico|diagnostico|causa raíz|causa raiz|comprueba|comprueba|check|revisa|revisar|averigua)/.test(text) &&
    /(windows|computer\.use|computer use|windows device)/.test(text)
  );
  // Only treat RWHT as an explicit human-facing test intent. Do not let
  // identifiers such as "aria/sandbox/rwht-battlecruiser-..." trigger the RWHT path.
  // RWHT must be a standalone intent token. Keep path/branch identifiers such as
  // "aria/sandbox/rwht-battlecruiser-..." from activating the RWHT computer-use route.
  const rwhtProbe=text.replace(/[()[\\]{}:;,!.?]/g,' ');
  const isRwht=/(^|\\s)rwht(?=$|\\s)/i.test(rwhtProbe)
    || /(real world human|auditoría física|auditoria fisica|recorre.*interfaz|prueba física|prueba fisica|prueba de interfaz|botón|botones)/.test(text);
  const hasDevice=executors.includes('device');
  const hasAutonomous=ops.includes('computer.use.autonomous');
  const hasGithubWrite=ops.some((op:string)=>['create_branch','file_write','open_pr','pr_merge'].includes(op));
  if(isRwht && !hasAutonomous){
    return {
      ok:false,
      kind:'rwht_capability_mismatch',
      reason:'El objetivo exige una prueba RWHT, pero el plan no contiene ejecución autónoma de Computer Use en un dispositivo.',
      required:['executor_type=device','operation=computer.use.autonomous'],
      forbidden:[],
    };
  }
  if(isComputerDiagnostic && (!hasDevice || hasGithubWrite)){
    return {
      ok:false,
      kind:'diagnostic_surface_mismatch',
      reason: hasGithubWrite
        ? 'El objetivo es un diagnóstico de Windows/Computer Use, pero el plan intenta modificar GitHub en lugar de inspeccionar el dispositivo.'
        : 'El objetivo es un diagnóstico de Windows/Computer Use, pero el plan no contiene ningún paso sobre el dispositivo Windows.',
      required:['executor_type=device','diagnóstico de solo lectura sobre Windows'],
      forbidden:['create_branch','file_write','open_pr','pr_merge'],
    };
  }
  return {ok:true};
}

async function executeStep(missionId: string, step: any, auth: AuthContext, mission: any = null) {
  validateStep(step);
  const type = executorType(step);
  if (type === "connector") return connectorExecute(missionId, step, auth.token, mission);
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

function dependencyEvidenceForStep(step: any, results: Record<string, unknown>) {
  const ids = Array.isArray(step?.depends_on) ? step.depends_on.map(String) : [];
  if (!ids.length) return [];
  const maxEach = 9000;
  const maxTotal = 70000;
  const out:any[] = [];
  let total = 0;
  for (const id of ids) {
    const raw = results[id];
    if (raw === undefined) continue;
    const compact = raw && typeof raw === "object"
      ? {
          status: (raw as any)?.status ?? null,
          executor_type: (raw as any)?.executor_type ?? null,
          operation: (raw as any)?.operation ?? null,
          verified: (raw as any)?.verified ?? null,
          response: (raw as any)?.response?.content ?? (raw as any)?.response?.output_text ?? null,
          stdout: (raw as any)?.stdout ?? null,
          result: (raw as any)?.result ?? null,
          data: (raw as any)?.data ?? null,
          error: (raw as any)?.error ?? null,
        }
      : raw;
    const text=JSON.stringify(compact);
    const remaining=Math.max(0,maxTotal-total);
    const evidence=text.slice(0,Math.min(maxEach,remaining));
    out.push({step_id:id,evidence});
    total+=evidence.length;
    if(total>=maxTotal)break;
  }
  return out;
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
  // The temporary RWHT exclusivity guard must never become a global mission blocker.
  // It is only active when an explicit RWHT-exclusive trigger is supplied, and it
  // protects the original mission probe without blocking other mission IDs.
  const rwhtExclusive = request.headers.get("x-aria-trigger") === "rwht-exclusive";
  const rwhtGuardMission = "mission_rwht_final_20260920_02";
  if (rwhtExclusive && requestedMissionId !== rwhtGuardMission) {
    return out({ ok:true, status:"paused_load_guard", runtime:V, reason:"temporary_rwht_exclusive_run" });
  }
  const auth = authContextOf(request);
  const token = auth.token;

  let activeMissionId: string | null = null;

  try {
    let staleRecovery: { status: "ok" | "deferred"; reason?: string } = { status: "ok" };
    let hardBlockRecovery = 0;
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

    try {
      const reopened = await rpc("aria_internal.aria_reopen_recoverable_hard_blocks", { p_limit: 20 });
      hardBlockRecovery = Number(reopened || 0);
      if (hardBlockRecovery > 0 && requestedMissionId) {
        await emitEvent(String(requestedMissionId), "hard_blocks_reopened", {
          reopened: hardBlockRecovery,
          recovery_epoch: "advanced",
          reason: "new governed recovery capability",
        }).catch(() => undefined);
      }
    } catch {
      hardBlockRecovery = 0;
    }

    const mission = requestedMissionId
      ? await rpc("aria_mission_claim_by_id_lease", { p_mission_id: requestedMissionId, p_worker_id: V, p_lease_for: LEASE_FOR })
      : await rpc("aria_mission_claim_next_lease", { p_worker_id: V, p_lease_for: LEASE_FOR });
    if (!mission) return out({ ok: true, status: "idle", runtime: V_LOGICAL, invocation_id: V, stale_recovery: staleRecovery, hard_block_recovery: hardBlockRecovery });

    const missionId = String(mission.mission_id);
    activeMissionId = missionId;
    await renewLease(missionId);

    const recalled = await recall(String(mission.goal || ""), token);
    const previousRecovery = mission?.checkpoint?.recovery && typeof mission.checkpoint.recovery === "object"
      ? mission.checkpoint.recovery
      : null;
    const cognitiveContext = {
      version: "cognitive-loop-v2",
      available: recalled.available,
      recall_count: recalled.results.length,
      memory_ids: recalled.results.map((item: any) => item.memory_id || item.id).filter(Boolean),
      recovery: previousRecovery?.replan_required === true ? {
        replan_required: true,
        replan_count: Number(previousRecovery?.replan_count || 0),
        failure_reason: previousRecovery?.failure_reason || null,
        failed_step_ids: Array.isArray(previousRecovery?.failed_step_ids) ? previousRecovery.failed_step_ids : [],
        failed_step_details: previousRecovery?.block_details || null,
        previous_plan_summary: Array.isArray(previousRecovery?.previous_plan)
          ? previousRecovery.previous_plan.map((step: any) => ({
              id: step?.id,
              executor_type: step?.executor_type,
              operation: step?.operation,
              risk: step?.risk,
              target: step?.target,
            })).slice(0, 20)
          : [],
      } : null,
    };
    await emitEvent(missionId, "cognitive_recall_completed", cognitiveContext);

    let steps: any[];
    const recoveryState = mission?.checkpoint?.recovery && typeof mission.checkpoint.recovery === "object"
      ? mission.checkpoint.recovery
      : null;
    const recoveryNeedsFreshPlan = recoveryState?.replan_required === true
      && !["retry_scheduled", "replanned"].includes(String(recoveryState?.status || ""));
    if (Array.isArray(mission.checkpoint?.plan) && mission.checkpoint.plan.length && !recoveryNeedsFreshPlan) {
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
    steps = applyRecoveryAgentFallbacks(steps, mission?.checkpoint?.recovery);

    const recoveryPreviousPlan = previousRecovery?.replan_required === true && Array.isArray(previousRecovery?.previous_plan)
      ? previousRecovery.previous_plan
      : [];
    if (recoveryPreviousPlan.length && planStrategySignature(steps) === planStrategySignature(recoveryPreviousPlan)) {
      const failedStepIds = Array.isArray(previousRecovery?.failed_step_ids) ? previousRecovery.failed_step_ids.map(String) : [];
      const failedStepId = failedStepIds[0] || null;
      const previousResults = previousRecovery?.previous_results && typeof previousRecovery.previous_results === "object"
        ? previousRecovery.previous_results
        : {};
      const failedEvidence = failedStepId && previousResults[failedStepId] ? previousResults[failedStepId] : null;
      const failureError = failedEvidence?.error && typeof failedEvidence.error === "object"
        ? failedEvidence.error
        : null;
      const failureCode = String(failureError?.code || failedEvidence?.error_code || "executor_error");
      const failureMessage = String(failureError?.message || failedEvidence?.message || failureCode);
      const originalGoal = String(mission.goal || "");

      // One governed escape hatch: before declaring an identical strategy terminal,
      // ask the planner for a materially different strategy using explicit failure
      // evidence. This is especially important for protocol missions such as All For One.
      const recoveryGoal = [
        originalGoal,
        "",
        "RECUPERACIÓN OBLIGATORIA DE UNA ESTRATEGIA FALLIDA:",
        "La estrategia anterior ya falló y el plan generado ahora es idéntico.",
        "NO repitas el mismo executor_type + operation + target.",
        "Debes cambiar la ruta de ejecución o dividir el trabajo en especialistas adecuados.",
        `PASO FALLIDO: ${failedStepId || "desconocido"}`,
        `ERROR CONFIRMADO: ${failureCode} — ${failureMessage}`,
        "EVIDENCIA PREVIA: " + JSON.stringify({
          failed_step: failedEvidence?.operation || null,
          executor_type: failedEvidence?.executor_type || null,
          target: failedEvidence?.target || null,
          result: failedEvidence?.result || failedEvidence?.response || null,
        }).slice(0,9000),
        originalGoal.toLowerCase().includes("all for one")
          ? "PROTOCOLO ALL FOR ONE: usa obligatoriamente una revisión forense multi-modelo + multi-agente, sin convertir la auditoría en una prueba física de interfaz."
          : "Construye una alternativa gobernada que ataque directamente el objetivo original y cambie la capacidad utilizada."
      ].join("\n");

      try {
        const alternateSteps = await createPlan(recoveryGoal, {
          ...cognitiveContext,
          recovery_strategy_required: true,
          identical_strategy_detected: true,
          failed_step: failedStepId,
          failed_error: { code: failureCode, message: failureMessage },
          previous_plan: recoveryPreviousPlan.map((step:any)=>({
            id:step?.id,
            executor_type:executorType(step),
            operation:step?.operation,
            target:step?.target,
          })),
          previous_results: previousResults,
        }, token);

        const recoveredSteps = applyRecoveryAgentFallbacks(alternateSteps, {
          replan_required: true,
          failed_step_ids: failedStepIds,
          previous_plan: recoveryPreviousPlan,
          block_details: { failure_code: failureCode, failure_message: failureMessage },
        });
        const changedStrategy = Array.isArray(recoveredSteps)
          && recoveredSteps.length > 0
          && planStrategySignature(recoveredSteps) !== planStrategySignature(recoveryPreviousPlan);

        if (changedStrategy) {
          const autoRecovery = {
            status: "replanned",
            kind: "automatic_strategy_recovery",
            recoverable: true,
            replan_count: Number(previousRecovery?.replan_count || 0) + 1,
            reason: "ARIA detectó que el plan era idéntico al fallido y generó una estrategia diferente basada en la evidencia del fallo.",
            next_action: "next_ready_batch",
            remediation: "ARIA cambió automáticamente la ruta de ejecución antes de volver a intentarlo.",
            evidence: {
              failed_step_id: failedStepId,
              failure_code: failureCode,
              failure_message: failureMessage,
              previous_plan_signature: planStrategySignature(recoveryPreviousPlan),
              new_plan_signature: planStrategySignature(recoveredSteps),
            },
            previous_plan: recoveryPreviousPlan,
            previous_results: previousResults,
          };
          await updateMission(missionId, {
            status: "queued",
            current_step: 0,
            completed_steps: 0,
            next_action: "next_ready_batch",
            last_stderr: "automatic_strategy_recovery",
            checkpoint: {
              ...(mission.checkpoint || {}),
              plan: recoveredSteps,
              completed_steps: [],
              attempts: {},
              results: {},
              pending_jobs: {},
              recovery: autoRecovery,
              recovery_history: [
                ...((Array.isArray(mission.checkpoint?.recovery_history) ? mission.checkpoint.recovery_history : []).slice(-4)),
                {
                  failed_step_id: failedStepId,
                  failure_code: failureCode,
                  failure_message: failureMessage,
                  previous_plan: recoveryPreviousPlan,
                  previous_results: previousResults,
                  recovered_at: new Date().toISOString(),
                }
              ],
            },
            lease_owner: null,
            lease_until: null,
          });
          await emitEvent(missionId, "mission_replanned", autoRecovery);
          return out({
            ok: true,
            status: "replanned",
            mission_id: missionId,
            runtime: V,
            next_action: "next_ready_batch",
            recovery: autoRecovery,
          });
        }
      } catch {
        // Fall through to a precise human-readable block below.
      }

      const identicalRecovery = {
        status: "hard_block",
        recoverable: true,
        retry_ready: true,
        kind: "identical_replan_strategy",
        reason: `La estrategia anterior falló en "${failedStepId || "un paso"}" con ${failureCode}: ${failureMessage}.`,
        explanation: "ARIA detectó que el nuevo plan seguía usando exactamente la misma ruta que ya había fallado.",
        next_action: "recovery: elegir una capacidad o ruta distinta",
        remediation: "Desbloqueo: ejecutar una nueva estrategia que cambie el ejecutor, la operación o ambos. ARIA ya conserva la evidencia del fallo para evitar repetirlo.",
        steps: [
          `Causa real: ${failureCode} — ${failureMessage}.`,
          "ARIA intentó una replanificación automática y no encontró una estrategia diferente demostrable.",
          "Desbloqueo: aportar o habilitar una capacidad alternativa; al reintentar, ARIA debe usar una ruta distinta y conservar esta evidencia."
        ],
        evidence: {
          replan_count: Number(previousRecovery?.replan_count || 0),
          failed_step_ids: failedStepIds,
          operation: failedEvidence?.operation || null,
          executor_type: failedEvidence?.executor_type || null,
          target: failedEvidence?.target || null,
          result_status: failedEvidence?.status || null,
          failure_code: failureCode,
          failure_message: failureMessage,
          previous_plan_signature: planStrategySignature(recoveryPreviousPlan),
          current_plan_signature: planStrategySignature(steps),
        },
      };
      await updateMission(missionId, {
        status: "blocked",
        current_step: 0,
        completed_steps: 0,
        next_action: identicalRecovery.next_action,
        last_stderr: "identical_replan_strategy_blocked",
        checkpoint: {
          ...(mission.checkpoint || {}),
          recovery: identicalRecovery,
          plan: steps,
          active_step: null,
          pending_jobs: {},
        },
        lease_owner: null,
        lease_until: null,
      });
      await emitEvent(missionId, "mission_hard_blocked", identicalRecovery);
      return out({
        ok: false,
        status: "blocked",
        mission_id: missionId,
        runtime: V,
        completed_steps: 0,
        block_details: identicalRecovery,
      });
    }

    const objectiveGuard = objectivePlanAlignment(String(mission.goal || ""), steps);
    const previousObjectiveReplans = Number(mission?.checkpoint?.objective_plan_guard?.replan_attempts || 0);
    if (!objectiveGuard.ok) {
      await emitEvent(missionId, "mission_replanned", {
        reason: objectiveGuard.reason,
        kind: objectiveGuard.kind,
        required: objectiveGuard.required,
        forbidden: objectiveGuard.forbidden,
        replan_attempts: previousObjectiveReplans + 1,
      });
      if (previousObjectiveReplans < 1) {
        const constrainedGoal = [
          String(mission.goal || ""),
          "",
          "RESTRICCIÓN OBLIGATORIA DE EJECUCIÓN:",
          objectiveGuard.required.join(" ; "),
          objectiveGuard.forbidden.length ? "NO uses: " + objectiveGuard.forbidden.join(", ") + "." : "",
          "El plan debe investigar directamente la superficie nombrada por el objetivo y no certificar el objetivo con evidencia de otra capa.",
          "Si el objetivo es diagnóstico, prioriza lectura/inspección y no abras la aplicación objetivo salvo que sea necesario para comprobar la capacidad."
        ].filter(Boolean).join("\n");
        try {
          steps = await createPlan(constrainedGoal, {
            ...cognitiveContext,
            objective_plan_guard: {
              kind: objectiveGuard.kind,
              required: objectiveGuard.required,
              forbidden: objectiveGuard.forbidden,
              previous_plan: steps.map((step:any)=>({id:step?.id,executor_type:step?.executor_type,operation:step?.operation,risk:step?.risk})),
            },
          }, token);
        } catch (replanError) {
          const reason = replanError instanceof Error ? replanError.message : String(replanError);
          await updateMission(missionId, {
            status:"blocked",
            current_step:0,
            completed_steps:0,
            next_action:"manual: el planificador no pudo construir una estrategia alineada con el objetivo",
            last_stderr:"objective_plan_replan_failed:"+reason,
            checkpoint:{...(mission.checkpoint||{}),objective_plan_guard:{...objectiveGuard,replan_attempts:previousObjectiveReplans+1,replan_error:reason}},
            lease_owner:null,
            lease_until:null,
          });
          return out({ok:false,status:"blocked",mission_id:missionId,runtime:V,block_details:{kind:"objective_plan_replan_failed",reason:"El planificador no pudo generar una estrategia que investigue directamente la superficie solicitada.",remediation:"Revisar el diagnóstico y volver a ejecutar la misión con la ruta Windows/Computer Use disponible."}});
        }
        const secondGuard=objectivePlanAlignment(String(mission.goal || ""), steps);
        if(!secondGuard.ok){
          await updateMission(missionId,{
            status:"blocked",
            current_step:0,
            completed_steps:0,
            next_action:"manual: el planificador no generó un plan alineado con el objetivo",
            last_stderr:"objective_plan_capability_mismatch",
            checkpoint:{...(mission.checkpoint||{}),objective_plan_guard:{...secondGuard,replan_attempts:previousObjectiveReplans+1,previous_plan:steps}},
            lease_owner:null,
            lease_until:null,
          });
          return out({ok:false,status:"blocked",mission_id:missionId,runtime:V,block_details:{kind:secondGuard.kind,reason:secondGuard.reason,required:secondGuard.required,forbidden:secondGuard.forbidden,next_action:"Generar un plan que investigue directamente Windows/Computer Use antes de ejecutar cambios en otra capa.",remediation:"La misión no puede certificarse hasta que su plan corresponda con el objetivo."}});
        }
        await updateMission(missionId,{
          status:"queued",
          current_step:0,
          completed_steps:0,
          next_action:"next_ready_batch",
          last_stderr:null,
          checkpoint:{...(mission.checkpoint||{}),objective_plan_guard:{kind:objectiveGuard.kind,replan_attempts:previousObjectiveReplans+1,recovered:true},plan:steps,completed_steps:[],attempts:{},results:{},pending_jobs:{}},
          lease_owner:null,
          lease_until:null,
        });
        return out({ok:true,status:"replanned_objective_alignment",mission_id:missionId,runtime:V,objective_plan_guard:{kind:objectiveGuard.kind,replan_attempts:previousObjectiveReplans+1}});
      }
      await updateMission(missionId,{
        status:"blocked",
        current_step:0,
        completed_steps:0,
        next_action:"manual: plan desalineado con el objetivo después de un replanteamiento",
        last_stderr:"objective_plan_capability_mismatch",
        checkpoint:{...(mission.checkpoint||{}),objective_plan_guard:{...objectiveGuard,replan_attempts:previousObjectiveReplans}},
        lease_owner:null,
        lease_until:null,
      });
      return out({ok:false,status:"blocked",mission_id:missionId,runtime:V,block_details:{kind:objectiveGuard.kind,reason:objectiveGuard.reason,required:objectiveGuard.required,forbidden:objectiveGuard.forbidden,remediation:"El objetivo y el plan deben corresponder a la misma superficie antes de ejecutar."}});
    }

    const learningGate = await validateLearningGate(String(mission.goal || ""), steps);
    const previousLearningAttempts = Number(mission?.checkpoint?.learning_gate?.replan_attempts || 0);
    if (learningGate.passed !== true) {
      const nextAttempt = previousLearningAttempts + 1;
      const blockDetails = {
        kind: "learned_preflight_missing",
        reason: "ARIA has active learned knowledge that the current plan does not apply.",
        missing: learningGate.missing || [],
        required: learningGate.required || [],
        next_action: nextAttempt >= 2
          ? "manual: planner failed to apply required learned knowledge twice"
          : "replan: apply learned preflight requirements before execution",
        remediation: "Re-read the learned skill/failure prevention contract, build the prerequisites into the plan, and verify them before acting.",
        replan_attempts: nextAttempt,
      };
      await emitEvent(missionId, "learning_preflight_blocked", blockDetails);
      if (nextAttempt >= 2) {
        await updateMission(missionId, {
          status: "blocked",
          current_step: 0,
          completed_steps: 0,
          next_action: blockDetails.next_action,
          last_stderr: "learning_preflight_rejected_repeatedly",
          checkpoint: {
            ...(mission.checkpoint || {}),
            learning_gate: { version: "mastery-learning-loop-v1", passed: false, ...blockDetails },
            plan: [],
            completed_steps: [],
            attempts: {},
            results: {},
            pending_jobs: {},
          },
          lease_owner: null,
          lease_until: null,
        });
        return out({ ok: false, status: "blocked", mission_id: missionId, runtime: V, block_details: blockDetails });
      }

      await updateMission(missionId, {
        status: "queued",
        current_step: 0,
        completed_steps: 0,
        next_action: blockDetails.next_action,
        last_stderr: "learning_preflight_missing",
        checkpoint: {
          ...(mission.checkpoint || {}),
          learning_gate: { version: "mastery-learning-loop-v1", passed: false, ...blockDetails },
          plan: [],
          completed_steps: [],
          attempts: {},
          results: {},
          pending_jobs: {},
        },
        lease_owner: null,
        lease_until: null,
      });
      return out({ ok: true, status: "replanned_learning", mission_id: missionId, runtime: V, block_details: blockDetails });
    }

    for (const step of steps) validateStep(step);

    const completed = new Set<string>(Array.isArray(mission.checkpoint?.completed_steps) ? mission.checkpoint.completed_steps.map(String) : []);
    const attempts: Record<string, number> = mission.checkpoint?.attempts && typeof mission.checkpoint.attempts === "object" ? { ...mission.checkpoint.attempts } : {};
    const results: Record<string, unknown> = mission.checkpoint?.results && typeof mission.checkpoint.results === "object" ? { ...mission.checkpoint.results } : {};
    const pendingJobs: Record<string, unknown> = mission.checkpoint?.pending_jobs && typeof mission.checkpoint.pending_jobs === "object" ? { ...mission.checkpoint.pending_jobs } : {};

    if (mission?.checkpoint?.recovery?.status === "verification_pending" && mission?.checkpoint?.recovery?.failed_step_id) {
      const pendingStepId = String(mission.checkpoint.recovery.failed_step_id);
      const pendingStep = steps.find((step: any) => String(step.id) === pendingStepId);
      if (pendingStep) {
        const pendingResult = results[pendingStepId];
        const verification = await verifyPendingMutation(missionId, pendingStep, pendingResult, auth);
        if (verification.status === "verified" && verification.result) {
          results[pendingStepId] = verification.result;
          completed.add(pendingStepId);
          await emitEvent(missionId, "step_succeeded", {
            step_id: pendingStepId,
            executor_type: executorType(pendingStep),
            operation: pendingStep.operation,
            verified: true,
            verification_source: verification.result.__aria_verification_evidence?.source || "external_verifier",
          });
          await updateMission(missionId, {
            status: "running",
            current_step: completed.size,
            completed_steps: completed.size,
            next_action: completed.size < steps.length ? "next_ready_batch" : "verify_goal",
            checkpoint: {
              ...(mission.checkpoint || {}),
              plan: steps,
              completed_steps: [...completed],
              attempts,
              results,
              pending_jobs: pendingJobs,
              recovery: { status: "clear", recovered_from: "verification_pending" },
            },
            lease_owner: V,
            lease_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          });
        } else if (verification.status === "waiting") {
          await updateMission(missionId, {
            status: "waiting",
            current_step: completed.size,
            completed_steps: completed.size,
            next_action: verification.details?.next_action || "verification:retry_external_check",
            last_stderr: verification.reason,
            checkpoint: {
              ...(mission.checkpoint || {}),
              plan: steps,
              completed_steps: [...completed],
              attempts,
              results,
              pending_jobs: pendingJobs,
              recovery: {
                status: "verification_pending",
                failed_step_id: pendingStepId,
                verification_status: "awaiting_external_evidence",
                block_details: verification.details,
              },
            },
            lease_owner: null,
            lease_until: null,
          });
          return out({ ok: true, status: "waiting", mission_id: missionId, runtime: V, completed_steps: completed.size, pending_step: pendingStepId, recovery: verification.details });
        } else if (verification.status === "replan") {
          const recovery = {
            status: "replan_required",
            replan_required: true,
            failed_step_ids: [pendingStepId],
            failure_reason: verification.reason,
            block_details: verification.details,
            previous_plan: steps,
            previous_results: results,
          };
          await updateMission(missionId, {
            status: "queued",
            current_step: 0,
            completed_steps: 0,
            next_action: "replan: alternative recovery strategy required",
            last_stderr: verification.reason,
            checkpoint: { ...(mission.checkpoint || {}), recovery },
            lease_owner: null,
            lease_until: null,
          });
          return out({ ok: true, status: "replanned", mission_id: missionId, runtime: V, next_action: "replan: alternative recovery strategy required", recovery });
        } else {
          const details = verification.details || {
            kind: "hard_block",
            recoverable: false,
            reason: verification.reason,
            next_action: "manual: inspect mission evidence and choose a new governed strategy",
            remediation: "Revisar la evidencia de la misión y definir una nueva estrategia gobernada.",
          };
          await updateMission(missionId, {
            status: "blocked",
            current_step: completed.size,
            completed_steps: completed.size,
            next_action: details.next_action || "manual: inspect mission evidence",
            last_stderr: verification.reason,
            checkpoint: {
              ...(mission.checkpoint || {}),
              plan: steps,
              completed_steps: [...completed],
              attempts,
              results,
              recovery: { status: "hard_block", failed_step_id: pendingStepId, block_details: details },
            },
            lease_owner: null,
            lease_until: null,
          });
          return out({ ok: false, status: "blocked", mission_id: missionId, runtime: V, completed_steps: completed.size, blocked_step_id: pendingStepId, reason: verification.reason, block_details: details });
        }
      }
    }

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
        learning_gate: {
          ...learningGate,
          applied_at: new Date().toISOString(),
        },
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
        await updateMission(missionId, {
          status: "running",
          current_step: completed.size,
          completed_steps: completed.size,
          next_action: `execute: ${id}`,
          checkpoint: {
            ...(mission.checkpoint || {}),
            plan: steps,
            completed_steps: [...completed],
            attempts,
            results,
            active_step: {
              step_id: id,
              executor_type: executorType(step),
              operation: String(step.operation || "unknown"),
              started_at: new Date().toISOString(),
              attempt: nextAttempt,
            },
          },
        });

        let result: any;
        try {
          const executionStep = {
            ...step,
            input: {
              ...(step.input || {}),
              dependency_results: dependencyEvidenceForStep(step, results),
            },
          };
          result = await executeStep(missionId, executionStep, auth, mission);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          result = { status: "failed", executor_type: executorType(step), operation: step.operation, error: { code: "executor_error", message: reason } };
        }

        let independent = { passed: true, skipped: true };
        try { independent = await independentVerify(mission, step, result); } catch (error) { independent = { passed: false, skipped: false, reason: String(error instanceof Error ? error.message : error) }; }
        const passed = independent.passed && verifyStep(step, result);
        result.independent_verification = independent;
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

        await emitEvent(missionId, "step_failed", { step_id: id, executor_type: executorType(step), operation: step.operation, attempt: nextAttempt, reason: result?.error?.code || (String(result?.status || "") === "succeeded" ? "verification_failed" : (result?.status || "verification_failed")), result_status: result?.status ?? null, verification_status: result?.repair?.verification_status ?? result?.verification_status ?? null });
        return { step, result, passed: false, waiting: false };
      }));

      const waiting = outcomes.find((item) => item.waiting);
      for (const outcome of outcomes) {
        if (outcome.passed) completed.add(String(outcome.step.id));
        else results[String(outcome.step.id)] = outcome.result;
      }

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
        const verificationWait = failures.find((item) => verificationPending(item.step, item.result));
        if (verificationWait) {
          const pendingStepId = String(verificationWait.step.id);
          const details = {
            kind: "verification_pending",
            recoverable: true,
            reason: "ARIA ya ejecutó el cambio; ahora necesita evidencia externa (PR/CI/deploy) para certificarlo.",
            next_action: "verification:await_ci_or_live_verification",
            remediation: "No repetir la modificación mientras la verificación está pendiente; el verificador retomará la misión automáticamente.",
            evidence: {
              step_id: pendingStepId,
              verification_status: String(verificationWait.result?.repair?.verification_status || verificationWait.result?.verification_status || "awaiting_verification"),
              pr_number: verificationWait.result?.repair?.pr?.number ?? verificationWait.result?.pr?.number ?? null,
            },
          };
          await updateMission(missionId, {
            status: "waiting",
            current_step: completed.size,
            completed_steps: completed.size,
            next_action: details.next_action,
            last_stderr: "verification_pending",
            checkpoint: {
              ...checkpoint,
              recovery: {
                status: "verification_pending",
                failed_step_id: pendingStepId,
                verification_status: details.evidence.verification_status,
                block_details: details,
              },
            },
            lease_owner: null,
            lease_until: null,
          });
          return out({
            ok: true,
            status: "waiting",
            mission_id: missionId,
            runtime: V,
            completed_steps: completed.size,
            pending_step: pendingStepId,
            recovery: details,
          });
        }

        const retryableFailure = failures.find((item) => item.step.retryable !== false && RETRYABLE_STATUSES.has(String(item.result?.status || "failed")) && Number(attempts[String(item.step.id)]) < Math.min(3, Number(item.step.max_attempts || MAX_STEP_ATTEMPTS)));
        if (retryableFailure) {
          const retryStepId = String(retryableFailure.step.id);
          await updateMission(missionId, {
            status: "running",
            current_step: completed.size,
            completed_steps: completed.size,
            next_action: `retry: ${retryStepId}`,
            checkpoint: {
              ...checkpoint,
              recovery: {
                ...(checkpoint?.recovery && typeof checkpoint.recovery === "object" ? checkpoint.recovery : {}),
                status: "retry_scheduled",
                failed_step_id: retryStepId,
              },
              active_step: null,
            },
            lease_owner: null,
            lease_until: null,
          });
          await emitEvent(missionId, "step_retrying", { step_id: retryStepId, executor_type: executorType(retryableFailure.step), next_attempt: Number(attempts[retryStepId]) + 1 });
          return out({
            ok: true,
            status: "running",
            mission_id: missionId,
            runtime: V,
            completed_steps: completed.size,
            next_action: `retry: ${retryStepId}`,
          });
        }

        // Terminal failed: primary+fallback exhausted on non-retryable steps.
        // Write status=failed WHILE still holding the lease, then release.
        const failedStepIdsEarly = failures.map((item) => String(item.step.id));
        const allNonRetryable = failures.every((item) => item.step.retryable === false);
        const multiRouteExhausted = failures.some((item) => {
          const mfs = item.result?.model_execution_failures;
          const attempts = Number(item.result?.error?.attempts || 0);
          return attempts >= 2 || (Array.isArray(mfs) && mfs.length >= 2);
        });
        if (allNonRetryable && multiRouteExhausted) {
          const failEvidence = {
            status: "failed",
            reason: "all_model_routes_exhausted",
            failed_step_ids: failedStepIdsEarly,
            failures: failures.map((item: any) => ({
              step_id: String(item.step.id),
              status: item.result?.status ?? null,
              error: item.result?.error ?? null,
              model_execution_failures: item.result?.model_execution_failures ?? null,
              provider_id: item.result?.provider_id ?? item.step?.target?.provider_id ?? null,
              model_id: item.result?.model_id ?? item.step?.target?.model_id ?? null,
            })),
          };
          await emitEvent(missionId, "mission_failed", failEvidence);
          await updateMission(missionId, {
            status: "failed",
            current_step: completed.size,
            completed_steps: completed.size,
            next_action: "terminal: all model routes exhausted",
            last_stderr: "model_execution_failed_all_routes",
            checkpoint: {
              ...checkpoint,
              results,
              attempts,
              recovery: {
                status: "failed",
                failed_step_ids: failedStepIdsEarly,
                failure_reason: "all_model_routes_exhausted",
                evidence: failEvidence,
              },
              active_step: null,
            },
            lease_owner: null,
            lease_until: null,
          });
          return out({
            ok: false,
            status: "failed",
            mission_id: missionId,
            runtime: V_LOGICAL,
            invocation_id: V,
            completed_steps: completed.size,
            failed_steps: failedStepIdsEarly,
            failure: failEvidence,
          });
        }

        const replanCount = Number(mission?.checkpoint?.recovery?.replan_count || 0) + 1;
        const failedStepIds = failedStepIdsEarly;
        const previousPlan = steps;
        const previousResults = results;
        const maxReplans = 2;
        if (replanCount <= maxReplans) {
          const recovery = {
            status: "replan_required",
            replan_required: true,
            replan_count: replanCount,
            failure_reason: "retry_exhausted",
            failed_step_ids: failedStepIds,
            block_details: {
              kind: "retry_exhausted_strategy",
              recoverable: true,
              reason: "La estrategia actual agotó sus reintentos sin alcanzar una verificación válida.",
              next_action: "replan: discard failed strategy and build an alternative",
              remediation: "Conservar la evidencia de la estrategia fallida y generar un plan diferente. No repetir automáticamente los mismos pasos.",
              evidence: {
                failed_step_ids: failedStepIds,
                attempts,
              },
            },
            previous_plan: previousPlan,
            previous_results: previousResults,
          };
          await emitEvent(missionId, "mission_replanned", recovery);
          await updateMission(missionId, {
            status: "queued",
            current_step: 0,
            completed_steps: 0,
            next_action: "replan: discard failed strategy and build an alternative",
            last_stderr: "retry_exhausted_replanned",
            checkpoint: {
              ...checkpoint,
              plan: undefined,
              completed_steps: [],
              attempts: {},
              results: {},
              pending_jobs: {},
              recovery,
            },
            lease_owner: null,
            lease_until: null,
          });
          return out({
            ok: true,
            status: "replanned",
            mission_id: missionId,
            runtime: V_LOGICAL,
            invocation_id: V,
            next_action: "replan: discard failed strategy and build an alternative",
            recovery,
          });
        }

        const hardBlock = {
          status: "hard_block",
          recoverable: false,
          reason: "ARIA agotó las estrategias gobernadas disponibles para esta misión.",
          next_action: "manual: inspect mission evidence and define a new governed capability or resource",
          remediation: "Revisar todas las estrategias y evidencias previas, corregir la causa estructural o añadir una capacidad gobernada antes de volver a intentar.",
          evidence: {
            replan_count: replanCount,
            failed_step_ids: failedStepIds,
            previous_plan: previousPlan,
            previous_results: previousResults,
          },
        };
        await emitEvent(missionId, "mission_hard_blocked", hardBlock);
        await updateMission(missionId, {
          status: "blocked",
          current_step: completed.size,
          completed_steps: completed.size,
          next_action: hardBlock.next_action,
          last_stderr: "retry_exhausted_all_strategies",
          checkpoint: { ...checkpoint, recovery: { status: "hard_block", replan_count: replanCount, failed_step_ids: failedStepIds, block_details: hardBlock } },
          lease_owner: null,
          lease_until: null,
        });
        return out({ ok: false, status: "blocked", mission_id: missionId, runtime: V_LOGICAL, invocation_id: V, completed_steps: completed.size, failed_steps: failedStepIds, block_details: hardBlock });
      }

      const nextAction = completed.size < steps.length ? "next_ready_batch" : "verify_goal";
      // Batch continuation: KEEP lease ownership across ticks.
      if (completed.size < steps.length) {
        // Release lease for next invocation reclaim (running + null owner).
        await updateMission(missionId, {
          status: "running",
          current_step: completed.size,
          completed_steps: completed.size,
          next_action: nextAction,
          checkpoint: { ...checkpoint, recovery: { status: "clear" }, active_step: null },
          lease_owner: null,
          lease_until: null,
        });
        return out({
          ok: true,
          status: "running",
          mission_id: missionId,
          runtime: V_LOGICAL,
          invocation_id: V,
          completed_steps: completed.size,
          total_steps: steps.length,
          next_action: nextAction,
          lease_released_for_reclaim: true,
        });
      }
      await updateMission(missionId, {
        status: "running",
        current_step: completed.size,
        completed_steps: completed.size,
        next_action: nextAction,
        checkpoint: { ...checkpoint, recovery: { status: "clear" }, active_step: null },
      });
    }

    const learningApplication = await verifyLearningApplication(
      String(mission.goal || ""),
      steps,
      results,
      learningGate?.applied_memory_ids || []
    );

    if (learningApplication.passed !== true) {
      const currentLearningReplans = Number(mission?.checkpoint?.learning_gate?.application_replan_attempts || 0);
      const nextLearningReplans = currentLearningReplans + 1;
      const applicationBlock = {
        kind: "learned_application_evidence_missing",
        reason: "ARIA completed the plan but could not prove that the learned knowledge was actually applied in execution evidence.",
        verification: learningApplication,
        application_replan_attempts: nextLearningReplans,
        next_action: nextLearningReplans >= 2
          ? "manual: learned knowledge application could not be evidenced"
          : "replan: add executable verification for the required learned knowledge before success",
        remediation: "Create explicit preflight/read/verification steps whose successful results contain the learned prerequisites, then re-run the governed plan."
      };
      await emitEvent(missionId, "checkpoint_saved", { kind: "learning_application_verification_failed", ...applicationBlock });

      if (nextLearningReplans >= 2) {
        await updateMission(missionId, {
          status: "blocked",
          current_step: completed.size,
          completed_steps: completed.size,
          next_action: applicationBlock.next_action,
          last_stderr: "learning_application_evidence_missing",
          checkpoint: {
            ...(mission.checkpoint || {}),
            learning_gate: {
              ...learningGate,
              application_verified: false,
              application_replan_attempts: nextLearningReplans,
              application_verification: learningApplication,
            },
            plan: steps,
            completed_steps: [...completed],
            attempts,
            results,
            pending_jobs: pendingJobs,
            recovery: {
              status: "learning_application_evidence_missing",
              block_details: applicationBlock,
            },
          },
          lease_owner: null,
          lease_until: null,
        });
        return out({ ok: false, status: "blocked", mission_id: missionId, runtime: V, block_details: applicationBlock });
      }

      await updateMission(missionId, {
        status: "queued",
        current_step: 0,
        completed_steps: 0,
        next_action: applicationBlock.next_action,
        last_stderr: "learning_application_evidence_missing",
        checkpoint: {
          ...(mission.checkpoint || {}),
          learning_gate: {
            ...learningGate,
            application_verified: false,
            application_replan_attempts: nextLearningReplans,
            application_verification: learningApplication,
          },
          plan: undefined,
          completed_steps: [],
          attempts: {},
          results: {},
          pending_jobs: {},
          recovery: {
            status: "replan_learning_application",
            replan_required: true,
            block_details: applicationBlock,
          },
        },
        lease_owner: null,
        lease_until: null,
      });
      return out({ ok: true, status: "replanned_learning_application", mission_id: missionId, runtime: V, block_details: applicationBlock });
    }

    await emitEvent(missionId, "checkpoint_saved", {
      kind: "learning_application_verified",
      version: "mastery-learning-loop-v1",
      applied_memory_ids: learningGate?.applied_memory_ids || [],
      verified_memory_ids: learningApplication?.verified_memory_ids || [],
    });

    const verifiedLearningGate = {
      ...(learningGate || {}),
      application_verified: true,
      application_verification: learningApplication,
      verified_at: new Date().toISOString(),
    };

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
          learning_gate: verifiedLearningGate,
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
    return out({ ok: true, status: "succeeded", mission_id: missionId, runtime: V_LOGICAL, invocation_id: V, executor_types: executorTypes, results: completed.size, chained });
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
    return out({ ok: false, status: "paused", mission_id: failedMissionId, runtime: V_LOGICAL, invocation_id: V, error: reason, recovery_update: recoveryUpdate });
  }
});