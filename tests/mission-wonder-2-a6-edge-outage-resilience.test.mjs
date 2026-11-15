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
assert.match(migration, /consecutive_dispatch_failures',5/);
assert.match(migration, /automatic_retry',false/);
assert.match(migration, /cron\.alter_job/);
assert.match(migration, /a6_cron_must_remain_inactive_during_migration/);
assert.doesNotMatch(edge, /aria_m22_a6_sample_runtime_v1/);
assert.match(edge, /heartbeat_sampled_by_database_cron/);
assert.match(edge, /automatic_retry: false/);

assert.match(migration, /'event','dispatch_enqueue_failed'/);
assert.match(migration, /'heartbeat_preserved',true/);
assert.match(migration, /'status','sampled_dispatch_failed'/);
assert.ok(migration.indexOf('v_sample := aria_internal.aria_m22_a6_sample_runtime_v1()') < migration.indexOf('exception when others then'));
assert.ok(migration.indexOf('exception when others then') < migration.indexOf("'event','dispatch_enqueue_failed'"));

assert.ok(migration.includes('exception when others then'));
assert.ok(migration.includes('v_dispatch_error := sqlstate'));
assert.ok(migration.indexOf("v_sample := aria_internal.aria_m22_a6_sample_runtime_v1()") < migration.indexOf("exception when others then"));
assert.ok(migration.indexOf("exception when others then") < migration.indexOf("dispatch_enqueue_failed"));
console.log("A6_EDGE_OUTAGE_RESILIENCE_CONTRACT=PASS");
assert.match(migration, /'outcome','enqueue_failed'/);
assert.match(migration, /consecutive_dispatch_failures',5/);
assert.ok(migration.includes("where status='running'"));

const pendingResolution = migration.indexOf("-- Evaluate the last five outcomes only after resolving all available HTTP responses.");
const pendingLoop = migration.indexOf("for v_pending in");
const circuitBreaker = migration.indexOf("consecutive_dispatch_failures',5");
assert.ok(pendingResolution > pendingLoop && circuitBreaker > pendingResolution, "circuit breaker must evaluate after pending HTTP responses");
