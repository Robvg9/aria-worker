// Mission Wonder 2 — Step 4 A4: controlled recovery contract.
//
// Pins the code-level guarantees of the recovery mechanism BEFORE it ever runs:
//   1. The migration creates ONLY a guarded RPC; it never inserts mission rows and
//      never invokes the runner. Scope transition is exclusively revoked -> bound
//      with a bounded 45-minute window, and 'completed' scopes are never mutated.
//   2. Every mutation is identity-verified against the mission metadata AND the
//      scope row (six checks), so no other mission/scope can ever be recovered.
//   3. Idempotency: a second call returns already_recovered without a new audit event.
//   4. Exactly one audit event per mutating recovery, of an allowed event_type.
//   5. The recovery-tick script dispatches the runtime tick exactly once, performs
//      zero writes of SQL kind, never revokes, and fails closed before dispatch.
//   6. The read-only diagnostic script cannot write (no --yes, no write mode).
//   7. The recovery workflow is a human-gated dispatch channel: workflow_dispatch
//      only, dry-run by default, and it refuses to dispatch unless the RPC accepted
//      the recovery identity first.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(process.argv[1]), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const migration = read('supabase/migrations/20261105120000_aria_m22_a4_recover_mission_v1.sql');
const tickScript = read('rwht/pc-browser/mission-wonder-2-step4-a4-recovery-tick.mjs');
const diagScript = read('rwht/pc-browser/mission-wonder-2-step4-a4-state-diag.mjs');
const recoveryWorkflow = read('.github/workflows/mission-wonder-2-step4-a4-controlled-recovery.yml');
const diagWorkflow = read('.github/workflows/mission-wonder-2-step4-a4-state-diag.yml');

// --- 1. Migration shape: function only, guarded, no mission-row insertion, no runner call.
assert.equal((migration.match(/\$function\$/g) || []).length, 2, 'exactly one SQL function body');
assert.doesNotMatch(migration, /create table/i, 'recovery migration must not create tables');
assert.match(migration, /create or replace function aria_internal\.aria_m22_a4_recover_mission_v1\(/);
assert.doesNotMatch(migration, /insert into aria_internal\.mission_state/i,
  'recovery must never insert mission rows');
assert.doesNotMatch(migration, /aria_mission_claim|aria_canonical_runtime|functions\/v1/i,
  'recovery must never claim or invoke the runner');
assert.match(migration, /revoke all on function aria_internal\.aria_m22_a4_recover_mission_v1\(text,text,text,text,text\) from public,anon,authenticated;/);
assert.match(migration, /grant execute on function aria_internal\.aria_m22_a4_recover_mission_v1\(text,text,text,text,text\) to service_role;/);

// --- 2. Exclusive scope transition: revoked -> bound only, bounded, completed untouchable.
assert.match(migration, /status='bound',\s*\n\s*expires_at=clock_timestamp\(\)\+interval '45 minutes'/);
assert.match(migration, /where scope_id=v_scope\.scope_id\s*\n\s*and status='revoked';/,
  'the re-arm UPDATE must only start from the revoked state');
const scopeStatusChecks = migration.match(/status in \('succeeded','failed','blocked','cancelled','timeout'\)/) !== null
  && /v_scope\.status='completed'/.test(migration)
  && /v_scope\.status not in \('revoked','bound'\)/.test(migration);
assert.ok(scopeStatusChecks, 'terminal/no-op guards must reject terminals, completed scopes and unexpected scope states');

// --- 3. Identity chain: all six checks must be enforced before any mutation.
for (const field of [
  "mission_wonder_2_a4_scope_id','')<>btrim(p_scope_id)",
  "mission_wonder_2_a4_goal_hash','')<>btrim(p_goal_hash)",
  "mission_wonder_2_a4_readonly','')<>'true'",
  "request_id','')<>btrim(p_request_id)",
  "user_id','')<>btrim(p_user_id)",
  "mission_wonder_2_a4_allowed_device_id','')<>v_scope.allowed_device_id",
]) {
  assert.ok(migration.includes(field), 'identity check missing: ' + field);
}
// Scope-row identity join must pin mission_id + owner + request + goal hash.
assert.match(migration, /where scope_id=btrim\(p_scope_id\)\s*\n\s*and mission_id=btrim\(p_mission_id\)/);
assert.match(migration, /and owner_user_id=btrim\(p_user_id\)/);
assert.match(migration, /and request_id=btrim\(p_request_id\)/);
assert.match(migration, /and goal_hash=btrim\(p_goal_hash\)/);

// --- 4. Idempotency + single audit event.
assert.match(migration, /already_recovered/);
assert.match(migration, /v_rearmed=1 or v_stamped=1/,
  'the audit event fires only when the recovery actually mutated something');
assert.match(migration, /'mission_resumed'/,
  'audit event type must exist in the closed mission_events catalog');
assert.equal((migration.match(/insert into aria_internal\.mission_events/g) || []).length, 1);

// --- 5. Recovery tick script: single dispatch, no SQL writes, no revoke, fail-closed preflight.
assert.equal((tickScript.match(/fetch\(TICK_URL/g) || []).length, 1, 'runtime tick must be dispatched exactly once');
assert.doesNotMatch(tickScript, /--yes/, 'recovery tick script must run only READ-ONLY SQL');
assert.doesNotMatch(tickScript, /revoke|aria_m22_a4_revoke/i, 'recovery tick must never revoke');
assert.match(tickScript, /A4_RECOVERY_PREFLIGHT_PASS/, 'fail-closed preflight must gate the dispatch');
assert.match(tickScript, /DESIGN ONLY — NOT EXECUTED YET/, 'authorization notice must be present');

// --- 6. Diagnostic script is read-only by construction.
assert.doesNotMatch(diagScript, /['"`]--yes['"`]/, 'diagnostic must never use the write flag');
assert.match(diagScript, /--read-only/);
assert.doesNotMatch(diagScript, /INSERT INTO|UPDATE aria_internal|DELETE FROM/i,
  'diagnostic must not contain any mutating SQL');

// --- 7. Workflows: gated channels only.
assert.match(diagWorkflow, /READ-ONLY/);
assert.doesNotMatch(diagWorkflow, /--yes|execute_recovery_tick/);
assert.match(recoveryWorkflow, /on:\s*\n\s*workflow_dispatch:/, 'recovery channel must be dispatch-only');
assert.doesNotMatch(recoveryWorkflow, /workflow_run:|schedule:|push:/, 'recovery channel must never auto-run');
assert.match(recoveryWorkflow, /execute_recovery_tick/, 'recovery dispatch must be explicitly requested');
assert.match(recoveryWorkflow, /case "\$ACTION" in\s*\n\s*recovered\|already_recovered\)/,
  'recovery workflow must refuse to tick unless the identity-verified RPC accepted');

console.log('mission-wonder-2-step4-a4-recovery contract: PASS');
