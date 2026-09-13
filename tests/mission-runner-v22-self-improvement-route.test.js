'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const runnerPath = path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'index.ts');
const gatewayPath = path.join(__dirname, '..', 'supabase', 'functions', 'aria-runtime-gateway-v1', 'index.ts');
const runner = fs.readFileSync(runnerPath, 'utf8');
const gateway = fs.readFileSync(gatewayPath, 'utf8');

assert.match(runner, /"self_improvement"/);
assert.match(runner, /self\.improve/);
assert.match(runner, /function selfImprovementExecute\(m: string, s: any\)/);
assert.match(runner, /self_improvement_device_target_missing/);
assert.match(runner, /action: "self_improve"/);
assert.match(runner, /getExecutionJob\(jobId\)/);
assert.match(runner, /coordinator_verified/);
assert.match(runner, /coordinator_status === "completed"/);
assert.match(runner, /stop_reason === "verified"/);
assert.match(runner, /self_improvement_contract_verified/);
assert.match(runner, /self_improvement_execution_verified/);
assert.match(runner, /waiting_for_human_gate/);
assert.match(runner, /executorType\(step\) !== "self_improvement"/);
assert.doesNotMatch(runner, /selfImprovementExecute[\s\S]{0,6500}action:\s*["']enqueue_device_job["']/);
assert.doesNotMatch(runner, /selfImprovementExecute[\s\S]{0,6500}shell\.execute/);

assert.match(gateway, /action===\"self_improve\"/);
assert.match(gateway, /p_operation:\"self\.improve\"/);
assert.match(gateway, /version:\"self-improvement-runtime-v1\"/);
assert.match(gateway, /promote:false/);
assert.match(gateway, /deploy:false/);
assert.match(gateway, /governed_coordinator_job/);

console.log('MISSION_RUNNER_V22_SELF_IMPROVEMENT_ROUTE_OK');
