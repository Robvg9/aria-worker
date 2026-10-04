'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-planner-v11/index.ts'),
  'utf8',
);

assert.match(
  source,
  /const requestedDeviceId=String\(\s*context\?\.mission_planner_contract\?\.requested_device_id/,
  'Planner must inspect the canonical requested Windows device.',
);
assert.match(
  source,
  /const explicitWindowsDevice=requestedDeviceId\.startsWith\("windows-"\)/,
  'Planner must recognize an explicit Windows target.',
);
assert.match(
  source,
  /return caps\.includes\("ollama\.qwen3"\) \|\| caps\.includes\("computer\.use\.autonomous"\)/,
  'Windows RWHT must remain runnable when the heartbeat advertises autonomous UI but omits the optional qwen capability.',
);
assert.match(
  source,
  /requires:\["computer\.use"\]/,
  'Autonomous Windows UI must not require qwen to be present in the registry capability list.',
);
assert.match(
  source,
  /if\(\(!isRwht \|\| !isPc\) && !explicitWindowsDevice\)return null;/,
  'Windows RWHT planner must accept explicit Windows device intent even without lexical PC/RWHT wording.',
);
assert.match(
  source,
  /async function androidAutonomousPlan[\s\S]*?if\(requestedDeviceId\.startsWith\("windows-"\)\)return null;/,
  'Android planner must refuse an explicitly requested Windows mission.',
);
assert.match(
  source,
  /const windowsPcRwht=await windowsPcRwhtPlan\(goal,context\);/,
  'Main planner must retain the Windows RWHT route.',
);
assert.match(
  source,
  /const androidAuto=await androidAutonomousPlan\(goal,context\);/,
  'Main planner must retain the Android route for genuine Android missions.',
);

console.log('MEDITATION WINDOWS DEVICE ROUTING REGRESSION: PASS');
