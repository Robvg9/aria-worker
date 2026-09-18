'use strict';

const fs = require('node:fs');
const path = require('node:path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const migration = read('supabase/migrations/20260918113426_meditation_notifications_v1.sql');
const gateway = read('supabase/functions/aria-device-gateway/index.ts');
const controller = read('agents/windows/aria-meditation-controller.js');
const ui = read('agents/windows/aria-meditation-ui.ps1');

const requiredKinds = ['mission_completed_verified','human_gate_required','mission_blocked','error_recoverable','error_nonrecoverable','payment_or_credential_block','mission_proposal_ready'];
for (const kind of requiredKinds) assert(migration.includes("'" + kind + "'"), 'missing notification kind: ' + kind);

for (const eventType of [
  "new.event_type = 'mission_verified'",
  "new.event_type in ('human_gate_requested','self_improvement_human_gate')",
  "new.event_type = 'mission_blocked'",
  "new.event_type = 'mission_dead_lettered'",
  "new.event_type = 'mission_failed'",
  "new.event_type in ('mission_created','mission_queued')"
]) assert(migration.includes(eventType), 'missing event mapping: ' + eventType);

assert(/source_event_id bigint not null unique/i.test(migration), 'notification dedupe key missing');
assert(migration.includes('on conflict (source_event_id) do nothing'), 'trigger idempotency missing');
assert(migration.includes('trg_meditation_notifications_on_event'), 'notification trigger missing');
assert(gateway.includes("p==='/v1/meditation/notifications'"), 'notification read route missing');
assert(gateway.includes("p==='/v1/meditation/notifications/read'"), 'notification ack route missing');
assert(gateway.includes('external_channels:{configured:false,channels:[]}'), 'external channel governance boundary missing');
assert(controller.includes("url.pathname === '/notifications'"), 'controller notification GET route missing');
assert(controller.includes("url.pathname === '/notifications/read'"), 'controller notification POST route missing');
assert(ui.includes("$notificationsTab.Text = 'NOTIFICACIONES'"), 'notification UI tab missing');
assert(ui.includes('function Refresh-Notifications'), 'notification refresh missing');
assert(ui.includes('function Mark-SelectedNotificationRead'), 'single notification read action missing');
assert(ui.includes('function Mark-AllNotificationsRead'), 'mark-all read action missing');
assert(/Refresh-Notifications\s*\[void\]\$form\.ShowDialog\(\)/.test(ui), 'notification UI initial load missing');
assert((ui.match(/Refresh-Notifications/g) || []).length >= 3, 'notification UI timer/initial refresh hooks missing');

console.log('MEDITATION IA NOTIFICATIONS CONTRACT: PASS');
console.log(JSON.stringify({required_event_classes: requiredKinds.length, traceability: true, dedupe_key: 'source_event_id', local_center: true, external_channels: {configured: false}}, null, 2));