import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../supabase/functions/aria-planner-v10/index.ts', import.meta.url), 'utf8');

function credentialHealthPlanSlice() {
  const start = source.indexOf('if(s.includes("credential")&&s.includes("health"))');
  assert.ok(start >= 0, 'credential health planner branch must exist');
  const end = source.indexOf('];if(s.includes("multiia")', start);
  assert.ok(end > start, 'credential health planner branch must be bounded');
  return source.slice(start, end);
}

test('credential health plan creates isolated branch before any write', () => {
  const s = credentialHealthPlanSlice();
  const branch = s.indexOf('"branch_create"');
  const firstWrite = s.indexOf('"file_write"');
  const pr = s.indexOf('"pull_request_create"');
  assert.ok(branch >= 0, 'branch_create must be planned');
  assert.ok(firstWrite > branch, 'first file_write must follow branch_create');
  assert.ok(pr > firstWrite, 'PR must follow writes');
});

test('credential health plan does not pin a shared production branch', () => {
  const s = credentialHealthPlanSlice();
  assert.equal(s.includes('branch:"aria/autonomous/credential-health"'), false);
  assert.equal(s.includes('branch:\"aria/autonomous/credential-health\"'), false);
});
