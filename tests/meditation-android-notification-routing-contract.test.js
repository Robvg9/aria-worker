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
const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-mission-runner-v22/forensic-continuity-fixes.ts'),
  'utf8'
);
const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20261005003000_align_android_notification_enqueue_contract_v1.sql'),
  'utf8'
);

assert.match(planner, /const localQwenDevice =/);
assert.match(planner, /device\.capabilities\.map\(String\)\.includes\("ollama\.qwen3"\)/);
assert.match(planner, /device_id: String\(localQwenDevice\.device_id\)/);
assert.match(planner, /"android\.notification"/);

assert.match(runner, /operation === "android\.notification"/);
assert.match(runner, /notifications\.push/);
assert.match(runner, /primaryLocalAvailable/);
assert.match(runner, /deviceSupportsOperation\(device\.capabilities, "ollama\.qwen3"\)/);
assert.match(runner, /primaryRoute = \{ \.\.\.primary, device_id: String\(liveLocal\.device_id\) \}/);
assert.match(runner, /local_model_route_unavailable/);
assert.match(runner, /item\.result\?\.error\?\.code !== "local_model_route_unavailable"/);

assert.match(source, /"android\.notification"/);
assert.match(source, /notification_id.*title.*message.*severity.*kind.*mission_id.*priority/);
assert.match(migration, /CREATE OR REPLACE FUNCTION aria_internal\.enqueue_android_notification_job/);
assert.match(migration, /notifications\.push/);
assert.match(migration, /p_operation = 'android\.notification'/);

console.log('MEDITATION ANDROID NOTIFICATION + MODEL ROUTING CONTRACT: PASS');
