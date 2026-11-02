import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseOpenRouterFreeDailyQuota,
  extractProviderUsage,
  parseQuotaReservation,
} from "../supabase/functions/aria-execution-runtime-v1/quota-accounting-v1.mjs";

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

console.log("ARIA atomic provider quota accounting contract: PASS");
