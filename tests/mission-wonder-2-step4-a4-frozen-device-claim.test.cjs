const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261106014500_a4_frozen_single_job_gateway_claim_v1.sql"), "utf8");
const gateway = fs.readFileSync(path.join(root, "supabase/functions/aria-device-gateway/index.ts"), "utf8");

for (const marker of [
  "aria_m22_a4_frozen_job_authorized_v1(",
  "aria_m22_a4_claim_frozen_one_shot_job_v1(",
  "mission_job_authorization_allowed(",
  "mission_a4_authorized_once",
  "uo_mission_a4_authorized_once_a4_readonly_utc_clock_probe_a1_da6b3354e92efcbb",
  "windows-fe722cc6681e4f9c9cc35f5ebbb0a089",
  "a4-recovery-42110933267.1",
  "a4-recovery-42110933267.1:tick",
  "a4-recovery-42110933267.1:runner-handoff-retry",
  "42131077740",
  "mission-wonder-2-step4-a4:single-authorized-execution",
  "waiting_for_async_executor",
  "a4_readonly_utc_clock_probe",
  "[DateTime]::UtcNow.ToString(''o'')",
  "interval '180 seconds'",
  "job.claimed_a4_one_shot",
  "scope.status <> 'bound'",
  "v_scope.expires_at <= clock_timestamp()",
  "runner_handoff_retry_count",
  "global_execution_freeze_preserved",
]) assert.ok(migration.includes(marker), "frozen A4 migration must enforce: " + marker);

assert.match(migration, /revoke all on function aria_internal\.aria_m22_a4_frozen_job_authorized_v1\(text,text,text\) from public,anon,authenticated;/);
assert.match(migration, /revoke all on function aria_internal\.aria_m22_a4_claim_frozen_one_shot_job_v1\(text\) from public,anon,authenticated;/);
assert.match(migration, /grant execute on function aria_internal\.aria_m22_a4_frozen_job_authorized_v1\(text,text,text\) to service_role;/);
assert.match(migration, /grant execute on function aria_internal\.aria_m22_a4_claim_frozen_one_shot_job_v1\(text\) to service_role;/);
assert.doesNotMatch(migration, /MISSION_EXECUTION_PAUSED\s*=\s*false/i);
assert.doesNotMatch(migration, /insert into aria_internal\.(mission_state|mission_wonder_2_a4_scopes)/i);

assert.match(gateway, /const MISSION_EXECUTION_PAUSED = true;/);
assert.match(gateway, /const A4_FROZEN_JOB_ID='uo_mission_a4_authorized_once_a4_readonly_utc_clock_probe_a1_da6b3354e92efcbb'/);
assert.match(gateway, /const A4_FROZEN_DEVICE_ID='windows-fe722cc6681e4f9c9cc35f5ebbb0a089'/);
assert.match(gateway, /async function a4FrozenJobAuthorizedV1/);
assert.match(gateway, /preauthenticatedDevice=authenticated\.device/);
assert.match(gateway, /p_required_status:requiredStatus/);
assert.match(gateway, /aria_m22_a4_claim_frozen_one_shot_job_v1/);
assert.match(gateway, /scope:'a4-one-shot-only'/);
assert.match(gateway, /PAUSED_MISSION_ENDPOINTS\.has\(p\)\|\|PAUSED_MISSION_JOB_ROUTES\.test\(p\)/);
assert.match(gateway, /if\(MISSION_EXECUTION_PAUSED\)\{if\(d\.device_id!==A4_FROZEN_DEVICE_ID\|\|!preauthenticatedDevice\)/);
assert.match(gateway, /executionJobGatewayCall\('claim',\{deviceId:d\.device_id\}\)/);
assert.doesNotMatch(gateway, /MISSION_EXECUTION_PAUSED\s*=\s*false/i);

console.log("mission-wonder-2-step4-a4-frozen-device-claim contract: PASS");
