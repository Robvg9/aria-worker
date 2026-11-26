import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseOpenRouterFreeDailyQuota,
  extractProviderUsage,
  parseQuotaReservation,
} from "../supabase/functions/aria-execution-runtime-v1/quota-accounting-v1.mjs";
import {
  createMissionBudgetContext,
  missionBudgetReserveArgs,
  missionBudgetSettlementArgs,
  reserveMissionBudget,
  settleMissionBudget,
  missionBudgetSettlementPending,
} from "../supabase/functions/aria-execution-runtime-v1/mission-budget-guard-v1.mjs";

const migration = await readFile(
  new URL("../supabase/migrations/20261102000000_aria_atomic_provider_quota_accounting_v1.sql", import.meta.url),
  "utf8",
);
const runtime = await readFile(
  new URL("../supabase/functions/aria-execution-runtime-v1/index.ts", import.meta.url),
  "utf8",
);

const valid = parseOpenRouterFreeDailyQuota({
  data: { free_model_daily_requests: { used: 12, limit: 50, remaining: 38 } },
});
assert.deepEqual(valid, { used: 12, limit: 50, remaining: 38 });
assert.deepEqual(
  parseOpenRouterFreeDailyQuota({ data: { free_model_daily_requests: { used: 0, limit: 50, remaining: 50 } } }),
  { used: 0, limit: 50, remaining: 50 },
);
for (const bad of [
  null,
  {},
  { data: {} },
  { data: { free_model_daily_requests: { used: null, limit: 50, remaining: 50 } } },
  { data: { free_model_daily_requests: { used: 51, limit: 50, remaining: 0 } } },
  { data: { free_model_daily_requests: { used: 0, limit: 0, remaining: 0 } } },
  { data: { free_model_daily_requests: { used: 0, limit: 50, remaining: -1 } } },
  { data: { free_model_daily_requests: { used: "0", limit: 50, remaining: 50 } } },
]) {
  assert.equal(parseOpenRouterFreeDailyQuota(bad), null);
}

assert.deepEqual(
  extractProviderUsage({ usage: { prompt_tokens: 31, completion_tokens: 11, total_tokens: 42 } }),
  { prompt_tokens: 31, completion_tokens: 11, total_tokens: 42 },
);
assert.deepEqual(
  extractProviderUsage({ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 } }),
  { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
);
assert.deepEqual(
  extractProviderUsage({ usage: { prompt_tokens: 3, completion_tokens: 4 } }),
  { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
);
assert.deepEqual(
  extractProviderUsage({}),
  { prompt_tokens: null, completion_tokens: null, total_tokens: null },
);
assert.deepEqual(
  parseQuotaReservation({ allowed: true, reservation_key: "mission:step:request" }),
  { allowed: true, reservation_key: "mission:step:request" },
);
assert.deepEqual(
  parseQuotaReservation({ allowed: false, reason: "account_free_daily_quota_exhausted" }),
  { allowed: false, reason: "account_free_daily_quota_exhausted" },
);
assert.deepEqual(parseQuotaReservation({ allowed: true }), {
  allowed: false,
  reason: "quota_reservation_denied",
});

for (const fragment of [
  "CREATE TABLE IF NOT EXISTS aria_internal.quota_request_reservations_v1",
  "FOR UPDATE",
  "ON CONFLICT (reservation_key) DO NOTHING",
  "quota_reserve_model_request_v1",
  "quota_settle_model_request_v1",
  "SET search_path = ''",
  "REVOKE ALL ON TABLE aria_internal.quota_request_reservations_v1 FROM PUBLIC, anon, authenticated, service_role",
  "GRANT EXECUTE ON FUNCTION aria_internal.quota_reserve_model_request_v1",
  "GET /api/v1/key data.free_model_daily_requests",
  "historical:mission_wonder_2_gate3_probe_41388796601_1",
  "mission_wonder_2_gate3_probe_41388796601_1",
]) {
  assert.ok(migration.includes(fragment), "migration missing: " + fragment);
}
assert.ok(runtime.includes("quota_reserve_model_request_v1"), "runtime must reserve before provider inference");
assert.ok(runtime.includes("quota_settle_model_request_v1"), "runtime must settle provider usage");
assert.ok(runtime.includes("parseOpenRouterFreeDailyQuota"), "runtime must read authoritative OpenRouter daily quota");
assert.ok(runtime.includes('route.provider_id==="mistral"'), "permanently excluded Mistral route must be blocked");
assert.ok(runtime.includes("const MISSION_EXECUTION_PAUSED = true"), "global mission execution freeze must stay enabled");


const budgetContext = createMissionBudgetContext({
  requestId: "mission-123:step-7:request-abc",
  missionId: "mission-123",
  stepId: "step-7",
});
assert.equal(budgetContext.ok, true);
assert.deepEqual(missionBudgetReserveArgs(budgetContext), {
  p_mission_id: "mission-123",
  p_reservation_key: "mission-123:step-7:request-abc",
  p_request_kind: "execution",
  p_estimated_tokens: null,
  p_estimated_cost_amount: null,
  p_currency_code: null,
});
assert.equal(
  createMissionBudgetContext({ requestId: "request-only" }).reason,
  "mission_budget_mission_context_missing",
);
assert.equal(
  createMissionBudgetContext({
    requestId: "another-mission:step-7:request-abc",
    missionId: "mission-123",
    stepId: "step-7",
  }).reason,
  "mission_budget_request_identity_invalid",
);
assert.equal(
  createMissionBudgetContext({
    requestId: "mission-123:step-7:request-abc",
    missionId: "mission-123",
    stepId: "step-7",
    requestKind: "owner-approved-test",
  }).reason,
  "mission_budget_request_kind_invalid",
);
assert.equal(
  createMissionBudgetContext({
    requestId: "mission-123:step-7:request-abc",
    missionId: "mission-123",
    stepId: "step-7",
    requestKind: "test",
  }).requestKind,
  "test",
);

assert.deepEqual(missionBudgetSettlementArgs(budgetContext, {
  outcome: "succeeded",
  actualTokens: 41,
}), {
  p_reservation_key: "mission-123:step-7:request-abc",
  p_outcome: "succeeded",
  p_actual_tokens: 41,
  p_actual_cost_amount: null,
  p_currency_code: null,
  p_release_evidence_ref: null,
});
assert.throws(
  () => missionBudgetSettlementArgs(budgetContext, { outcome: "released" }),
  /mission_budget_release_evidence_required/,
);
assert.throws(
  () => missionBudgetSettlementArgs(budgetContext, {
    outcome: "released",
    actualTokens: 1,
    releaseEvidenceRef: "no-provider-request",
  }),
  /mission_budget_release_cannot_report_usage/,
);
assert.equal(
  missionBudgetSettlementArgs(budgetContext, {
    outcome: "unknown",
    actualTokens: null,
  }).p_actual_tokens,
  null,
);
assert.deepEqual(missionBudgetSettlementPending(), {
  status: "blocked",
  error: {
    code: "mission_budget_settlement_pending",
    message: "Mission budget settlement could not be confirmed; fallback is forbidden.",
  },
});

const budgetRpcCalls = [];
const approvedBudget = await reserveMissionBudget(async (name, args) => {
  budgetRpcCalls.push({ name, args });
  return { data: { allowed: true, reservation_key: args.p_reservation_key, policy_id: "policy-test" }, error: null };
}, budgetContext);
assert.equal(approvedBudget.allowed, true);
assert.equal(budgetRpcCalls.length, 1);
assert.equal(budgetRpcCalls[0].name, "mission_budget_reserve_request_v1");
assert.equal(budgetRpcCalls[0].args.p_estimated_tokens, null);
assert.equal(budgetRpcCalls[0].args.p_estimated_cost_amount, null);

const deniedBudget = await reserveMissionBudget(async () => ({
  data: { allowed: false, reason: "mission_budget_policy_missing" },
  error: null,
}), budgetContext);
assert.deepEqual(deniedBudget, { allowed: false, reason: "mission_budget_policy_missing" });
const rpcUnavailable = await reserveMissionBudget(async () => ({
  data: null,
  error: new Error("database unavailable"),
}), budgetContext);
assert.deepEqual(rpcUnavailable, { allowed: false, reason: "mission_budget_reservation_unavailable" });

let settledArgs = null;
const settledBudget = await settleMissionBudget(async (name, args) => {
  assert.equal(name, "mission_budget_settle_request_v1");
  settledArgs = args;
  return { data: { settled: true }, error: null };
}, budgetContext, { outcome: "unknown" });
assert.equal(settledBudget, true);
assert.equal(settledArgs.p_outcome, "unknown");
assert.equal(settledArgs.p_actual_tokens, null);
assert.equal(settledArgs.p_release_evidence_ref, null);

let releasedArgs = null;
const releasedBudget = await settleMissionBudget(async (name, args) => {
  releasedArgs = args;
  return { data: { settled: true }, error: null };
}, budgetContext, {
  outcome: "released",
  releaseEvidenceRef: "aria-execution-runtime-v1:provider-quota-denied:mission-123:step-7",
});
assert.equal(releasedBudget, true);
assert.equal(releasedArgs.p_outcome, "released");
assert.equal(releasedArgs.p_release_evidence_ref, "aria-execution-runtime-v1:provider-quota-denied:mission-123:step-7");

const pendingSettlement = await settleMissionBudget(async () => ({
  data: { settled: false, reason: "reservation_already_settled" },
  error: null,
}), budgetContext, { outcome: "succeeded", actualTokens: 41 });
assert.equal(pendingSettlement, false);


const providerCallsites = [
  ["directGemini", "https://generativelanguage.googleapis.com/v1beta/models/"],
  ["xaiResponses", "https://api.x.ai/v1/responses"],
  ["openRouterChat", "https://openrouter.ai/api/v1/chat/completions"],
];
for (const [name, endpoint] of providerCallsites) {
  const start = runtime.indexOf("async function " + name + "(");
  assert.notEqual(start, -1, "runtime provider adapter missing: " + name);
  const next = runtime.indexOf("\nasync function ", start + 20);
  const end = next === -1 ? runtime.length : next;
  const adapter = runtime.slice(start, end);
  assert.ok(adapter.includes("reserveProviderCall(route,requestId,budgetContext"), name + " must reserve mission budget before provider call");
  assert.ok(adapter.includes("settleProviderAttempt(reservationKey,budgetContext,\"unknown\""), name + " must retain UNKNOWN outcomes");
  assert.ok(adapter.includes("settleProviderAttempt(reservationKey,budgetContext,\"failed\""), name + " must settle failed provider outcomes");
  assert.ok(adapter.includes("settleProviderAttempt(reservationKey,budgetContext,\"succeeded\""), name + " must settle successful provider outcomes");
  const reserveIndex = adapter.indexOf("reserveProviderCall(route,requestId,budgetContext");
  const fetchIndex = adapter.indexOf(endpoint);
  assert.ok(fetchIndex > reserveIndex, name + " must reserve before inference HTTP request");
}
const reserveWrapper = runtime.slice(runtime.indexOf("async function reserveProviderCall("), runtime.indexOf("\nasync function directGemini("));
assert.ok(
  reserveWrapper.indexOf("reserveMissionBudget(missionBudgetRpc,budgetContext)") <
    reserveWrapper.indexOf("reserveModelQuota(route,requestId"),
  "mission budget reservation must precede provider quota reservation",
);
assert.ok(reserveWrapper.includes("settleMissionBudgetAttempt(budgetContext,\"released\",null,evidence)"), "provider quota denial must release only before inference");
assert.ok(runtime.includes("const budgetExempt=conversationOnlyAllowed||cloudflarePlanPreviewAllowed"), "only validated conversation/plan-preview routes are exempt");
assert.ok(runtime.includes("requestKind:gate3ScopedProbeAllowed?\"test\":\"execution\""), "test reserve classification must be derived from validated server-side scope");
assert.ok(runtime.includes("mission_budget_mission_context_missing"), "ordinary provider calls without mission identity must fail closed");
assert.ok(runtime.includes("if(!settlement.budgetSettled)return out(missionBudgetSettlementPending(),503)"), "uncertain settlement must not return provider output");
assert.ok(runtime.includes("const MISSION_EXECUTION_PAUSED = true"), "global mission execution freeze must stay enabled");

console.log("ARIA atomic provider quota accounting contract: PASS");
