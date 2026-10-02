'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('supabase/functions/aria-mission-runner-v22/index.ts', 'utf8');

assert.match(source, /const ECC_POLL_BUDGET_MS = 45_000;/);
assert.match(
  source,
  /const deadline = Date\.now\(\) \+ \(operation === "ecc\.execute" \? ECC_POLL_BUDGET_MS : 35_000\);/
);
assert.ok(
  source.includes('status: "waiting", executor_type: "device", operation, job_id: jobId, job_status: status'),
  'device polling must yield a resumable waiting result when the per-tick budget expires'
);

console.log('MISSION RUNNER V22 ECC ASYNC POLL BUDGET CONTRACT: PASS');
