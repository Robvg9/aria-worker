'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20261005010000_align_claim_capability_aliases_v1.sql'),
  'utf8',
);

assert.match(migration, /CREATE OR REPLACE FUNCTION aria_internal\.claim_execution_job/);
assert.match(migration, /q\.operation = 'android\.notification'/);
assert.match(migration, /'notifications\.push'/);
assert.match(migration, /v_device_capabilities @> jsonb_build_array/);
assert.match(migration, /target\.capabilities @> jsonb_build_array/);
assert.match(migration, /FOR UPDATE SKIP LOCKED/);
assert.match(migration, /status='claimed'/);

console.log('MEDITATION ANDROID CLAIM CAPABILITY ALIAS CONTRACT: PASS');
