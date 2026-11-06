import assert from "node:assert/strict";
import fs from "node:fs";

const read = path => fs.readFileSync(path, "utf8");
const runner = read("supabase/functions/aria-mission-runner-v22/index.ts");
const canonical = read("supabase/functions/aria-canonical-runtime-v1/index.ts");
const runtimeGateway = read("supabase/functions/aria-runtime-gateway-v1/index.ts");
const deviceGateway = read("supabase/functions/aria-device-gateway/index.ts");
const intake = read("supabase/functions/aria-mission-intake-v1/index.ts");
const dispatcher = read("supabase/functions/aria-mission-wonder-2-a6-dispatch-v1/index.ts");
const helper = read("supabase/functions/_shared/mission-wonder-2-a6-scope-v1.mjs");
const migration = read(".github/scripts/mission-wonder-2-step6-a6-isolated-scope-v1.sql");
const deploy = read(".github/workflows/supabase-canonical-deploy.yml");
const pwaDeploy = read(".github/workflows/aria-pwa-fast-deploy.yml");
const cloudflareDeploy = read(".github/workflows/aria-cloudflare-deploy.yml");

for (const [name, source] of Object.entries({ runner, canonical, runtimeGateway, deviceGateway, intake })) {
  assert.match(source, /MISSION_EXECUTION_PAUSED\s*=\s*true/, name + " must preserve global execution freeze");
}
assert.match(dispatcher, /aria_autonomy_cron_authorize/);
assert.match(dispatcher, /x-aria-autonomy-token/);
assert.match(dispatcher, /aria_m22_a6_reconcile_v1/);
assert.match(dispatcher, /aria_m22_a6_sample_runtime_v1/);
assert.match(dispatcher, /aria_m22_a6_claim_due_scope_v1/);
assert.match(dispatcher, /aria_m22_a6_materialize_due_mission_v1/);
assert.match(dispatcher, /aria-canonical-runtime-v1/);
assert.match(dispatcher, /mission-tick/);
assert.match(dispatcher, /runtimePayload\.ok !== true/);
assert.match(dispatcher, /a6_canonical_runtime_did_not_enqueue_exact_scoped_job/);
assert.match(dispatcher, /exactJobReadback: true/);
assert.doesNotMatch(dispatcher, /aria_m22_a6_start_run_v1|cron\.schedule|cron\.job/);

assert.match(runner, /m22A6ScopeRowMatchesV1/);
assert.match(runner, /m22A6MissionPlanMatchesV1/);
assert.match(runner, /aria_m22_a6_enqueue_frozen_job_v1/);
assert.match(runner, /!a6ScopeRow/);
assert.match(canonical, /m22A6ScopeRowMatchesV1/);
assert.match(deviceGateway, /aria_m22_a6_has_claimable_job_v1/);
assert.match(deviceGateway, /aria_m22_a6_claim_frozen_job_v1/);
assert.match(deviceGateway, /aria_m22_a6_frozen_job_authorized_v1/);
assert.match(migration, /left\(p_mission_id,15\)='mission_m22_a6_'/);
assert.match(migration, /aria_m22_a6_frozen_job_authorized_v1\(p_job_id,v_device_id,v_job_status\)/);
assert.match(deviceGateway, /execution_enabled:false[\s\S]{0,100}423/);
assert.match(runtimeGateway, /MISSION_EXECUTION_PAUSED&&\["vision_sync","self_improve","enqueue_device_job"\]/);
assert.match(helper, /m22A6MissionPlanMatchesV1/);

for (const rpc of [
  "aria_m22_a6_materialize_due_mission_v1",
  "aria_m22_a6_enqueue_frozen_job_v1",
  "aria_m22_a6_sample_runtime_v1",
  "aria_m22_a6_reconcile_v1",
  "aria_m22_a6_block_run_v1",
]) assert.ok(migration.includes("create or replace function aria_internal." + rpc + "("), rpc + " migration RPC missing");
assert.match(migration, /cron\.schedule\([\s\S]*aria-mission-wonder-2-a6-dispatcher-every-minute/);
assert.match(migration, /update cron\.job set active=false where jobid=v_job_id/);
assert.match(migration, /heartbeatAgeMs/);
assert.match(migration, /heartbeat_continuity_threshold_exceeded/);
assert.match(migration, /heartbeat_sample_count>=1368/);
assert.match(migration, /max_heartbeat_age_ms<=r\.max_normal_heartbeat_gap_ms/);
assert.match(migration, /max_sample_gap_ms<=r\.max_normal_heartbeat_gap_ms/);
assert.match(migration, /percentile_cont\(0\.95\)/);
assert.match(migration, /max_recovery_count=0/);
assert.match(migration, /max_a6_pending_jobs<=1/);
assert.match(migration, /max_a6_oldest_pending_age_ms<=300000/);
assert.match(migration, /active_job\.status in \('queued','claimed','running'\)/);
assert.match(migration, /a6_backlog_threshold_exceeded/);
assert.match(migration, /r\.job_status in \('failed','timeout','cancelled'\)/);
assert.match(migration, /job_count=5/);
assert.match(deploy, /supabase functions deploy aria-mission-wonder-2-a6-dispatch-v1/);
assert.match(pwaDeploy, /'supabase\/functions\/aria-mission-wonder-2-a6-dispatch-v1\/\*\*'/);
assert.match(pwaDeploy, /'supabase\/migrations\/\*_aria_mission_wonder_2_a6_isolated_scope_v1\.sql'/);
assert.match(cloudflareDeploy, /'supabase\/functions\/\*\*'/);
assert.match(cloudflareDeploy, /'supabase\/migrations\/\*_aria_mission_wonder_2_a6_isolated_scope_v1\.sql'/);

console.log("MISSION_WONDER_2_STEP6_A6_RUNTIME_WIRING=PASS");
console.log("MISSION_WONDER_2_STEP6_A6_GLOBAL_FREEZE=PASS");
console.log("MISSION_WONDER_2_STEP6_A6_DEPLOY_ISOLATION=PASS");
