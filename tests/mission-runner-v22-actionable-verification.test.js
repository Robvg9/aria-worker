'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('supabase/functions/aria-mission-runner-v22/index.ts', 'utf8');

for (const fragment of [
  'function verificationPending(step: any, result: any)',
  'const changed = repair?.changed === true;',
  'const writes = Array.isArray(repair?.writes) && repair.writes.length > 0;',
  'const verified = repair?.verified === true;',
  'next_action: "verification:awaiting_ci_or_live_verification"',
  'status: "blocked"',
]) {
  assert.ok(source.includes(fragment), 'missing actionable mission verification contract: ' + fragment);
}

console.log('MISSION RUNNER V22 ACTIONABLE VERIFICATION CONTRACT: PASS');
