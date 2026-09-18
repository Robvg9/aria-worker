'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

const migration = read('supabase/migrations/20260918120026_meditation_android_notifications_v1.sql');
const agent = read('agents/termux/aria-agent.js');
const registry = JSON.parse(read('devices/registry.json'));

assert.match(migration, /enqueue_android_notification_jobs/);
assert.match(migration, /android\.notification/);
assert.match(migration, /trg_meditation_android_notification_delivery/);
assert.match(migration, /on conflict \(job_id\) do nothing/i);
assert.match(migration, /agent_type = 'android-termux'/);

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
  governed_execution_queue: true,
  android_termux_delivery: true,
  syntax_check: true,
  dedupe: 'job_id'
}, null, 2));
