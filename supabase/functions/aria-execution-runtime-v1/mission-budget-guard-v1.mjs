const REQUEST_KINDS = new Set(["execution", "test", "closure"]);
const SETTLEMENT_OUTCOMES = new Set(["succeeded", "failed", "unknown", "released"]);

const clean = value => typeof value === "string" ? value.trim() : "";

const TOKEN_BOUND_OUTPUT_LIMITS = Object.freeze({
  google: payload => payload?.generationConfig?.maxOutputTokens,
  openrouter: payload => payload?.max_completion_tokens ?? payload?.max_tokens,
  xai: payload => payload?.max_output_tokens ?? payload?.max_tokens,
});

export function estimateMissionTokenUpperBound(route, payload) {
  const provider = clean(route?.provider_id);
  const outputLimitReader = TOKEN_BOUND_OUTPUT_LIMITS[provider];
  if (!outputLimitReader || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { status: "unknown", reason: "mission_budget_token_bound_input_unavailable", estimatedTokens: null };
  }
  const outputTokens = outputLimitReader(payload);
  if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0) {
    return { status: "unknown", reason: "mission_budget_output_limit_unknown", estimatedTokens: null };
  }
  let serialized;
  try { serialized = JSON.stringify(payload); } catch {
    return { status: "unknown", reason: "mission_budget_payload_not_serializable", estimatedTokens: null };
  }
  if (typeof serialized !== "string") {
    return { status: "unknown", reason: "mission_budget_payload_not_serializable", estimatedTokens: null };
  }
  const inputBytes = new TextEncoder().encode(serialized).length;
  if (!Number.isSafeInteger(inputBytes) || inputBytes <= 0) {
    return { status: "unknown", reason: "mission_budget_input_size_unknown", estimatedTokens: null };
  }
  // A 2x UTF-8 byte allowance plus 256 framing tokens is intentionally
  // conservative. It is a preflight bound, not a tokenizer or observed usage.
  const estimatedTokens = inputBytes * 2 + outputTokens + 256;
  if (!Number.isSafeInteger(estimatedTokens)) {
    return { status: "unknown", reason: "mission_budget_token_bound_overflow", estimatedTokens: null };
  }
  return {
    status: "bounded_estimate",
    method: "utf8_payload_bytes_x2_plus_provider_output_limit_and_256_v1",
    inputBytes,
    outputTokens,
    estimatedTokens,
  };
}

export function createMissionBudgetContext({
  requestId,
  missionId,
  stepId,
  requestKind = "execution",
} = {}) {
  const reservationKey = clean(requestId);
  const mission = clean(missionId);
  const step = clean(stepId);
  if (!mission || !step || !reservationKey) {
    return { ok: false, reason: "mission_budget_mission_context_missing" };
  }
  if (reservationKey.length > 240 || !reservationKey.startsWith(mission + ":" + step + ":")) {
    return { ok: false, reason: "mission_budget_request_identity_invalid" };
  }
  if (!REQUEST_KINDS.has(requestKind)) {
    return { ok: false, reason: "mission_budget_request_kind_invalid" };
  }
  return Object.freeze({
    ok: true,
    missionId: mission,
    stepId: step,
    reservationKey,
    requestKind,
  });
}

export function missionBudgetReserveArgs(context, { estimatedTokens = null } = {}) {
  if (!context?.ok) throw new TypeError("mission_budget_context_required");
  const tokens = Number.isSafeInteger(estimatedTokens) && estimatedTokens > 0 ? estimatedTokens : null;
  return {
    p_mission_id: context.missionId,
    p_reservation_key: context.reservationKey,
    p_request_kind: context.requestKind,
    // Only a conservative preflight bound with an explicit provider output cap is stored.
    // Unknown token bounds and all unverified prices remain NULL.
    p_estimated_tokens: tokens,
    p_estimated_cost_amount: null,
    p_currency_code: null,
  };
}

export function missionBudgetSettlementArgs(context, {
  outcome,
  actualTokens = null,
  releaseEvidenceRef = null,
} = {}) {
  if (!context?.ok) throw new TypeError("mission_budget_context_required");
  if (!SETTLEMENT_OUTCOMES.has(outcome)) throw new TypeError("mission_budget_outcome_invalid");
  const evidence = clean(releaseEvidenceRef);
  if (outcome === "released" && !evidence) throw new TypeError("mission_budget_release_evidence_required");
  if (outcome !== "released" && evidence) throw new TypeError("mission_budget_release_evidence_not_applicable");
  const tokens = Number.isSafeInteger(actualTokens) && actualTokens >= 0 ? actualTokens : null;
  if (outcome === "released" && tokens !== null) throw new TypeError("mission_budget_release_cannot_report_usage");
  return {
    p_reservation_key: context.reservationKey,
    p_outcome: outcome,
    p_actual_tokens: tokens,
    p_actual_cost_amount: null,
    p_currency_code: null,
    p_release_evidence_ref: outcome === "released" ? evidence : null,
  };
}

export async function reserveMissionBudget(rpc, context, estimate = {}) {
  if (typeof rpc !== "function") return { allowed: false, reason: "mission_budget_rpc_unavailable" };
  if (!context?.ok) return { allowed: false, reason: context?.reason || "mission_budget_mission_context_missing" };
  try {
    const { data, error } = await rpc(
      "mission_budget_reserve_request_v1",
      missionBudgetReserveArgs(context, estimate),
    );
    if (error) return { allowed: false, reason: "mission_budget_reservation_unavailable" };
    if (data?.allowed === true && data?.reservation_key === context.reservationKey) {
      return { allowed: true, reservation_key: context.reservationKey, policy_id: data.policy_id || null };
    }
    const reason = typeof data?.reason === "string" && data.reason.startsWith("mission_budget_")
      ? data.reason
      : "mission_budget_reservation_denied";
    return { allowed: false, reason };
  } catch {
    return { allowed: false, reason: "mission_budget_reservation_unavailable" };
  }
}

export async function settleMissionBudget(rpc, context, settlement) {
  if (typeof rpc !== "function" || !context?.ok) return false;
  let args;
  try {
    args = missionBudgetSettlementArgs(context, settlement);
  } catch {
    return false;
  }
  try {
    const { data, error } = await rpc("mission_budget_settle_request_v1", args);
    return !error && data?.settled === true;
  } catch {
    return false;
  }
}

export function missionBudgetSettlementPending() {
  return {
    status: "blocked",
    error: {
      code: "mission_budget_settlement_pending",
      message: "Mission budget settlement could not be confirmed; fallback is forbidden.",
    },
  };
}

export function missionBudgetProviderOutcomeUnknown() {
  return {
    status: "blocked",
    reason: "mission_budget_provider_outcome_unknown",
    error: {
      code: "mission_budget_provider_outcome_unknown",
      message: "The provider may have accepted the request; its outcome is unknown. Fallback and retries are forbidden.",
    },
  };
}
