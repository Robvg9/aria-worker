'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-planner-v11/index.ts'),
  'utf8'
);

assert.match(source, /db\.from("device_registry")/);
assert.match(source, /const localQwenAvailable =/);
assert.match(source, /device\.capabilities\.map\(String\)\.includes\("ollama\.qwen3"\)/);
assert.match(source, /String\(device\?\.agent_type || ""\) === "windows-local"/);
assert.match(source, /String\(device\?\.status || ""\)\.toLowerCase\(\) === "online"/);
assert.match(source, /x\.provider_id === "local_windows" && x\.model_id === "qwen3:0\.6b" && !localQwenAvailable/);
assert.match(source, /if\(x\.provider_id === "local_windows".*return null/s);
console.log('PLANNER LIVE LOCAL QWEN CAPABILITY ROUTE GUARD: PASS');
