const PURPOSE = "mission_wonder_2_step3_pwa_scoped_mission_v1";
const MAX_TTL_MS = 15 * 60 * 1000;
const ALLOWED_OPERATIONS = Object.freeze([
  "repo_read", "tree_read", "file_read", "ref_read",
  "pr_find", "pr_read", "pr_checks", "main_workflow_runs",
  "text_generation"
]);
const ALLOWED_MODEL_ROUTES = Object.freeze([
  Object.freeze({ provider_id: "google", account_id: "acct_google_gemini_free", model_id: "google/gemini-3.5-flash-lite-direct" }),
  Object.freeze({ provider_id: "openrouter", account_id: "acct_openrouter_primary", model_id: "nvidia/nemotron-3.5-lightning:free" })
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MISSION_ID = /^mission_mw2_pwa_[0-9a-f]{32}$/i;

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function normalizeHexOrText(value) {
  return String(value ?? "").trim();
}

function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256(secret, payloadSegment) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signature = base64UrlToBytes(payloadSegment);
  return { key, signature };
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value ?? "")));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function missionWonder2PwaScopeTokenProof(token) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { payload_b64: parts[0], signature_b64: parts[1] };
}

export async function verifyMissionWonder2PwaScopeToken(token, secret, expected = {}, options = {}) {
  const proof = missionWonder2PwaScopeTokenProof(token);
  if (!proof) return { ok: false, reason: "scope_token_malformed" };
  return verifyMissionWonder2PwaScopeProof(proof, secret, expected, options);
}

export async function verifyMissionWonder2PwaScopeProof(proof, secret, expected = {}, options = {}) {
  try {
    if (!proof || typeof proof !== "object" || typeof proof.payload_b64 !== "string" || typeof proof.signature_b64 !== "string") {
      return { ok: false, reason: "scope_proof_missing" };
    }
    if (typeof secret !== "string" || secret.length < 32) return { ok: false, reason: "scope_secret_unavailable" };
    const { key, signature } = await hmacSha256(secret, proof.signature_b64);
    const validSignature = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(proof.payload_b64));
    if (!validSignature) return { ok: false, reason: "scope_signature_invalid" };

    const payloadBytes = base64UrlToBytes(proof.payload_b64);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "scope_payload_invalid" };
    if (payload.v !== 1 || payload.purpose !== PURPOSE) return { ok: false, reason: "scope_purpose_invalid" };
    if (!UUID.test(String(payload.scope_id || "")) ||
        !UUID.test(String(payload.user_id || "")) ||
        !UUID.test(String(payload.request_id || "")) ||
        !MISSION_ID.test(String(payload.mission_id || ""))) return { ok: false, reason: "scope_identity_invalid" };
    if (!["aria", "battlecruiser", "cuevacoin"].includes(String(payload.project_id || ""))) return { ok: false, reason: "scope_project_invalid" };
    if (!/^[0-9a-f]{64}$/i.test(String(payload.goal_sha256 || ""))) return { ok: false, reason: "scope_goal_hash_invalid" };

    const issuedAt = Date.parse(String(payload.issued_at || ""));
    const expiresAt = Date.parse(String(payload.expires_at || ""));
    const now = Number(options.now ?? Date.now());
    if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(now) ||
        issuedAt > now + 60_000 || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TTL_MS) {
      return { ok: false, reason: "scope_time_bounds_invalid" };
    }
    const expired = expiresAt <= now;
    if (expired && options.allowExpired !== true) return { ok: false, reason: "scope_expired", payload };

    if (Number(payload.max_steps) < 1 || Number(payload.max_steps) > 4 ||
        Number(payload.max_attempts) < 1 || Number(payload.max_attempts) > 2) {
      return { ok: false, reason: "scope_execution_bounds_invalid" };
    }
    if (!Array.isArray(payload.allowed_operations) ||
        JSON.stringify(payload.allowed_operations) !== JSON.stringify(ALLOWED_OPERATIONS)) {
      return { ok: false, reason: "scope_operation_allowlist_invalid" };
    }
    if (!Array.isArray(payload.allowed_model_routes) ||
        JSON.stringify(payload.allowed_model_routes) !== JSON.stringify(ALLOWED_MODEL_ROUTES)) {
      return { ok: false, reason: "scope_model_allowlist_invalid" };
    }
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (expectedValue !== undefined && normalizeHexOrText(payload[field]) !== normalizeHexOrText(expectedValue)) {
        return { ok: false, reason: "scope_binding_mismatch:" + field };
      }
    }
    return { ok: true, expired, payload };
  } catch {
    return { ok: false, reason: "scope_proof_invalid" };
  }
}

export function missionWonder2PwaScopeStepAllowed(payload, step) {
  if (!payload || !step || String(step.risk || "READ").toUpperCase() !== "READ") return false;
  const verification = step.verify && typeof step.verify === "object" ? step.verify : null;
  if (!verification || Array.isArray(verification) || Object.keys(verification).length === 0) return false;
  const operation = String(step.operation || "");
  const executor = String(step.executor_type || step.target?.type || "");
  if (!Array.isArray(payload.allowed_operations) || !payload.allowed_operations.includes(operation)) return false;

  if (executor === "connector") {
    return String(step.target?.connector_id || "") === "github" &&
      ["repo_read", "tree_read", "file_read", "ref_read", "pr_find", "pr_read", "pr_checks", "main_workflow_runs"].includes(operation);
  }
  if (executor === "model") {
    if (operation !== "text_generation" || String(step.target?.type || "") !== "model") return false;
    const routeAllowed = ALLOWED_MODEL_ROUTES.some((route) =>
      route.provider_id === String(step.target?.provider_id || "") &&
      route.account_id === String(step.target?.account_id || "") &&
      route.model_id === String(step.target?.model_id || "")
    );
    const input = step.input && typeof step.input === "object" ? step.input : {};
    const modelInput = input.payload && typeof input.payload === "object" ? input.payload : input;
    return routeAllowed &&
      typeof modelInput.prompt === "string" &&
      modelInput.prompt.length >= 1 &&
      modelInput.prompt.length <= 12000 &&
      Number(modelInput.max_tokens ?? modelInput.max_completion_tokens ?? 0) > 0 &&
      Number(modelInput.max_tokens ?? modelInput.max_completion_tokens ?? 0) <= 1200 &&
      !Array.isArray(modelInput.tools) &&
      step.policy?.tool_use !== true;
  }
  return false;
}

export function missionWonder2PwaScopeRouteAllowed(payload, route) {
  if (!payload || !route || String(route.capability || "") !== "text_generation") return false;
  return Array.isArray(payload.allowed_model_routes) && payload.allowed_model_routes.some((allowed) =>
    allowed.provider_id === String(route.provider_id || "") &&
    allowed.account_id === String(route.account_id || "") &&
    allowed.model_id === String(route.model_id || "")
  );
}

export function validateMissionWonder2PwaScopePlan(payload, steps) {
  const list = Array.isArray(steps) ? steps : [];
  const maxSteps = Number(payload?.max_steps || 0);
  if (!payload || !list.length || list.length > maxSteps) return { ok: false, reason: "scope_plan_step_count_invalid" };
  const ids = list.map((step) => String(step?.id || ""));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return { ok: false, reason: "scope_plan_step_ids_invalid" };
  const known = new Set(ids);
  for (let index = 0; index < list.length; index += 1) {
    const step = list[index];
    if (!missionWonder2PwaScopeStepAllowed(payload, step)) return { ok: false, reason: "scope_plan_step_not_allowlisted:" + ids[index] };
    const dependencies = Array.isArray(step.depends_on) ? step.depends_on.map(String) : [];
    if (dependencies.some((id) => !known.has(id) || ids.indexOf(id) >= index)) {
      return { ok: false, reason: "scope_plan_dependency_invalid:" + ids[index] };
    }
    if (Number(step.max_attempts || payload.max_attempts) > Number(payload.max_attempts)) {
      return { ok: false, reason: "scope_plan_attempt_limit_exceeded:" + ids[index] };
    }
  }
  return { ok: true, step_count: list.length, max_attempts: Number(payload.max_attempts) };
}

export async function verifyMissionWonder2PwaMission(mission, secret, options = {}) {
  const metadata = mission?.metadata && typeof mission.metadata === "object" ? mission.metadata : {};
  const proof = metadata.mission_wonder_2_pwa_scope_proof;
  const status = metadata.mission_wonder_2_pwa_scope_status;
  if (status && status.status !== "active") return { ok: false, reason: "scope_not_active" };
  const result = await verifyMissionWonder2PwaScopeProof(proof, secret, {
    user_id: metadata.user_id ?? metadata.owner_user_id,
    project_id: metadata.project_id,
    request_id: metadata.request_id,
    mission_id: mission?.mission_id,
    goal_sha256: await sha256Hex(String(mission?.goal || "").trim())
  }, options);
  if (!result.ok) return result;
  return { ...result, scope_status: status?.status || "active" };
}

export const MISSION_WONDER_2_PWA_SCOPE_PURPOSE = PURPOSE;
export const MISSION_WONDER_2_PWA_SCOPE_ALLOWED_OPERATIONS = ALLOWED_OPERATIONS;
export const MISSION_WONDER_2_PWA_SCOPE_ALLOWED_MODEL_ROUTES = ALLOWED_MODEL_ROUTES;
export const MISSION_WONDER_2_PWA_SCOPE_MAX_TTL_MS = MAX_TTL_MS;
