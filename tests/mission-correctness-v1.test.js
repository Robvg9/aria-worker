const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const planner = fs.readFileSync(path.join(root, "supabase/functions/aria-planner-v11/index.ts"), "utf8");
const appApi = fs.readFileSync(path.join(root, "supabase/functions/aria-app-api-v3/index.ts"), "utf8");
const runner = fs.readFileSync(path.join(root, "supabase/functions/aria-mission-runner-v22/index.ts"), "utf8");
const recoveryMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260922133000_mission_verification_recovery_v1.sql"), "utf8");
const hardBlockRecoveryMigration = fs.readFileSync(path.join(root, "supabase/migrations/20260922143000_mission_hardblock_recovery_epoch_v1.sql"), "utf8");
const pwa = fs.readFileSync(path.join(root, "pwa/src/App.tsx"), "utf8");

assert.match(planner, /SPANISH_OUTPUT_CONTRACT/);
assert.match(planner, /spanish_output_required:true/);
assert.match(planner, /planner-v11-governed-change-v3-multistep/);
assert.match(planner, /"analysis_1"/);
assert.match(planner, /"implementation_1"/);
assert.match(planner, /"verification_1"/);
assert.match(planner, /depends_on/);
assert.match(planner, /planner-v11-safe-readonly-actionable-v4-multistep/);
assert.ok(planner.includes("const isRwht=/(\\brwht\\b|real world human test"), "RWHT detection must use token boundaries");
assert.ok(
  planner.indexOf('const battlecruiserRwht=await battlecruiserGithubRwhtPlan') < planner.indexOf('const windowsPcRwht=await windowsPcRwhtPlan'),
  'BattleCruiser GitHub planner must run before generic Windows RWHT planner'
);

assert.match(appApi, /display_title/);
assert.match(appApi, /Misión #/);
assert.match(appApi, /description:String\(m\?\.goal/);
assert.match(appApi, /order\("updated_at",\{ascending:false\}\)\.limit\(200\)/);

assert.match(runner, /String\(result\?\.status \|\| ""\) === "succeeded" \? "verification_failed"/);
assert.match(runner, /result_status: result\?\.status/);
assert.match(runner, /verification_status: result\?\.repair\?\.verification_status/);
assert.match(runner, /status: "waiting"/);
assert.match(runner, /__aria_verified_by_runner/);
assert.match(runner, /"pr_read"/);
assert.match(runner, /"pr_checks"/);
assert.match(runner, /"main_workflow_runs"/);
assert.match(runner, /"pr_merge"/);
assert.match(runner, /number: input\.number/);
assert.match(runner, /commit_sha: input\.commit_sha/);
assert.match(runner, /paths: input\.paths/);
assert.match(runner, /verifyPendingMutation/);
assert.match(runner, /retry_exhausted_strategy/);
assert.match(runner, /replan_count/);\nassert.match(runner, /const rwhtProbe=/);
assert.match(runner, /checkpoint\\?\\.recovery && typeof checkpoint\\?\\.recovery/);
assert.match(runner, /payload\\.command = JSON\\.stringify/);
assert.match(runner, /maxReplans = 2/);
assert.match(runner, /planStrategySignature/);
assert.match(runner, /identical_replan_strategy/);
assert.match(runner, /mission_replanned/);
assert.match(runner, /AGENT_RECOVERY_FALLBACKS/);
assert.match(runner, /aria-agent-coding-openrouter-v1/);
assert.match(runner, /aria-agent-verifier-openrouter-v1/);
assert.match(runner, /aria-agent-android-coding-openrouter-v1/);
assert.match(runner, /recoveryTargetsAndroid/);
assert.match(runner, /const androidRecovery/);
assert.match(runner, /shouldRoute/);
assert.match(runner, /android-ui-agent/);

assert.match(runner, /verification:await_ci_or_live_verification/);
assert.match(appApi, /missionBlockDetails/);
assert.match(appApi, /verification_pending/);
assert.match(pwa, /BLOQUEADAS/);
assert.match(pwa, /openMission\(b\.mission_id\)/);
assert.match(pwa, /Cómo solucionarlo/);
assert.match(recoveryMigration, /status='waiting'/);
assert.match(recoveryMigration, /verification_pending/);
assert.match(recoveryMigration, /verification_pending_resumed/);
assert.match(recoveryMigration, /aria_mission_claim_next_lease/);
assert.match(recoveryMigration, /aria_mission_claim_by_id_lease/);
assert.match(hardBlockRecoveryMigration, /mission_recovery_epoch/);
assert.match(hardBlockRecoveryMigration, /aria_reopen_recoverable_hard_blocks/);
assert.match(hardBlockRecoveryMigration, /hard_block_reopened_after_recovery_epoch/);
assert.match(runner, /aria_internal\.aria_reopen_recoverable_hard_blocks/);

console.log("mission-correctness-v1: PASS");
