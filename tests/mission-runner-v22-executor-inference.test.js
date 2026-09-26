'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runner = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'index.ts'),
  'utf8',
);
const continuity = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'forensic-continuity-fixes.ts'),
  'utf8',
);

assert.match(runner, /function executorType\(step: any\)/);
assert.match(runner, /DEVICE_OPS_ALLOWLIST\.has\(operation\).*return "device"/s);
assert.match(runner, /function normalizeExecutionStep\(step: any, mission: any\)/);
assert.match(runner, /mission\?\.metadata\?\.device_id/);
assert.match(runner, /normalizeExecutionStep\(step, mission\)/);
assert.match(runner, /plan_executor_normalized/);
assert.match(continuity, /"computer\.use"/);
assert.match(continuity, /"computer\.use\.autonomous"/);
assert.match(continuity, /"computer\.use\.android"/);

console.log('MISSION RUNNER V22 EXECUTOR INFERENCE CONTRACT: PASS');
