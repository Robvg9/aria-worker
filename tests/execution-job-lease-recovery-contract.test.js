'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260922234000_execution_job_lease_recovery_v2.sql'),
  'utf8'
);

assert.ok(migration.includes("status='claimed'"));
assert.ok(migration.includes("status='running'"));
assert.ok(migration.includes("lease_until IS NOT NULL"));
assert.ok(migration.includes("status='timeout'"));
assert.ok(migration.includes("stale_running_lease"));
assert.ok(migration.includes("INSERT INTO aria_internal.execution_job_events"));
assert.ok(migration.includes("greatest(j.timeout_ms, 1000) + 60000"));
assert.ok(migration.includes("lease_owner"));
assert.ok(migration.includes("lease_until"));
assert.ok(migration.includes("recovery_count"));
assert.ok(migration.includes("DO NOT requeue") || migration.includes("never silently requeued") || migration.includes("duplicate"));

console.log('execution-job-lease-recovery PASS');
