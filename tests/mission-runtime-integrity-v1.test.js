const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

const app=fs.readFileSync(path.join(root,'supabase/functions/aria-app-api-v3/index.ts'),'utf8');
const direct=fs.readFileSync(path.join(root,'supabase/functions/aria-direct-v1/index.ts'),'utf8');
const planner=fs.readFileSync(path.join(root,'supabase/functions/aria-planner-v11/index.ts'),'utf8');
const runner=fs.readFileSync(path.join(root,'supabase/functions/aria-mission-runner-v22/index.ts'),'utf8');
const worker=fs.readFileSync(path.join(root,'worker.js'),'utf8');
const wrangler=fs.readFileSync(path.join(root,'wrangler.toml'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261007144500_mission_owner_replan_recovery_v1.sql'),'utf8');
const schedulerMigration=fs.readFileSync(path.join(root,'supabase/migrations/20261007205000_scheduler_cloudflare_transport_fallback_v1.sql'),'utf8');

assert.match(app,/owner_user_id/);
assert.match(app,/user_id/);
assert.match(direct,/x-aria-user-id/);
assert.match(direct,/owner_user_id/);
assert.match(planner,/multiProjectRealityBoardPlan/);
assert.match(planner,/reality_aria_repo_read/);
// The canonical read ID was tightened to an authorized source read; accept the legacy alias too.
assert.match(planner,/reality_cuevacoin_(?:repo_read|authorized_source_read)/);
assert.match(planner,/reality_battlecruiser_repo_read/);
assert.match(planner,/aria-planner-v11-multi-project-reality-board-v2-authorized-cuevacoin/);
assert.match(runner,/multi_project_surface_mismatch/);
assert.match(runner,/El objetivo exige varios proyectos/);
assert.match(migration,/recover_running_replan_stalls_v1/);
assert.match(migration,/running_replan_stall_recovered/);
assert.match(migration,/owner_user_id/);
assert.match(worker,/schedulerTick/);
assert.match(worker,/\/scheduler\/tick/);
assert.match(worker,/x-aria-autonomy-token/);
assert.match(schedulerMigration,/aria\.robvg9\.workers\.dev\/scheduler\/tick/);

// Global mission freeze: Cloudflare must not keep a second scheduler alive.
  assert.match(wrangler, /\[triggers\][\s\S]*?crons\s*=\s*\[\s*\]/);
  assert.doesNotMatch(wrangler, /crons\s*=\s*\[\s*['"]\*\s+\*\s+\*\s+\*\s+\*['"]\s*\]/);
assert.match(worker,/const MISSION_EXECUTION_PAUSED = true;/);
const manualScheduler=worker.slice(worker.indexOf('async function schedulerTick'),worker.indexOf('async function runScheduledMission'));
assert.match(manualScheduler,/MISSION_EXECUTION_PAUSED[\s\S]*?423/);
assert.ok(manualScheduler.indexOf('MISSION_EXECUTION_PAUSED')<manualScheduler.indexOf('fetch(CANONICAL_RUNTIME,'),'manual scheduler must be blocked before forwarding');
const scheduledMission=worker.slice(worker.indexOf('async function runScheduledMission'),worker.indexOf('// 2026-10-07 scheduler transport fallback'));
assert.match(scheduledMission,/MISSION_EXECUTION_PAUSED/);
assert.ok(scheduledMission.indexOf('MISSION_EXECUTION_PAUSED')<scheduledMission.indexOf('fetch(CANONICAL_RUNTIME,'),'scheduled runner must be blocked before forwarding');


console.log('MISSION OWNER + MULTI-PROJECT PLANNER + REPLAN RECOVERY + GLOBAL MISSION FREEZE CONTRACT: PASS');
