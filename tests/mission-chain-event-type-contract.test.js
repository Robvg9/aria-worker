'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20260918013500_mission_chain_event_type_v1.sql',
  'utf8'
);

assert.match(migration, /mission_chain_completed/);
assert.match(migration, /mission_verified/);
assert.match(migration, /mission_events_event_type_check/);

console.log('MISSION CHAIN EVENT TYPE CONTRACT: PASS');
