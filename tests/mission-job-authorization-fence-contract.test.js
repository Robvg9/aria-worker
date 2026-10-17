'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261017180000_mission_job_authorization_fence_v1.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

assert.match(sql, /CREATE OR REPLACE FUNCTION aria_internal\.cancel_unauthorized_pending_jobs/);
assert.match(sql, /j\.status IN \('queued','claimed'\)/);
assert.match(sql, /status = CASE WHEN j\.status = 'queued' THEN 'blocked' ELSE 'cancelled' END/);
assert.match(sql, /CREATE TRIGGER trg_mission_job_authorization_fence/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.start_execution_job_gateway/);
assert.match(sql, /fail_closed:mission_not_authorized_at_start/);
assert.match(sql, /FOR UPDATE/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.enqueue_execution_job_gateway/);
assert.match(sql, /mission_not_authorized_for_execution/);
assert.match(sql, /enqueue_android_ui_job/);
assert.match(sql, /enqueue_android_notification_job/);
assert.match(sql, /enqueue_execution_job\(/);
console.log('mission job authorization fence contract tests passed');
