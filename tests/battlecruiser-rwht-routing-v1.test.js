const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const planner=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-planner-v11','index.ts'),'utf8');
const runner=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-mission-runner-v22','index.ts'),'utf8');

assert.match(planner,/battlecruiserGithubRwhtPlan\(goal,context\)/);
assert.match(planner,/planner-v11-battlecruiser-github-rwht-v1/);
assert.match(planner,/github_create_branch/);
assert.match(planner,/github_file_write/);
assert.match(planner,/github_file_verify/);
assert.match(planner,/github_open_pr/);
assert.ok(planner.includes('aria/sandbox/'));
assert.match(planner,/battlecruiserRwht=await battlecruiserGithubRwhtPlan\(goal,context\);if\(battlecruiserRwht\)return out\(\{ok:true,plan:battlecruiserRwht\}\)/);

const planStart=planner.indexOf('const battlecruiserRwht=await battlecruiserGithubRwhtPlan(goal,context)');
const androidStart=planner.indexOf('const androidAuto=await androidAutonomousPlan(goal,context)');
assert(planStart>=0 && androidStart>=0 && planStart<androidStart,'BattleCruiser GitHub route must run before Android autonomous routing');

assert.match(runner,/response: \{ content: JSON\.stringify\(result\.data \?\? \{\}\) \}/);
console.log('BATTLECRUISER RWHT ROUTING V1: PASS — explicit BattleCruiser/GitHub goals route to governed connector steps before Android UI heuristics.');

assert.match(planner,/async function battlecruiserReadonlyAuditPlan\(goal:string,context:any\)/);
assert.match(planner,/planner-v11-battlecruiser-readonly-audit-v2/);
assert.match(planner,/bc_github_repo_read/);
assert.match(planner,/bc_github_tree_read/);
assert.match(planner,/bc_github_package_read/);
assert.match(planner,/bc_github_cerebro_read/);
assert.match(planner,/bc_github_test_runner_read/);
assert.match(planner,/bc_github_quality_workflow_read/);
assert.match(planner,/bc_audit_synthesis/);
assert.match(planner,/AUDITORIA_BATTLECRUISER_READONLY_OK/);
assert.match(planner,/mutation_allowed:false/);
const auditStart=planner.indexOf('const battlecruiserAudit=await battlecruiserReadonlyAuditPlan(goal,context)');
const genericStart=planner.indexOf('const allForOne=await allForOnePlan(goal,context)');
assert(auditStart>=0 && genericStart>=0 && auditStart<genericStart,'BattleCruiser read-only audit must preempt generic planning');
