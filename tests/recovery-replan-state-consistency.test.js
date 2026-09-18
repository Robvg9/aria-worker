'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20260918004500_recovery_replan_state_consistency_v1.sql',
  'utf8'
);

assert.match(migration, /replan_required/);
assert.match(migration, /recovery,status/);
assert.doesNotMatch(migration, /status.*retry_exhausted.*and|checkpoint.*retry_exhausted/);

console.log('RECOVERY REPLAN STATE CONSISTENCY: PASS');
