'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20260918010500_claim_by_id_same_worker_reentry_v1.sql',
  'utf8'
);

assert.match(migration, /m\.lease_owner=p_worker_id/);
assert.match(migration, /m\.status in \('planning','running','paused'\)/);
assert.match(migration, /m\.lease_until>clock_timestamp\(\)/);
assert.match(migration, /aria_mission_claim_eligible/);
assert.match(migration, /retry_exhausted/);

console.log('MISSION CLAIM SAME-WORKER REENTRY: PASS');
