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

console.log('MISSION RUNNER DEVICE PAYLOAD SANITIZATION: PASS');
