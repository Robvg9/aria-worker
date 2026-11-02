const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "supabase", "functions", "aria-mission-runner-v22", "index.ts");
const source = fs.readFileSync(file, "utf8");

const required = [
  "verifiedModelFallbackRoutes",
  // Primary may be openrouter OR google; fallback must still fire for google unauthorized.
  '!["openrouter", "google", "mistral", "xai", "local_windows"].includes(primaryProvider)',
  'risk !== "READ"',
  '.in("provider_id", ["openrouter", "google"])',
  'providerId === "google" && !modelId.endsWith("-direct")',
  'providerId === "openrouter" && !modelId.endsWith(":free")',
  'Array.isArray(a.models)',
  'a.models.includes(modelId)',
  '_provider_priority: providerId === primaryProvider ? 1 : 0',
  "_provider_priority",
  "model_fallback_used",
  "model_execution_failures",
  '.from("quota_registry")',
  "m22QuotaAllowsModelRoute",
  "blockedRateLimitProviders",
  "blockedRateLimitAccounts",
  "m22RateLimitFallbackAllowed(step.policy)",
  "LOCAL_DEVICE_HEARTBEAT_FRESHNESS_MS = 3 * 60_000",
  "function isFreshDeviceHeartbeat(lastSeenAt: unknown",
  "isFreshDeviceHeartbeat(d?.last_seen_at)",
  "isFreshDeviceHeartbeat(device?.last_seen_at)",
  "model_execution_failures: Array.isArray(result?.model_execution_failures)",
  "provider_status: failure?.provider_status == null ? null : String(failure.provider_status)",
  'requiredConnectorOperations = ["cuevacoin_connection_status", "cuevacoin_project_control"]',
  "missingRequiredConnectorOperations",
  "required_tool_call_evidence_missing:",
  "github_app_permission_denied|github_app_actions_permission_required",
  'human_gate:resolve_github_app_actions_permission',
  'status: "human_gate_required"',
  'status: "paused"',
  'human_gate_requested',
  'status: reason.startsWith("planner_empty_steps") || requiresHumanGate ? "blocked" : "paused"',
  '"human_gate:enable_authorized_required_connector_operations"',
  "cuevacoinControlIncomplete",
  "cuevacoin_control_verification_incomplete",
  "human_gate:resolve_cuevacoin_read_only_access",
  "function buildCuevacoinAuthorizedReadPlan()",
  "policy: { read_only_audit: true, verification_read: true }",
  "internal/mission-read-dispatch",
  "allowed_external_operations: [\"github_repo_read\", \"supabase_project_status\", \"supabase_edge_functions_list\"]",
];

for (const fragment of required) {
  if (!source.includes(fragment)) {
    throw new Error("missing mission runner model fallback contract: " + fragment);
  }
}

// Regression contract for durable async Windows/Ollama model jobs.
const asyncReconciliationRequired = [
  'if (localResult?.status === "waiting" && typeof localResult?.job_id === "string"',
  'pending_source: "windows_ollama"',
  'const pendingJobId = typeof pending?.job_id === "string" ? String(pending.job_id).trim() : ""',
  'let reconciledPendingResult: any = null',
  'const polled = await getExecutionJob(pendingJobId)',
  'if (!pendingJob || !["succeeded", "failed", "timeout", "cancelled", "blocked"].includes(pendingStatus))',
  'attempt: pendingAttempt || Number(attempts[id] || 1)',
  'response: { content: String(pendingJob.stdout ?? "").trim() }',
  'pending_reconciled: true',
  'const nextAttempt = pendingAttempt > 0 ? pendingAttempt : Number(attempts[id] || 0) + 1',
  'if (!reconciledPendingResult)',
  'String(result?.status) === "waiting" && typeof result?.job_id === "string" && result.job_id.trim()',
  'status: "waiting_for_async_executor"',
];
for (const fragment of asyncReconciliationRequired) {
  if (!source.includes(fragment)) throw new Error("missing async local-model reconciliation contract: " + fragment);
}
console.log("mission-runner-v22 async local-model reconciliation contract: PASS");

console.log("mission-runner-v22 model fallback multi-provider contract: PASS");

if (!source.includes('executorType(step) === "connector"') || !source.includes('result?.data !== null')) {
  throw new Error("named tool success must be backed by a connector execution result");
}
console.log("mission runner required connector evidence anti-false-success contract: PASS");


(async () => {
  const governance = await import("../supabase/functions/aria-mission-runner-v22/model-fallback-governance-v1.mjs");
  const check = (condition, label) => {
    if (!condition) throw new Error("model fallback governance regression: " + label);
    console.log("model fallback governance: " + label + " PASS");
  };
  const expected = {
    provider_id: "openrouter",
    account_id: "acct_openrouter_primary",
    model_id: "nvidia/nemotron-3.5-lightning:free",
  };
  const availableQuota = {
    ...expected,
    status: "available",
    limits_requests: 50,
    usage_requests: 0,
    limits_tokens_input: null,
    usage_tokens_input: null,
    limits_tokens_output: null,
    usage_tokens_output: null,
    limits_tokens_total: null,
    usage_tokens_total: null,
  };
  const accountDailyQuota = {
    provider_id: "openrouter",
    account_id: "acct_openrouter_primary",
    model_id: null,
    status: "unknown",
    limits_requests: 50,
    usage_requests: null,
    limits_period: "day",
  };
  const quotaRows = [availableQuota, accountDailyQuota];
  check(governance.m22QuotaAllowsModelRoute(quotaRows, expected), "exact model plus account-wide quota row accepted");
  check(!governance.m22QuotaAllowsModelRoute([availableQuota], expected), "missing account-wide free quota fails closed");
  check(!governance.m22QuotaAllowsModelRoute([], expected), "missing quota fails closed");
  check(!governance.m22QuotaAllowsModelRoute([{ ...availableQuota, status: "disabled" }, accountDailyQuota], expected), "disabled model quota excluded");
  check(!governance.m22QuotaAllowsModelRoute([{ ...availableQuota, status: "unknown" }, accountDailyQuota], expected), "unknown model quota excluded");
  check(!governance.m22QuotaAllowsModelRoute([{ ...availableQuota, account_id: "another-account" }, accountDailyQuota], expected), "wrong account quota excluded");
  check(!governance.m22QuotaAllowsModelRoute([{ ...availableQuota, model_id: "another-model" }, accountDailyQuota], expected), "wrong model quota excluded");
  check(!governance.m22QuotaAllowsModelRoute([{ ...availableQuota, model_id: null }, accountDailyQuota], expected), "account-wide row cannot replace exact model row");
  check(!governance.m22QuotaAllowsModelRoute([availableQuota, { ...availableQuota }, accountDailyQuota], expected), "duplicate exact model quota rows fail closed");
  check(governance.m22QuotaAllowsModelRoute([{ ...availableQuota, usage_requests: 50 }, accountDailyQuota], expected), "stale per-model request counter is not used as account daily capacity");
  check(governance.m22QuotaAllowsModelRoute([{ ...availableQuota, usage_requests: null }, accountDailyQuota], expected), "live provider snapshot supplies free-model request usage");
  check(governance.m22QuotaAllowsModelRoute([{ ...availableQuota, limits_requests: 0, usage_requests: 0 }, accountDailyQuota], expected), "obsolete per-model request cap does not override account daily limit");
  check(!governance.m22QuotaAllowsModelRoute([{ ...availableQuota, usage_requests: -1 }, accountDailyQuota], expected), "negative model usage counter rejected");
  check(!governance.m22QuotaAllowsModelRoute([availableQuota, { ...accountDailyQuota, status: "disabled" }], expected), "disabled account-wide quota excluded");
  check(!governance.m22QuotaAllowsModelRoute([availableQuota, accountDailyQuota, { ...accountDailyQuota }], expected), "duplicate account-wide quota rows fail closed");
  check(!governance.m22QuotaAllowsModelRoute([{ ...availableQuota, limits_tokens_total: 100, usage_tokens_total: 100 }, accountDailyQuota], expected), "token-exhausted quota excluded");
  check(governance.m22ClassifyModelFallbackFailure(402, 429, null, "quota exhausted") === "quota_exhausted", "outer HTTP 402 wins over nested 429");
  check(governance.m22ClassifyModelFallbackFailure(429, 402, null, "rate limited") === "rate_limit", "outer HTTP 429 wins over nested 402");
  check(governance.m22ClassifyModelFallbackFailure(200, 429, null, "too many requests") === "rate_limit", "nested provider 429 recognized");
  check(governance.m22ClassifyModelFallbackFailure(200, null, "rate_limit", "provider limit") === "rate_limit", "provider rate-limit code recognized");
  check(governance.m22RateLimitFallbackAllowed({ allow_rate_limit_fallback: true }), "explicit boolean rate-limit fallback enabled");
  check(!governance.m22RateLimitFallbackAllowed({ allow_rate_limit_fallback: "true" }), "string true does not enable rate-limit fallback");
  check(!governance.m22RateLimitFallbackAllowed({}), "rate-limit fallback denied by default");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
