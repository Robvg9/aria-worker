'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20260918003500_meditation_runner_tick_canonical_bridge_v1.sql',
  'utf8'
);

assert.match(migration, /aria-canonical-runtime-v1/);
assert.match(migration, /x-aria-trigger/);
assert.match(migration, /meditation-ia/);
assert.match(migration, /read_aria_credential_secret/);
assert.doesNotMatch(migration, /aria-mission-runner-v22/);

console.log('MEDITATION DB TICK CANONICAL BRIDGE: PASS');
