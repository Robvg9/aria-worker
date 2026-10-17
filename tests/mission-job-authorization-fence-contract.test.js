'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20261017180000_mission_job_authorization_fence_v1.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

const requiredSqlFragments = [
  'CREATE OR REPLACE FUNCTION aria_internal.cancel_unauthorized_pending_jobs',
  "j.status IN ('queued','claimed')",
  "status = CASE WHEN j.status = 'queued' THEN 'blocked' ELSE 'cancelled' END",
  'CREATE TRIGGER trg_mission_job_authorization_fence',
  'CREATE OR REPLACE FUNCTION public.start_execution_job_gateway',
  'fail_closed:mission_not_authorized_at_start',
  'CREATE OR REPLACE FUNCTION public.claim_execution_job_gateway',
  'fail_closed:mission_not_authorized_at_claim',
  'CREATE OR REPLACE FUNCTION public.enqueue_execution_job_gateway',
  'mission_not_authorized_for_execution',
  'FOR UPDATE',
  'enqueue_android_ui_job',
  'enqueue_android_notification_job',
  'enqueue_execution_job('
];

for (const fragment of requiredSqlFragments) {
  assert.ok(sql.includes(fragment), `authorization fence migration missing required fragment: ${fragment}`);
}

console.log('mission job authorization fence contract tests passed');
