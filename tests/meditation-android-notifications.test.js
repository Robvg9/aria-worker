'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

const migration = read('supabase/migrations/20260926120000_meditation_android_notifications_v2.sql');
const pwaCutover = read('supabase/migrations/20260920002111_meditation_pwa_notifications_cutover_v2.sql');
const notifications = read('supabase/migrations/20260918113426_meditation_notifications_v1.sql');
const humanLanguage = read('supabase/migrations/20260918235000_meditation_notification_human_language_v1.sql');
const agent = read('agents/termux/aria-agent.js');
const registry = JSON.parse(read('devices/registry.json'));

assert.match(notifications, /meditation_notifications/);
assert.match(humanLanguage, /meditation_notification_mission_label/);
assert.match(pwaCutover, /trg_meditation_android_notification_delivery/);
assert.match(pwaCutover, /only active client delivery path/i);

assert.match(migration, /enqueue_meditation_android_notification_jobs_v2/);
assert.match(migration, /trg_meditation_android_notification_delivery_v2/);
assert.match(migration, /android\.notification/);
assert.match(migration, /status = 'online'/);
assert.match(migration, /notifications\.push/);
assert.match(migration, /on conflict \(job_id\) do nothing/i);
assert.match(migration, /delivery_version.*v2/i);

assert.match(agent, /android\.notification/);
assert.match(agent, /termux-notification/);
assert.match(agent, /notifications\.push/);
assert.match(agent, /supported operation/);
execFileSync(process.execPath, ['--check', path.join(__dirname, '..', 'agents/termux/aria-agent.js')], { stdio: 'pipe' });

const android = registry.resources.find(d => d.device_id === 'device_android_runtime');
assert.ok(android);
assert.ok(android.capabilities.includes('notifications.push'));

console.log('MEDITATION IA ANDROID NOTIFICATIONS CONTRACT: PASS');
console.log(JSON.stringify({
  canonical_ledger: true,
  pwa_delivery: true,
  android_termux_delivery: true,
  online_device_gate: true,
  syntax_check: true,
  dedupe: 'job_id',
  delivery_version: 'v2'
}, null, 2));
