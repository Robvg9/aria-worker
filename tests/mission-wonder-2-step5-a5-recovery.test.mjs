import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  M22_A5_SCOPE_ID, M22_A5_MISSION_ID, M22_A5_SCOPE_KEY, M22_A5_STEP_ID,
  M22_A5_ARTIFACT_PATH, M22_A5_MARKER,
  m22A5GoalIdentityHashV1, m22A5ExpectedJobIdV1,
  m22A5BuildRecoveryProbeStepV1, m22A5RecoveryProbeStepMatchesV1,
  m22A5ScopeRowMatchesV1,
} from "../supabase/functions/_shared/mission-wonder-2-a5-scope-v1.mjs";

globalThis.crypto ??= webcrypto;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read("supabase/migrations/20261106030000_aria_mission_wonder_2_a5_bounded_recovery_v1.sql");
const appApi = read("supabase/functions/aria-app-api-v3/index.ts");
const direct = read("supabase/functions/aria-direct-v1/index.ts");
const intake = read("supabase/functions/aria-mission-intake-v1/index.ts");
const canonical = read("supabase/functions/aria-canonical-runtime-v1/index.ts");
const runner = read("supabase/functions/aria-mission-runner-v22/index.ts");
const gateway = read("supabase/functions/aria-device-gateway/index.ts");
const agent = read("agents/windows/aria-agent.js");
const shellExecutor = read("autonomy/windows-shell-executor.js");
const pilotWorkflow = read(".github/workflows/mission-wonder-2-step5-a5-live-pilot.yml");
const pilotScript = read("rwht/pc-browser/mission-wonder-2-step5-a5-live-pilot.mjs");

const DEVICE = "windows-fe722cc6681e4f9c9cc35f5ebbb0a089";
const OWNER = "a5-owner-user";
const REQUEST = "a5-request-0001";
const GOAL = "Mission Wonder 2 A5 controlled recovery";
const GOAL_HASH = await m22A5GoalIdentityHashV1(OWNER, GOAL, null);
const JOB_ID = await m22A5ExpectedJobIdV1();

assert.equal(M22_A5_SCOPE_ID, "mission_wonder_2_a5_authorized_once");
assert.equal(M22_A5_MISSION_ID, "mission_a5_authorized_once");
assert.equal(M22_A5_SCOPE_KEY, "mission-wonder-2-step5-a5:single-authorized-recovery");
assert.equal(M22_A5_STEP_ID, "a5_idempotent_recovery_marker");
assert.equal(JOB_ID, "uo_mission_a5_authorized_once_a5_idempotent_recovery_marke_a1_b5d6865a66a4def1");
assert.equal(await m22A5ExpectedJobIdV1("mission_a4_authorized_once", "a4_readonly_utc_clock_probe"),
  "uo_mission_a4_authorized_once_a4_readonly_utc_clock_probe_a1_da6b3354e92efcbb",
  "A5 job-id helper must preserve the canonical runner's historic separator contract");

const step = m22A5BuildRecoveryProbeStepV1(DEVICE);
assert.equal(m22A5RecoveryProbeStepMatchesV1(step, DEVICE), true);
assert.equal(m22A5RecoveryProbeStepMatchesV1({ ...step, timeout_ms: 900001 }, DEVICE), false);
assert.equal(step.operation, "shell.execute");
assert.equal(step.risk, "WRITE");
assert.equal(step.timeout_ms, 900000);
assert.equal(step.max_attempts, 2);
assert.equal(step.retryable, false);
assert.equal(step.policy.mission_wonder_2_a5_recovery, true);
assert.equal(step.policy.idempotent_artifact, true);
assert.equal(step.policy.max_artifacts, 1);
assert.equal(step.policy.allowed_artifact_path, M22_A5_ARTIFACT_PATH);
assert.match(step.input.command, /\[IO\.File\]::WriteAllText\(\$artifact, \$marker/);
assert.match(step.input.command, /\[IO\.File\]::ReadAllText\(\$artifact/);
assert.match(step.input.command, /A5_ARTIFACT_CONTENT_MISMATCH/);
assert.match(step.input.command, /A5_FIRST_ATTEMPT_ARTIFACT_CREATED/);
assert.match(step.input.command, /A5_RECOVERY_ALREADY_IDENTICAL;attempt=2;files=1/);
assert.match(step.input.command, /A5_ARTIFACT_DUPLICATES_FOUND/);
assert.match(step.input.command, /A5_ARTIFACT_COUNT_MISMATCH/);
assert.match(step.input.command, /while \(\$true\)/);
assert.equal(step.input.command.includes("Remove-Item"), false);
assert.equal(step.input.command.includes("Set-Content"), false);
assert.equal(step.input.cwd, "C:\\Windows\\Temp");

const metadata = {
  mission_wonder_2_a5_scope_id: M22_A5_SCOPE_ID,
  mission_wonder_2_a5_goal_hash: GOAL_HASH,
  mission_wonder_2_a5_allowed_device_id: DEVICE,
  mission_wonder_2_a5_recovery: true,
  user_id: OWNER,
  request_id: REQUEST,
  source_application: "aria-app-v1",
  goal_source: "user",
  execution_lane: "user",
  project_id: null,
};
const scope = {
  scope_id: M22_A5_SCOPE_ID,
  scope_key: M22_A5_SCOPE_KEY,
  owner_user_id: OWNER,
  request_id: REQUEST,
  goal_hash: GOAL_HASH,
  mission_id: M22_A5_MISSION_ID,
  job_id: JOB_ID,
  allowed_device_id: DEVICE,
  command: step.input.command,
  status: "bound",
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  recovery_used: false,
};
assert.equal(await m22A5ScopeRowMatchesV1({
  scope, metadata, missionId: M22_A5_MISSION_ID, userId: OWNER, requestId: REQUEST, goal: GOAL,
  requiredStatuses: ["bound"],
}), true);
assert.equal(await m22A5ScopeRowMatchesV1({
  scope, metadata, missionId: M22_A5_MISSION_ID, userId: "different-owner", requestId: REQUEST, goal: GOAL,
  requiredStatuses: ["bound"],
}), false, "owner substitution must fail");
assert.equal(await m22A5ScopeRowMatchesV1({
  scope: { ...scope, job_id: "another-job" }, metadata, missionId: M22_A5_MISSION_ID,
  userId: OWNER, requestId: REQUEST, goal: GOAL, requiredStatuses: ["bound"],
}), false, "job substitution must fail");
assert.equal(await m22A5ScopeRowMatchesV1({
  scope: { ...scope, expires_at: new Date(Date.now() - 1_000).toISOString() }, metadata,
  missionId: M22_A5_MISSION_ID, userId: OWNER, requestId: REQUEST, goal: GOAL, requiredStatuses: ["bound"],
}), false, "expired scope must fail");

assert.match(migration, /create table if not exists aria_internal\.mission_wonder_2_a5_scopes/i);
assert.match(migration, /scope_id text primary key/i);
assert.match(migration, /scope_key text not null unique/i);
assert.match(migration, /create unique index if not exists mission_wonder_2_a5_request_uidx/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on aria_internal\.mission_wonder_2_a5_scopes from public,anon,authenticated/i);
assert.match(migration, /create or replace function aria_internal\.aria_m22_a5_claim_scope_v1/i);
assert.match(migration, /create or replace function aria_internal\.aria_m22_a5_bind_scope_v1/i);
assert.match(migration, /create or replace function aria_internal\.aria_m22_a5_frozen_job_authorized_v1/i);
assert.match(migration, /create or replace function aria_internal\.aria_m22_a5_recover_running_job_v1/i);
assert.match(migration, /create or replace function aria_internal\.aria_m22_a5_claim_frozen_one_shot_job_v1/i);
assert.match(migration, /create or replace function aria_internal\.aria_m22_a5_complete_scope_v1/i);
assert.match(migration, /create or replace function aria_internal\.aria_m22_a5_revoke_scope_v1/i);
assert.match(migration, /create or replace function aria_internal\.guard_execution_job_transition/i);
assert.match(migration, /create or replace function aria_internal\.mission_job_authorization_allowed/i);
assert.match(migration, /create or replace function public\.complete_execution_job_gateway/i);
assert.doesNotMatch(migration, /insert into aria_internal\.mission_state/i,
  "preparation/recovery migration must never create a mission");
assert.doesNotMatch(migration, /insert into aria_internal\.execution_jobs/i,
  "recovery must never create a second execution job");
assert.match(migration, /p_mission_id='mission_a5_authorized_once'/);
assert.match(migration, /p_scope_id<>'mission_wonder_2_a5_authorized_once'/);
assert.match(migration, /p_job_id<>'uo_mission_a5_authorized_once_a5_idempotent_recovery_marke_a1_b5d6865a66a4def1'/);
assert.match(migration, /v_job\.status<>'running'/i);
assert.ok(migration.includes("v_mission.current_step<>0"));
assert.ok(migration.includes("v_mission.completed_steps<>0"));
assert.ok(migration.includes("v_mission.total_steps<>1"));
assert.ok(migration.includes("v_job.recovery_count<>0"));
assert.ok(migration.includes("if jsonb_typeof(v_mission.checkpoint->'plan') is distinct from 'array' then return false; end if;"));
assert.ok(migration.includes("aria_m22_a5_frozen_job_authorized_v1(p_job_id,v_scope.allowed_device_id,'running')"));
assert.ok(migration.includes("where job_id=p_job_id and event_type='job.timeout')<>1"));
const completionGateway = migration.slice(migration.indexOf("create or replace function public.complete_execution_job_gateway("));
assert.ok(completionGateway.indexOf("from aria_internal.mission_state m") < completionGateway.indexOf("for update;"));
assert.ok(completionGateway.indexOf("for update;") < completionGateway.indexOf("select j.status"));
assert.ok(completionGateway.indexOf("select j.status") < completionGateway.indexOf("v_submitted_attempt<>v_current_attempt"));
assert.ok(migration.includes("event_type='job.claimed_a5_one_shot'"));
assert.ok(migration.includes("event_type='job.a5_stale_attempt_rejected'"));
assert.ok(migration.includes("event_type='job.succeeded')<>1"));
assert.ok(migration.includes("event_type='mission_verified')<>1"));
assert.match(migration, /recovery_used=true and s\.status='recovered'/i);
assert.match(migration, /set_config\('aria_internal\.a5_requeue_job_id',p_job_id,true\)/i);
assert.match(migration, /old\.status='timeout' and new\.status='queued'/i);
assert.match(migration, /current_setting\('aria_internal\.a5_requeue_job_id',true\)=old\.job_id/i);
assert.match(migration, /recovery_count=coalesce\(recovery_count,0\)\+1/i);
assert.match(migration, /'attempt',2/i);
assert.match(migration, /'new_job_created',false/i);
assert.match(migration, /job\.a5_stale_attempt_rejected/);
assert.match(migration, /p_result->'metadata'->>'mission_wonder_2_a5_attempt'/);
assert.match(migration, /expected_http_status',409/i);
assert.match(migration, /grant execute on function aria_internal\.aria_m22_a5_recover_running_job_v1\(text,text,text,text\) to service_role/i);
assert.doesNotMatch(migration, /MISSION_EXECUTION_PAUSED\s*=\s*false/i);

assert.match(appApi, /m22A5GoalIdentityHashV1/);
assert.match(appApi, /aria_m22_a5_claim_scope_v1/);
assert.match(appApi, /aria_m22_a5_bind_scope_v1/);
assert.match(appApi, /mission_wonder_2_a5_recovery: true/);
assert.match(appApi, /no_authorized_one_shot_scope/);
assert.match(direct, /m22A5ScopeRowMatchesV1/);
assert.match(intake, /m22A5ScopeRowMatchesV1/);
assert.match(canonical, /m22A5ScopeRowMatchesV1/);
assert.match(runner, /m22A5BuildRecoveryProbeStepV1/);
assert.ok(runner.includes(String.raw`job.cwd === "C:\\Windows\\Temp"`),
  "A5 independent readback must compare the exact Windows cwd with escaped backslashes");
assert.equal(runner.includes(String.raw`job.cwd === "C:\Windows\Temp"`), false,
  "A5 independent readback must not drop Windows path separators");
assert.match(runner, /m22A5RecoveryProbeStepMatchesV1/);
assert.match(runner, /a5_independent_same_job_recovery_readback/);
assert.match(runner, /aria_m22_a5_complete_scope_v1/);
assert.match(runner, /stale_attempt_http_409: true/);
assert.match(gateway, /const A5_FROZEN_JOB_ID='uo_mission_a5_authorized_once_a5_idempotent_recovery_marke_a1_b5d6865a66a4def1';/);
assert.match(gateway, /const A5_FROZEN_DEVICE_ID='windows-fe722cc6681e4f9c9cc35f5ebbb0a089';/);
const a5HelperStart = gateway.indexOf('async function a5FrozenJobAuthorizedV1(');
const a5HandlerStart = gateway.indexOf('Deno.serve(async(req)=>{', a5HelperStart);
assert.ok(a5HelperStart >= 0 && a5HandlerStart > a5HelperStart,
  'A5 frozen-job RPC helper must be defined before the gateway handler');
const a5AuthorizationHelper = gateway.slice(a5HelperStart, a5HandlerStart);
assert.ok(a5AuthorizationHelper.includes("rpc('aria_m22_a5_frozen_job_authorized_v1'"),
  'A5 helper must call the dedicated frozen-job RPC');
assert.ok(a5AuthorizationHelper.includes('p_job_id:jobId,p_device_id:deviceId,p_required_status:requiredStatus'),
  'A5 helper must bind the exact job, device and status arguments');
assert.match(gateway, /a5FrozenJobAuthorizedV1\(A5_FROZEN_JOB_ID,deviceId,'queued'\)/);
assert.match(gateway, /aria_m22_a5_claim_frozen_one_shot_job_v1/);
assert.match(gateway, /a5-one-shot-recovery-only/);
assert.match(agent, /mission_wonder_2_a5_attempt/);
assert.match(agent, /body\?\.authorized!==true/);
assert.match(agent, /await executeShellJob\(job\)/);
assert.match(agent, /await claimAndExecute\(\)/);
assert.match(agent, /mission_wonder_2_a5_attempt/);
assert.match(shellExecutor, /function executePowerShell\(\{[^}]*signal\s*\}/);
assert.match(shellExecutor, /signal\.addEventListener\(\x27abort\x27, onAbort/);
assert.match(shellExecutor, /killProcessTree\(child\.pid\)/);
assert.match(shellExecutor, /status: \x27cancelled\x27/);

assert.ok(pilotWorkflow.includes("workflow_dispatch:"));
assert.ok(pilotWorkflow.includes("execute_pilot:"));
assert.ok(pilotWorkflow.includes("default: false"));
assert.ok(pilotWorkflow.includes("if: inputs.execute_pilot == true"));
assert.ok(pilotWorkflow.includes("node mission-wonder-2-step5-a5-live-pilot.mjs"));
assert.equal(pilotWorkflow.includes("workflow_run:"), false);
assert.equal(/^\s*push:/m.test(pilotWorkflow), false);
assert.ok(pilotScript.includes("A5_RESUME_ORPHAN_PASS"));
assert.ok(pilotScript.includes("A5_VERIFY_EXISTING_SUCCESS"));
assert.ok(pilotScript.includes("A5_VERIFY_REPLAY_ELIGIBLE"));
assert.ok(pilotScript.includes("A5_VERIFY_REPLAY_PREPARED="));
assert.ok(pilotScript.includes("A5_ALREADY_TERMINAL_PASS"));
assert.ok(pilotScript.includes("report.already_terminal = alreadyTerminal"));
assert.ok(pilotScript.includes("includes(tick.status)"), "verification replay must accept an asynchronous HTTP 202 tick");
assert.ok(pilotScript.includes("MISSION_WONDER_2_STEP5_A5_VERIFICATION_REPLAY=PASS"));
assert.ok(pilotScript.includes("A5_VERIFICATION_REPLAY_FINAL=true"));
assert.ok(pilotScript.includes("verification_replay_only"));
assert.ok(pilotScript.includes("A5_RECOVERY_ALREADY_IDENTICAL;attempt=2;"));
assert.ok(pilotScript.includes("aria-canonical-runtime-v1"));
assert.equal(pilotScript.includes("aria_m22_a5_recover_running_job_v1"), true, "the original authorized pilot must retain its one recovery path");
assert.equal(pilotScript.includes("INSERT INTO aria_internal.execution_jobs"), false);
assert.equal(pilotScript.includes("INSERT INTO aria_internal.mission_state"), false);
assert.ok(pilotScript.includes("A5_SCOPE_REARMED="));
assert.ok(pilotScript.includes("aria_m22_a5_claim_scope_v1"));
assert.ok(pilotScript.includes("coalesce(aria_internal.aria_m22_a5_claim_scope_v1("),
  "A5 scope claim SQL must have balanced parentheses around the JSONB RPC result");
assert.equal(pilotScript.includes("coalesce((aria_internal.aria_m22_a5_claim_scope_v1("), false,
  "A5 scope claim SQL must not wrap the RPC call in an unmatched extra parenthesis");
assert.ok(pilotScript.includes("aria_m22_a5_bind_scope_v1"));
assert.ok(pilotScript.includes("pwa_mission_resumed"));
assert.ok(pilotScript.includes("UPDATE aria_internal.mission_wonder_2_a5_scopes"));
assert.equal(pilotScript.includes('getByRole("button", { name: "Crear misión"'), false,
  "the retry must resume the existing PWA mission rather than create a duplicate");
assert.equal(/INSERT INTO aria_internal\.mission_state/i.test(pilotScript), false);
assert.equal(/INSERT INTO aria_internal\.execution_jobs/i.test(pilotScript), false);
assert.ok(pilotScript.includes("A5_CHECKPOINT_READY=true"));
assert.ok(pilotScript.includes("aria_m22_a5_recover_running_job_v1"));
assert.ok(pilotScript.includes("A5_FINAL_LIVE_READY=true"));
assert.ok(pilotScript.includes("job.a5_stale_attempt_rejected"));
assert.ok(pilotScript.includes("mission_verified"));
assert.ok(pilotScript.includes("A5_SCOPE_REVOKE="));
assert.ok(pilotScript.includes("/api/missions/"));
assert.ok(pilotScript.includes("global_freeze_after_recovery"));

for (const source of [appApi, direct, intake, canonical, runner, gateway]) {
  assert.doesNotMatch(source, /MISSION_EXECUTION_PAUSED\s*=\s*false/i,
    "A5 must not lift the global mission execution freeze");
}

console.log("MISSION_WONDER_2_STEP5_A5_RECOVERY_CONTRACT=PASS");
