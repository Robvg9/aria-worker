import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261110213000_aria_m22_a6_edge_outage_resilient_heartbeat_v1.sql", import.meta.url),
  "utf8",
);
const edge = readFileSync(
  new URL("../supabase/functions/aria-cron-auth-v1/index.ts", import.meta.url),
  "utf8",
);

assert.match(migration, /aria_m22_a6_dispatch_tick_v1/);
assert.match(migration, /aria_m22_a6_sample_runtime_v1\(\)/);
assert.match(migration, /net\._http_response/);
assert.match(migration, /dispatch_http_request/);
assert.match(migration, /dispatch_http_result/);
assert.match(migration, /response_missing_timeout/);
assert.match(migration, /edge_5xx/);
assert.match(migration, /consecutive_http_failures',5/);
assert.match(migration, /automatic_retry',false/);
assert.match(migration, /cron\.alter_job/);
assert.match(migration, /a6_cron_must_remain_inactive_during_migration/);
assert.doesNotMatch(edge, /aria_m22_a6_sample_runtime_v1/);
assert.match(edge, /heartbeat_sampled_by_database_cron/);
assert.match(edge, /automatic_retry: false/);

console.log("A6_EDGE_OUTAGE_RESILIENCE_CONTRACT=PASS");
