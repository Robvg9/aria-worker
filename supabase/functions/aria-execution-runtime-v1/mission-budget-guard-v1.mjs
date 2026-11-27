const REQUEST_KINDS = new Set(["execution", "test", "closure"]);
const SETTLEMENT_OUTCOMES = new Set(["succeeded", "failed", "unknown", "released"]);

const clean = value => typeof value === "string" ? value.trim() : "";

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

export function missionBudgetReserveArgs(context) {
  if (!context?.ok) throw new TypeError("mission_budget_context_required");
  return {
    p_mission_id: context.missionId,
    p_reservation_key: context.reservationKey,
    p_request_kind: context.requestKind,
    // No tokenizer or verified pre-call price source is currently wired.
    // NULL is deliberately unknown; policy ceilings for these dimensions fail closed.
    p_estimated_tokens: null,
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

export async function reserveMissionBudget(rpc, context) {
  if (typeof rpc !== "function") return { allowed: false, reason: "mission_budget_rpc_unavailable" };
  if (!context?.ok) return { allowed: false, reason: context?.reason || "mission_budget_mission_context_missing" };
  try {
    const { data, error } = await rpc(
      "mission_budget_reserve_request_v1",
      missionBudgetReserveArgs(context),
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
