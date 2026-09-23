'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20260923130000_sync_enqueue_execution_job_gateway_wrapper.sql'),
  'utf8'
);

assert.match(migration, /CREATE OR REPLACE FUNCTION aria_internal\.enqueue_android_ui_job/);
assert.match(migration, /'start_url','start_app','max_steps'/);
assert.match(migration, /coalesce\(v_payload->>'mode',''\) = 'autonomous_test'/);
assert.match(migration, /IF p_operation = 'computer\.use\.android'/);
assert.match(migration, /RETURN aria_internal\.enqueue_android_ui_job/);
assert.match(migration, /RETURN aria_internal\.enqueue_execution_job/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.enqueue_execution_job_gateway/);

console.log('ANDROID ENQUEUE GATEWAY WRAPPER CONTRACT: PASS');
