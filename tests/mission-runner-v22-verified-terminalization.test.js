'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const runner = fs.readFileSync(
  'supabase/functions/aria-mission-runner-v22/index.ts',
  'utf8'
);
const migration = fs.readFileSync(
  'supabase/migrations/20260918005500_mission_verified_fast_terminalization_v1.sql',
  'utf8'
);

assert.match(runner, /aria_mission_finalize_verified_lease/);
assert.match(runner, /const chained = meditationChain/);
assert.match(migration, /event_type='mission_verified'/);
assert.match(migration, /verified/);
assert.match(migration, /lease_owner=p_worker_id/);
assert.match(migration, /status='succeeded'/);
assert.doesNotMatch(runner, /status:\s*"succeeded"[\s\S]{0,1800}checkpoint:\s*\{/);

console.log('MISSION RUNNER V22 VERIFIED TERMINALIZATION: PASS');
