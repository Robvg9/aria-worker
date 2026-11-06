const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const migration = read("supabase/migrations/20261105235800_a4_runner_handoff_retry_v1.sql");
const scopeResumeMigration = read("supabase/migrations/20261106011000_a4_handoff_expired_scope_resume_v1.sql");
const script = read("scripts/mission-wonder-2-step4-a4-runner-handoff-retry.mjs");
const workflow = read(".github/workflows/mission-wonder-2-step4-a4-runner-handoff-recovery.yml");

assert.match(migration, /create or replace function aria_internal\.aria_m22_a4_claim_runner_handoff_retry_v1\(/);
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path to 'pg_catalog', 'aria_internal'/);
assert.match(migration, /mission_a4_authorized_once/);
assert.match(migration, /mission-wonder-2-step4-a4:single-authorized-execution/);
assert.match(migration, /p_failed_run_id.*<> '42131077740'/);
assert.match(migration, /p_runner_http_status IS DISTINCT FROM 401/);
assert.match(migration, /mission_wonder_2_a4_allowed_device_id',''\) <> v_scope\.allowed_device_id/);
assert.match(migration, /tick_claimed','false'\) <> 'true'/);
assert.match(migration, /tick_claim_ref',''\) <> btrim\(p_grant_ref\) \|\| ':tick'/);
assert.match(migration, /scope_resume_count','0'\) <> '1'/);
assert.match(migration, /runner_handoff_retry_count','0'\) <> '0'/);
assert.match(migration, /from aria_internal\.execution_jobs[\s\S]*?if v_jobs <> 0 then/);
assert.match(migration, /last_seen_at > clock_timestamp\(\) - interval '180 seconds'/);
assert.match(migration, /runner_handoff_retry_count',1/);
assert.match(migration, /runner_handoff_retry_claimed/);
assert.match(migration, /revoke all on function aria_internal\.aria_m22_a4_claim_runner_handoff_retry_v1/);
assert.match(migration, /grant execute on function aria_internal\.aria_m22_a4_claim_runner_handoff_retry_v1[\s\S]*to service_role/);
assert.doesNotMatch(migration, /insert into aria_internal\.(mission_state|mission_wonder_2_a4_scopes|execution_jobs)/i);
assert.doesNotMatch(migration, /MISSION_EXECUTION_PAUSED\s*=\s*false/i);

assert.equal((script.match(/fetch\(RUNNER_URL/g) || []).length, 2,
  "script must perform one harmless auth probe and at most one mission handoff");
assert.match(script, /body: "\{\}"/, "auth probe must carry no mission id");
assert.match(script, /probe\.status === 423/, "auth probe must confirm the A4/global-freeze gate before the one-time DB write");
assert.match(scopeResumeMigration, /scope_expired_outside_continuation_window/);
assert.match(scopeResumeMigration, /interval '2 hours'/);
assert.match(scopeResumeMigration, /interval '45 minutes'/);
assert.match(scopeResumeMigration, /runner_handoff_scope_resume_count',1/);
assert.match(scopeResumeMigration, /runner_handoff_scope_resume_already_used/);
assert.match(scopeResumeMigration, /scope_window_renewed/);
assert.match(scopeResumeMigration, /raise exception 'aria_m22_a4_handoff_scope_resume_race/);
assert.doesNotMatch(scopeResumeMigration, /insert into aria_internal\\.(mission_state|mission_wonder_2_a4_scopes|execution_jobs)/i);
assert.match(script, /scope_expired_outside_one_time_continuation_window/);
assert.match(script, /Date\.now\(\) - 2 \* 60 \* 60 \* 1000/);
assert.match(script, /runner_handoff_retry_claimed/);
assert.match(script, /FAILED_RUN_ID = "42131077740"/);
assert.match(script, /RUNNER_HTTP_STATUS = 401/);
assert.match(script, /mission_a4_authorized_once/);
assert.match(script, /api-keys\?reveal=true/);
assert.match(script, /runnerResponse\.status/);
assert.match(script, /refresh_token/);
assert.match(script, /pwa_readback/);
assert.match(script, /mission_verified/);
assert.match(script, /meditation_notifications/);
assert.match(script, /scope_status/);
assert.doesNotMatch(script, /aria_m22_a4_claim_recovery_tick_v1/,
  "continuation must reuse the already-consumed tick claim; it must never claim a second tick");
assert.doesNotMatch(script, /MISSION_EXECUTION_PAUSED\s*=\s*false/i);

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /workflow_run:|schedule:|push:/);
assert.match(workflow, /execute_runner_handoff_retry/);
assert.match(workflow, /environment: production/);
assert.match(workflow, /SUPABASE_ACCESS_TOKEN/);
assert.match(workflow, /ARIA_RUNTIME_SHARED_SECRET/);
assert.match(workflow, /node scripts\/mission-wonder-2-step4-a4-runner-handoff-retry\.mjs/);
assert.doesNotMatch(workflow, /workflow_run:|schedule:/);

console.log("mission-wonder-2-step4-a4-runner-handoff-retry contract: PASS");
