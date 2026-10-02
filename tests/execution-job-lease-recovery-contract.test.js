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


const deviceRerouteMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261002035000_governed_device_reroute_claim_recovery_v1.sql'),
  'utf8'
);
const runner = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'index.ts'),
  'utf8'
);
const forensic = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'forensic-continuity-fixes.ts'),
  'utf8'
);

assert.ok(deviceRerouteMigration.includes("v_device_status <> 'online'"));
assert.ok(deviceRerouteMigration.includes("q.status='queued'"));
assert.ok(deviceRerouteMigration.includes("j.status='queued'"));
assert.ok(deviceRerouteMigration.includes("q.device_id IS NULL"));
assert.ok(deviceRerouteMigration.includes("target.status = 'online'"));
assert.ok(deviceRerouteMigration.includes("job.device_rerouted"));
assert.ok(deviceRerouteMigration.includes("running_reassignment',false"));
assert.ok(deviceRerouteMigration.includes("v_device_capabilities @> jsonb_build_array(q.operation)"));

assert.ok(runner.includes("async function resolveDeviceTarget"));
assert.ok(runner.includes("device_target_resolved"));
assert.ok(runner.includes("buildDeviceEnqueuePayload(V, missionId, step, jobId, resolution.resolved_device_id)"));
assert.ok(forensic.includes("resolvedDeviceId?: string | null"));
assert.ok(forensic.includes("resolved_device_id: resolvedDeviceId || step.target?.device_id || null"));

console.log('governed-device-reroute PASS');


const missionProgressSource = runner;
assert.ok(missionProgressSource.includes("const recoveredFromResults"));
assert.ok(missionProgressSource.includes("resultsSource[id]"));
assert.ok(missionProgressSource.includes("resultIsVerifiedSuccess(resultsSource[id])"));
assert.ok(missionProgressSource.includes("const recoveredFromHistory"));
assert.ok(missionProgressSource.includes("const recovered = [...new Set([...recoveredFromResults, ...recoveredFromHistory])];"));

console.log('mission-progress-preservation PASS');

console.log('execution-job-lease-recovery PASS');
