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
assert.match(planner,/aria\\/sandbox\\//);
assert.match(planner,/battlecruiserRwht=await battlecruiserGithubRwhtPlan\(goal,context\);if\(battlecruiserRwht\)return out\(\{ok:true,plan:battlecruiserRwht\}\)/);

const planStart=planner.indexOf('const battlecruiserRwht=await battlecruiserGithubRwhtPlan(goal,context)');
const androidStart=planner.indexOf('const androidAuto=await androidAutonomousPlan(goal,context)');
assert(planStart>=0 && androidStart>=0 && planStart<androidStart,'BattleCruiser GitHub route must run before Android autonomous routing');

assert.match(runner,/response: \{ content: JSON\.stringify\(result\.data \?\? \{\}\) \}/);
console.log('BATTLECRUISER RWHT ROUTING V1: PASS — explicit BattleCruiser/GitHub goals route to governed connector steps before Android UI heuristics.');
