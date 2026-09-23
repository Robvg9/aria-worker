'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260923130000_sync_enqueue_execution_job_gateway_wrapper.sql'),
  'utf8'
);

assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enqueue_execution_job_gateway/);
assert.match(migration, /RETURN aria_internal\.enqueue_execution_job/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.enqueue_execution_job_gateway/);

const gateway = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260922191000_sync_enqueue_execution_job_full_contract.sql'),
  'utf8'
);
assert.match(gateway, /'computer\.use\.android'/);

console.log('ANDROID ENQUEUE GATEWAY WRAPPER CONTRACT: PASS');
