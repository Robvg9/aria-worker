'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const runner = fs.readFileSync(
  'supabase/functions/aria-mission-runner-v22/index.ts',
  'utf8'
);
const migration = fs.readFileSync(
  'supabase/migrations/20260918013000_mission_chain_evidence_v1.sql',
  'utf8'
);

assert.match(runner, /record_mission_chain_evidence/);
assert.match(runner, /child_status === "succeeded"/);
assert.match(migration, /mission_chain_completed/);
assert.match(migration, /parent_mission_not_terminal_succeeded/);
assert.match(migration, /child_mission_not_terminal_succeeded/);
assert.match(migration, /child_mission_not_verified/);

console.log('MISSION CHAIN EVIDENCE CONTRACT: PASS');

assert.match(migration, /continuity_proof/);
