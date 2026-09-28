'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const planner = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'aria-planner-v11', 'index.ts'), 'utf8');
const runner = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'index.ts'), 'utf8');

for (const fragment of [
  'function extractMissionPlannerContract(context:any)',
  'function explicitDeviceIntent(goal:string, context:any)',
  'function directDeviceIntentPlan(goal:string, context:any)',
  'requested_capability',
  'requested_device_id',
  'verification_marker',
  'executor_type:"device"',
  'aria-planner-v11-explicit-device-intent-v1',
  '["READ","LOW_RISK_WRITE","HIGH_RISK_WRITE","DESTRUCTIVE"]',
]) assert.ok(planner.includes(fragment), `Planner explicit device contract missing: ${fragment}`);

const directAt = planner.indexOf('const directDevice=directDeviceIntentPlan(goal,context);');
const verifiedAt = planner.indexOf('const verifiedPath=await tryVerifiedPathPlan(goal,context);');
assert.ok(directAt >= 0 && verifiedAt >= 0 && directAt < verifiedAt, 'Explicit device intent must run before generic verified-path planning');

for (const fragment of [
  'mission_planner_contract: {',
  'requested_capability: typeof mission?.metadata?.requested_capability',
  'requested_device_id:',
  'verification_marker:',
  'command:',
  'roadmap_block:',
]) assert.ok(runner.includes(fragment), `Runner mission planner contract forwarding missing: ${fragment}`);

console.log('EXPLICIT DEVICE INTENT PLANNER CONTRACT: PASS');
