'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const planner = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-planner-v11/index.ts'),
  'utf8'
);
const runner = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-mission-runner-v22/index.ts'),
  'utf8'
);

assert.match(planner, /const localQwenDevice =/);
assert.match(planner, /device\.capabilities\.map\(String\)\.includes\("ollama\.qwen3"\)/);
assert.match(planner, /device_id: String\(localQwenDevice\.device_id\)/);
assert.match(planner, /device_operations:\[.*"android\.notification"/);

assert.match(runner, /primaryLocalAvailable/);
assert.match(runner, /deviceSupportsOperation\(device\.capabilities, "ollama\.qwen3"\)/);
assert.match(runner, /primaryRoute = \{ \.\.\.primary, device_id: String\(liveLocal\.device_id\) \}/);
assert.match(runner, /local_model_route_unavailable/);
assert.match(runner, /primaryProvider.*local_windows/);

console.log('MEDITATION MODEL ROUTING CAPABILITY CONTRACT: PASS');
