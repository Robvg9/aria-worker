const runnerSource = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-mission-runner-v22/index.ts'),
  'utf8'
);

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-mission-runner-v22/forensic-continuity-fixes.ts'),
  'utf8'
);

assert.match(source, /const allowedKeys = operation === "computer\.use\.android"/);
assert.match(source, /"start_url",\s*"start_app",\s*"max_steps"/s);
assert.match(source, /__aria_attempt and\s+dependency_results/);
assert.match(source, /for \(const key of allowedKeys\)/);
assert.match(source, /input\[key\] =/);
assert.ok(
  !source.includes('const input = step.input && typeof step.input === "object" ? { ...step.input } : {};'),
  'Android payload must not spread the complete planner input'
);

assert.match(runnerSource, /operation === "computer.use" && String(agentType || "").toLowerCase() === "android-termux"/);
assert.match(runnerSource, /capability === "computer.use.android"/);
assert.match(runnerSource, /const normalizedOperation =/);
assert.match(runnerSource, /normalizedOperation === String(step?.operation || "")/);
assert.match(runnerSource, /operation: normalizedOperation/);
console.log('MISSION RUNNER DEVICE PAYLOAD SANITIZATION: PASS');
