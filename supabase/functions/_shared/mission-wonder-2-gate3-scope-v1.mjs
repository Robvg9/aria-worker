const PURPOSE = "mission_wonder_2_gate3_provider_fallback_v1";
const GOOGLE_PRIMARY = Object.freeze({ provider_id: "google", account_id: "acct_google_gemini_free", model_id: "google/gemini-3.5-flash-lite-direct", capability: "text_generation" });
const OPENROUTER_FALLBACK = Object.freeze({ provider_id: "openrouter", account_id: "acct_openrouter_primary", model_id: "nvidia/nemotron-3.5-lightning:free", capability: "text_generation" });

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((acc, key) => { acc[key] = normalize(value[key]); return acc; }, {});
  return value;
}
function canonicalStep(step) {
  const explicit = String(step?.executor_type || step?.target?.type || "");
  const executor = explicit || (step?.target?.provider_id && step?.target?.account_id && step?.target?.model_id ? "model" : "");
  return normalize({ id: step?.id ?? null, operation: step?.operation ?? null, executor_type: executor, risk: step?.risk ?? "READ", target: step?.target ?? null, input: step?.input ?? null, policy: step?.policy ?? null, authorization: step?.authorization ?? null });
}
export async function m22Gate3HumanGateActionHash(step) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(canonicalStep(step))));
  return Array.from(new Uint8Array(bytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function m22Gate3RouteAllowed(route) {
  if (!route || route.status !== "selected" || route.capability !== "text_generation") return false;
  return (route.provider_id === GOOGLE_PRIMARY.provider_id && route.account_id === GOOGLE_PRIMARY.account_id && route.model_id === GOOGLE_PRIMARY.model_id)
    || (route.provider_id === OPENROUTER_FALLBACK.provider_id && route.account_id === OPENROUTER_FALLBACK.account_id && route.model_id === OPENROUTER_FALLBACK.model_id);
}
/** Narrow exception for one supervised Gate 3 probe. This never clears the global pause. */
export function m22MissionWonder2ScopedProbeAllowed(mission, step, actionHash, now = Date.now()) {
  const missionId = String(mission?.mission_id ?? "");
  if (!/^mission_wonder_2_gate3_probe_[A-Za-z0-9_-]{6,80}$/.test(missionId)) return false;
  if (!["queued", "running"].includes(String(mission?.status ?? ""))) return false;
  const metadata = mission?.metadata;
  const scope = metadata?.mission_wonder_2_gate3_scope;
  if (metadata?.probe !== "mission_wonder_2_gate3" || metadata?.goal_source !== "mission_wonder_2_gate3") return false;
  if (!scope || scope.version !== 1 || scope.purpose !== PURPOSE || scope.enabled !== true) return false;
  if (scope.max_provider_calls !== 1 || typeof scope.review_ref !== "string" || !scope.review_ref.startsWith("workflow_dispatch:")) return false;
  const issuedAt = Date.parse(String(scope.issued_at ?? ""));
  const expiresAt = Date.parse(String(scope.expires_at ?? ""));
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now + 60_000 || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > 15 * 60_000) return false;
  const plan = mission?.checkpoint?.plan;
  if (!Array.isArray(plan) || plan.length !== 1 || !step) return false;
  const plannedStep = plan[0];
  const plannedAuthorization = plannedStep?.authorization;
  const suppliedAuthorization = step?.authorization;
  // The runner replaces a Human Gate's pending authorization with a verified
  // execution grant immediately before calling the model executor. Compare all
  // action fields against the persisted plan, then verify that transformed grant
  // is bound to this exact approved gate.
  const comparableStep = { ...step, authorization: plannedAuthorization };
  if (JSON.stringify(canonicalStep(plannedStep)) !== JSON.stringify(canonicalStep(comparableStep))) return false;
  const persistedAuthorization = JSON.stringify(normalize(suppliedAuthorization)) === JSON.stringify(normalize(plannedAuthorization));
  const executionAuthorization =
    suppliedAuthorization?.status === "approved" &&
    suppliedAuthorization?.risk_class === "READ" &&
    suppliedAuthorization?.human_gate_verified === true &&
    suppliedAuthorization?.human_gate_action_hash === actionHash &&
    suppliedAuthorization?.human_gate_mission_id === missionId &&
    suppliedAuthorization?.human_gate_step_id === String(step.id ?? "");
  if (!persistedAuthorization && !executionAuthorization) return false;
  if (persistedAuthorization && plannedAuthorization?.status !== "human_required") return false;
  if (String(step.id ?? "") !== "gate3_provider_fallback" || step.executor_type !== "model" || step.target?.type !== "model" || step.operation !== "text_generation") return false;
  if (String(step.risk ?? "").toUpperCase() !== "READ") return false;
  if (step.target?.provider_id !== GOOGLE_PRIMARY.provider_id || step.target?.account_id !== GOOGLE_PRIMARY.account_id || step.target?.model_id !== GOOGLE_PRIMARY.model_id) return false;
  const input = step.input ?? {};
  const payload = input.payload && typeof input.payload === "object" ? input.payload : input;
  if (input.fault_injection !== "http_429" || input.fault_all_routes === true) return false;
  if (typeof payload.prompt !== "string" || payload.prompt.length < 1 || payload.prompt.length > 220) return false;
  const maxTokens = Number(payload.max_completion_tokens ?? payload.max_tokens);
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32) return false;
  if (step.verify?.response_content_equals !== "MISSION_WONDER_2_GATE3_OK") return false;
  const policy = step.policy ?? {};
  if (policy.human_gate_required !== true || policy.allow_rate_limit_fallback !== true || policy.mission_wonder_2_gate3_probe !== true) return false;
  // Prevent automatic retries from multiplying the one external provider call.
  if (step.retryable !== false || Number(step.max_attempts) !== 1) return false;
  const gate = mission?.checkpoint?.human_gate;
  if (!gate || gate.required !== true || gate.status !== "approved" || gate.verified !== false) return false;
  if (gate.step_id !== step.id || gate.action_hash !== actionHash || !/^[0-9a-f]{64}$/.test(String(actionHash ?? ""))) return false;
  if (typeof gate.approval_token !== "string" || gate.approval_token.length < 32 || typeof gate.approved_by !== "string" || !gate.approved_by.trim()) return false;
  if (executionAuthorization && suppliedAuthorization.human_gate_approval_token !== gate.approval_token) return false;
  return true;
}
