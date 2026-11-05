// Mission Wonder 2 — Step 4 A4: controlled recovery contract v2.
//
// Pins the code-level guarantees of the recovery mechanism BEFORE it ever runs,
// per the independent PR review:
//   1. The migration creates ONLY two guarded RPCs; it never inserts mission rows
//      and never invokes the runner. Scope transition is exclusively revoked ->
//      bound with a bounded 45-minute window; 'completed' scopes are never mutated.
//   2. Both RPCs are LOCKED to mission_id 'mission_a4_authorized_once' and verify
//      the exact scope_key before any mutation, with strict regex validation of
//      scope_id, goal_hash, request_id, user_id and grant_ref, SECURITY DEFINER,
//      restricted search_path and EXECUTE reserved to service_role.
//   3. Physical agent eligibility (authenticated, online, heartbeat < 180 s,
//      shell.execute, exact allowed device, exactly ONE candidate) is enforced
//      server-side in the recovery RPC before the re-arm AND in the claim RPC
//      before handover, re-verified read-only by the tick script preflight.
//   4. The ONE runtime tick is governed by a transactional persisted dispatch
//      reservation granted at most once (grant_ref persisted) and flipped to
//      consumed exactly once by an atomic claim; every other claim outcome
//      (already consumed, not granted, refused) aborts the workflow BEFORE any
//      tick, and a rerun cannot dispatch again.
//   5. The recovery-tick script dispatches the runtime tick exactly once, performs
//      zero SQL writes, never revokes, and fails closed before dispatch unless the
//      consumed reservation and agent eligibility are both verified.
//   6. The read-only diagnostic script cannot write (no --yes, no write mode).
//   7. The recovery workflow is a human-gated dispatch channel: workflow_dispatch
//      only, dry-run by default, three sequential gates, and it refuses to tick
//      unless the claim RPC returned token_claimed.
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

const LOCKED_MISSION_ID = 'mission_a4_authorized_once';
const LOCKED_SCOPE_KEY = 'mission-wonder-2-step4-a4:single-authorized-execution';

// --- 1. Migration shape: exactly two functions, guarded, no mission-row insertion.
assert.equal((migration.match(/\$function\$/g) || []).length, 4, 'exactly two SQL function bodies');
assert.doesNotMatch(migration, /create table/i, 'recovery migration must not create tables');
assert.match(migration, /create or replace function aria_internal\.aria_m22_a4_recover_mission_v1\(/);
assert.match(migration, /create or replace function aria_internal\.aria_m22_a4_claim_recovery_dispatch_token_v1\(/);
assert.doesNotMatch(migration, /insert into aria_internal\.mission_state/i,
  'recovery must never insert mission rows');
assert.doesNotMatch(migration, /aria_mission_claim|aria_canonical_runtime|functions\/v1/i,
  'recovery must never claim or invoke the runner');
assert.match(migration, /revoke all on function aria_internal\.aria_m22_a4_recover_mission_v1\(text,text,text,text,text,text\) from public,anon,authenticated;/);
assert.match(migration, /revoke all on function aria_internal\.aria_m22_a4_claim_recovery_dispatch_token_v1\(text,text,text\) from public,anon,authenticated;/);
assert.match(migration, /grant execute on function aria_internal\.aria_m22_a4_recover_mission_v1\(text,text,text,text,text,text\) to service_role;/);
assert.match(migration, /grant execute on function aria_internal\.aria_m22_a4_claim_recovery_dispatch_token_v1\(text,text,text\) to service_role;/);

// Both functions must be SECURITY DEFINER with a restricted search_path only.
assert.equal((migration.match(/security definer/g) || []).length, 2);
assert.equal((migration.match(/set search_path to 'pg_catalog', 'aria_internal'/g) || []).length, 2);

// --- 2. Identity hardening in BOTH functions.
// mission_id hard lock: both functions must reject any other mission id before any work.
const lockBlocks = migration.match(/if coalesce\(btrim\(p_mission_id\),''\) <> 'mission_a4_authorized_once' then\n\s*return jsonb_build_object\('action','rejected','reason','mission_id_not_locked'\);/g) || [];
assert.equal(lockBlocks.length, 2, 'both RPCs must lock p_mission_id to mission_a4_authorized_once');

// Exact scope_key verification inside both functions.
assert.equal((migration.match(/scope_key='mission-wonder-2-step4-a4:single-authorized-execution'/g) || []).length, 2,
  'both RPCs must verify the exact scope_key');

// Strict argument validation: scope_id, goal_hash, request_id, user_id, grant_ref.
assert.match(migration, /p_scope_id\) !~ '\^\[A-Za-z0-9_-\]\{8,120\}\$'/);
assert.match(migration, /p_goal_hash\) !~ '\^\[0-9a-f\]\{64\}\$'/);
assert.match(migration, /p_request_id\) !~ '\^\[a-f0-9-\]\{10,80\}\$'/);
assert.match(migration, /p_user_id\) !~ '\^\[a-f0-9-\]\{10,80\}\$'/);
assert.match(migration, /btrim\(p_grant_ref\) !~ '\^\[A-Za-z0-9_\.:\\\/-\]\{4,120\}\$'/);

// Exclusive scope transition: revoked -> bound only, bounded, completed untouchable.
assert.match(migration, /status='bound',\s*\n\s*expires_at=clock_timestamp\(\)\+interval '45 minutes'/);
assert.match(migration, /where scope_id=v_scope\.scope_id\s*\n\s*and status='revoked';/,
  'the re-arm UPDATE must only start from the revoked state');
assert.match(migration, /v_scope\.status='completed'/);
assert.match(migration, /v_scope\.status not in \('revoked','bound'\)/);

// Identity chain: all six checks must be enforced before any mutation.
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

// --- 3. Dispatch reservation: grant once, claim exactly once, rerun-safe.
// Explicit parent construction: the grant writes ONE top-level key built from a
// single jsonb_build_object (granted, granted_at, grant_ref in one atomic UPDATE),
// never relying on jsonb_set creating nested intermediates.
assert.match(migration, /coalesce\(v_mission\.metadata->'a4_recovery_dispatch_v1', '\{\}'::jsonb\)/,
  'the grant must read the parent object explicitly (absent-parent safe)');
assert.match(migration,
  /jsonb_build_object\(\s*\n\s*'granted', true,\s*\n\s*'granted_at', clock_timestamp\(\)::text,\s*\n\s*'grant_ref', btrim\(p_grant_ref\)\s*\n\s*\)/,
  'granted/granted_at/grant_ref must be persisted in ONE atomic update');
assert.match(migration, /jsonb_set\(metadata,'\{a4_recovery_dispatch_v1\}'/,
  'the write must replace ONE explicit top-level key');
// Persistence must be demonstrated by a re-read inside the transaction; any
// inconsistency raises and rolls the whole call back (including the re-arm).
assert.equal((migration.match(/select metadata->'a4_recovery_dispatch_v1'(, status)? into v_dispatch/g) || []).length, 2,
  'both grant and claim must verify persistence by re-reading the metadata');
assert.match(migration, /aria_m22_a4_dispatch_persist_failed/, 'grant verification must raise on inconsistency');
assert.match(migration, /aria_m22_a4_dispatch_grant_not_applied/, 'grant row-count must be checked');
assert.match(migration, /aria_m22_a4_claim_persist_failed/, 'claim verification must raise on inconsistency');
assert.match(migration, /'token_claimed'/, 'the claim must return token_claimed exactly once');
assert.match(migration, /'dispatch_already_consumed'/, 'a consumed reservation must reject further claims');
assert.match(migration, /'dispatch_not_granted'/, 'a claim without a grant must be rejected');
assert.match(migration, /'dispatch_grant_ref_mismatch'/, 'a claim with a foreign grant_ref must be rejected');
// Atomic single-token race guard: the consumed flip must count its updated rows and
// reject any second concurrent winner.
assert.match(migration,
  /if v_claimed<>1 then\s*\n\s*return jsonb_build_object\('action','rejected','reason','dispatch_already_consumed'\);\s*\n\s*end if;/,
  'the token flip must be a guarded atomic claim (concurrency-safe)');
// The re-arm race guard must also exist (two concurrent recoveries cannot both win).
assert.match(migration, /'scope_rearm_race'/);

// Idempotency + single audit event.
assert.match(migration, /v_rearmed=1 or v_stamped=1/,
  'the audit event fires only when the recovery actually mutated something');
assert.match(migration, /'mission_resumed'/);
assert.equal((migration.match(/insert into aria_internal\.mission_events/g) || []).length, 1);

// --- 4. Physical agent eligibility gate, SERVER-SIDE, in both RPCs.
const eligibilityPattern = /d\.device_id = v_scope\.allowed_device_id\s*\n\s*and d\.agent_type = 'windows-local'\s*\n\s*and d\.status = 'online'\s*\n\s*and d\.token_hash is not null\s*\n\s*and d\.capabilities @> '\["shell\.execute"\]'::jsonb\s*\n\s*and d\.last_seen_at > clock_timestamp\(\) - interval '180 seconds'/g;
const serverSideChecks = migration.match(eligibilityPattern) || [];
assert.equal(serverSideChecks.length, 2,
  'both the recovery RPC and the claim RPC must enforce agent eligibility server-side');
assert.match(migration, /'agent_not_eligible','eligible_count',v_eligible_count/,
  'each eligibility failure must reject with an explicit reason before any mutation');
assert.match(migration, /v_scope\.expires_at <= clock_timestamp\(\) then/,
  'the claim must also require a fresh bounded scope window');

// Tick script: physical eligibility gate #2 right before the single dispatch.
assert.match(tickScript, /A4_RECOVERY_AGENT_ELIGIBLE_PASS/, 'tick preflight must re-verify agent eligibility (read-only)');
assert.match(tickScript, /180 seconds/, 'tick preflight must use the 180 s heartbeat window');

// --- 5. Recovery tick script bounds.
assert.equal((tickScript.match(/fetch\(TICK_URL/g) || []).length, 1, 'runtime tick must be dispatched exactly once');
assert.doesNotMatch(tickScript, /['"`]--yes['"`]/, 'recovery tick script must run only READ-ONLY SQL');
assert.doesNotMatch(tickScript, /revoke/i, 'recovery tick must never revoke');
assert.match(tickScript, /A4_RECOVERY_PREFLIGHT_PASS/, 'fail-closed preflight must gate the dispatch');
assert.match(tickScript, /A4_DISPATCH_TOKEN_CLAIMED must be true/, 'the script must require a server-side token claim');
assert.match(tickScript, /a4_recovery_dispatch_v1'->>'consumed'='true'/,
  'preflight must verify the reservation was consumed before dispatching');
assert.match(tickScript, /a4_recovery_dispatch_v1'->>'grant_ref'/,
  'preflight must verify the persisted grant_ref matches the claimed run');

// --- 6. Diagnostic script is read-only by construction.
assert.doesNotMatch(diagScript, /['"`]--yes['"`]/, 'diagnostic must never use the write flag');
assert.match(diagScript, /--read-only/);
assert.doesNotMatch(diagScript, /INSERT INTO|UPDATE aria_internal|DELETE FROM/i,
  'diagnostic must not contain any mutating SQL');

// --- 7. Workflows: gated channels only.
assert.match(diagWorkflow, /READ-ONLY/);
assert.doesNotMatch(diagWorkflow, /(['"`]--yes['"`])|execute_recovery_tick/);
assert.match(recoveryWorkflow, /on:\s*\n\s*workflow_dispatch:/, 'recovery channel must be dispatch-only');
assert.doesNotMatch(recoveryWorkflow, /workflow_run:|schedule:|push:/, 'recovery channel must never auto-run');
assert.match(recoveryWorkflow, /execute_recovery_tick/, 'recovery dispatch must be explicitly requested');

// Three sequential gates; the tick must only run through a successful token claim.
assert.match(recoveryWorkflow, /aria_internal\.aria_m22_a4_recover_mission_v1\('mission_a4_authorized_once',/, 'gate 1 calls the locked recovery RPC');
assert.match(recoveryWorkflow, /aria_internal\.aria_m22_a4_claim_recovery_dispatch_token_v1\('mission_a4_authorized_once',/, 'gate 2 calls the locked claim RPC');
assert.match(recoveryWorkflow, /token_claimed\)/, 'gate 2 must accept the token_claimed outcome exclusively');
assert.match(recoveryWorkflow, /A4_TOKEN_CLAIM_REFUSED action=\$ACTION \(already consumed/,
  'gate 2 must abort with no tick when the reservation is consumed/unavailable');
assert.match(recoveryWorkflow, /A4_DISPATCH_TOKEN_CLAIMED: \$\{\{ env\.A4_DISPATCH_TOKEN_CLAIMED \}\}/,
  'gate 3 must receive the claimed-token environment from gate 2 only');
assert.match(recoveryWorkflow, /agent_type='windows-local'/, 'read-only agent eligibility evidence must be captured');
assert.match(recoveryWorkflow, /180 seconds/, 'workflow agent evidence must use the 180 s heartbeat window');

console.log('mission-wonder-2-step4-a4-recovery contract: PASS');
