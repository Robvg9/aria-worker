import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20261113160000_aria_m22_a6_durable_recovery_v1.sql', 'utf8');
const postgresContract = fs.readFileSync('.github/scripts/mission-wonder-2-a6-frozen-claim-postgres-v1.sql', 'utf8');
const agent = fs.readFileSync('agents/windows/aria-agent.js', 'utf8');
const watchdog = fs.readFileSync('agents/windows/run-agent.ps1', 'utf8');
const gateway = fs.readFileSync('supabase/functions/aria-device-gateway/index.ts', 'utf8');
const httpClient = fs.readFileSync('agents/windows/gateway-http-client.cjs', 'utf8');
const a6ScopeHelper = fs.readFileSync('supabase/functions/_shared/mission-wonder-2-a6-scope-v1.mjs', 'utf8');
const runner = fs.readFileSync('supabase/functions/aria-mission-runner-v22/index.ts', 'utf8');

// Keep the SQL checkpoint contract and the paused-runner allowlist in lockstep.
const recoveryCheckpointReason = 'a6_same_job_reclaimed_after_interruption';
assert.ok(migration.includes("'reason','" + recoveryCheckpointReason + "'"),
  'durable recovery SQL must persist the canonical checkpoint recovery reason');
assert.ok(a6ScopeHelper.includes('recovery.reason !== "' + recoveryCheckpointReason + '"'),
  'the A6 scope validator must accept only the canonical SQL checkpoint recovery reason');
assert.match(runner, /const planValid = await m22A6MissionPlanMatchesV1/,
  'the paused mission runner must await its durable recovery checkpoint validator');
assert.ok(runner.includes('current_step,completed_steps,total_steps'),
  'the A6 mission query must select every progress field checked by the frozen scope validator');
const androidWorkflow = fs.readFileSync('.github/workflows/rwht-android-apk.yml', 'utf8');

assert.match(migration, /mission_wonder_2_a6_recovery_gates/);
assert.match(migration, /status','recovering'/);
assert.match(migration, /r\.max_recovery_ms/);
assert.match(migration, /max_recovery_attempts/);
// The 24-hour LIVE soak must default to zero job recoveries. The disposable
// integration fixture opts into one recovery explicitly to test the mechanism.
assert.match(migration, /max_recovery_attempts smallint not null default 0/);
const armRunStart = migration.indexOf("create or replace function aria_internal.aria_m22_a6_arm_run_v1");
assert.ok(armRunStart >= 0, "durable recovery migration must update the production A6 arm function");
const armRunMigration = migration.slice(armRunStart);
assert.match(armRunMigration, /max_attempts,max_recovery_attempts,heartbeat_interval_ms/);
assert.match(armRunMigration, /'armed',24,5,5,1,1,p_heartbeat_interval_ms/);

assert.match(postgresContract, /max_attempts,max_recovery_attempts,heartbeat_interval_ms/);
assert.match(postgresContract, /v_device_id,'running',24,5,5,1,1,30000/);
assert.match(migration, /a6_claim_lease_expired_before_start/);
assert.match(migration, /job_lease_until/);
assert.match(migration, /coalesce\(j\.recovery_count,0\)<>\(/);
assert.match(migration, /d\.last_seen_at>v_now-/);
assert.match(migration, /v_now>=r\.started_at\+interval '24 hours'/);
assert.match(migration, /s\.expires_at<=v_now/);
assert.match(migration, /r\.started_at is null/);
assert.match(migration, /job\.recovered_a6_same_job/);
assert.match(migration, /new_job_created',false/);
assert.match(migration, /a6_requeue_job_id/);
assert.match(migration, /p_lease_owner/);
assert.match(migration, /job\.stale_lease_result_rejected/);
assert.match(postgresContract, /A6_TEST_FRESH_LEASE_START_FAILED/);
assert.match(postgresContract, /A6_TEST_FRESH_LEASE_COMPLETION_FAILED/);
assert.match(migration, /max_recovery_count<=r\.max_recovery_attempts/);
assert.match(migration, /max_heartbeat_age_ms<=r\.max_recovery_ms/);

assert.match(agent, /gateway-http-client\.cjs/);
assert.match(agent, /lease_owner:job\?\.lease_owner\|\|null/);
assert.match(agent, /mission_wonder_2_a6_attempt/);
assert.match(agent, /execution_lease_lost/);
assert.match(agent, /api\('\/v1\/jobs\/claim',\{method:'POST',body:JSON\.stringify\(\{device_id:DEVICE_ID\}\)\}\)/);
assert.match(gateway, /start_execution_job_gateway\(\$\{String\(args\.jobId\)\},\$\{String\(args\.deviceId\)\},\$\{typeof args\.leaseOwner/);
assert.match(gateway, /complete_execution_job_gateway\(/);
assert.match(gateway, /leaseOwner:typeof b\.lease_owner/);

assert.doesNotMatch(watchdog, /\$child\.WaitForExit\(\)/);
assert.match(watchdog, /\$DesktopTestTimeoutSeconds = 90/);
assert.match(watchdog, /DESKTOP_101_REQUEST_TIMEOUT/);
assert.match(httpClient, /incoming\.once\('aborted'/);
assert.match(httpClient, /incoming\.once\('close'/);
assert.match(httpClient, /requestTimeoutMs/);
assert.match(androidWorkflow, /!startsWith\(github\.head_ref, 'fix\/a6-'\)/, 'A6 PRs must not burn an Android APK build');
assert.doesNotMatch(androidWorkflow, /- \.github\/workflows\/rwht-android-apk\.yml/, 'workflow-only edits must not publish a new Android APK');
assert.match(androidWorkflow, /- android-ui-agent\/\*\*/, 'Android source changes must continue to trigger APK builds');

console.log('A6_DURABLE_HEARTBEAT_RECOVERY=PASS');
console.log('A6_SAME_JOB_IDEMPOTENT_RETRY=PASS');
console.log('A6_LEASE_OWNER_FENCING=PASS');
console.log('A6_WATCHDOG_NONBLOCKING_CHILD=PASS');
console.log('A6_DURABLE_RECOVERY_CONTRACT=PASS');
