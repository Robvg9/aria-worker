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
const telemetryMigration = await readFile(
  new URL("../supabase/migrations/20261125190000_aria_provider_usage_observability_v1.sql", import.meta.url),
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
  { prompt_tokens: 31, completion_tokens: 11, total_tokens: 42, cached_input_tokens: null },
);
assert.deepEqual(
  extractProviderUsage({ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 } }),
  { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, cached_input_tokens: null },
);
assert.deepEqual(
  extractProviderUsage({ usage: { prompt_tokens: 3, completion_tokens: 4 } }),
  { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7, cached_input_tokens: null },
);
assert.deepEqual(
  extractProviderUsage({ usage: { prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 6 } } }),
  { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cached_input_tokens: 6 },
);
assert.deepEqual(
  extractProviderUsage({ usage: { input_tokens: 10, output_tokens: 3, input_tokens_details: { cached_tokens: 4 } } }),
  { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13, cached_input_tokens: 4 },
);
assert.deepEqual(
  extractProviderUsage({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, cachedContentTokenCount: 7 } }),
  { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cached_input_tokens: 7 },
);
assert.deepEqual(
  extractProviderUsage({ usage: { cached_input_tokens: "6" } }),
  { prompt_tokens: null, completion_tokens: null, total_tokens: null, cached_input_tokens: null },
);
assert.deepEqual(
  extractProviderUsage({}),
  { prompt_tokens: null, completion_tokens: null, total_tokens: null, cached_input_tokens: null },
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
assert.ok(runtime.includes("quota_reserve_model_request_v1"), "baseline runtime migration contract");

for (const fragment of [
  "ADD COLUMN IF NOT EXISTS cached_input_tokens",
  "ADD COLUMN IF NOT EXISTS observed_remaining_requests",
  "quota_reserve_model_request_v2",
  "quota_settle_model_request_v2",
  "provider_execution_observability_v1",
  "provider_quota_capacity_v1",
  "REVOKE ALL ON aria_internal.provider_execution_observability_v1 FROM PUBLIC, anon, authenticated",
  "GRANT SELECT ON aria_internal.provider_quota_capacity_v1 TO service_role",
  "reservation_to_settlement_ms",
]) {
  assert.ok(telemetryMigration.includes(fragment), "telemetry migration missing: " + fragment);
}

assert.ok(runtime.includes("quota_reserve_model_request_v2"), "runtime must record provider remaining snapshots");
assert.ok(runtime.includes("quota_settle_model_request_v2"), "runtime must settle cached token usage");
assert.ok(runtime.includes("p_provider_remaining:providerRemaining"), "runtime must persist provider reported remaining");
assert.ok(runtime.includes("p_cached_input_tokens:usage.cached_input_tokens"), "runtime must persist cached input tokens");
assert.ok(runtime.includes("const MISSION_EXECUTION_PAUSED = true"), "global mission execution freeze must stay enabled");

console.log("ARIA atomic provider quota accounting contract: PASS");
console.log("ARIA provider usage observability v1 contract: PASS");
console.log("ARIA provider-reported cached token extraction: PASS");
console.log("ARIA provider quota snapshot source/timestamp contract: PASS");
