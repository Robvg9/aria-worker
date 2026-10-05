'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-mission-runner-v22/forensic-continuity-fixes.ts'),
  'utf8'
);
const runner = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/functions/aria-mission-runner-v22/index.ts'),
  'utf8'
);
const notificationMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20261005003000_align_android_notification_enqueue_contract_v1.sql'),
  'utf8'
);

assert.match(source, /const allowedKeys = operation === "computer\.use\.android"/);
assert.match(source, /"start_url",\s*"start_app",\s*"max_steps"/s);
assert.match(source, /__aria_attempt and\s+dependency_results/);
assert.match(source, /for \(const key of allowedKeys\)/);
assert.match(source, /input\[key\] =/);
assert.ok(
  !source.includes('const input = step.input && typeof step.input === "object" ? { ...step.input } : {};'),
  'Android payload must not spread the complete planner input'
);

console.log('MISSION RUNNER DEVICE PAYLOAD SANITIZATION: PASS');


assert.match(source, /"android\.notification"/);
assert.match(source, /notification_id.*title.*message.*severity.*kind.*mission_id.*priority/);
assert.match(runner, /operation === "android\.notification".*notifications\.push/s);
assert.match(notificationMigration, /CREATE OR REPLACE FUNCTION aria_internal\.enqueue_android_notification_job/);
assert.match(notificationMigration, /'android\.notification'/);
assert.match(notificationMigration, /notifications\.push/);
assert.match(notificationMigration, /public\.enqueue_execution_job_gateway/);
console.log('ANDROID NOTIFICATION ENQUEUE CONTRACT: PASS');
