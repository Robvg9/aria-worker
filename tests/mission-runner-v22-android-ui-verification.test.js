'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-mission-runner-v22/index.ts'),
  'utf8'
);

assert.match(source, /const androidUiStep = executorType\(step\).*computer\.use\.android/);
assert.match(source, /Device UI executors prove success through their governed job result\/evidence/);
assert.match(source, /result\?\.status !== "succeeded"/);
assert.match(source, /Number\(result\?\.exit_code\) !== 0/);
assert.ok(source.includes('if (!androidUiStep) return false;'), 'model-style response checks must remain strict for non-Android executors');

console.log('ANDROID UI VERIFICATION USES PHYSICAL JOB EVIDENCE: PASS');
