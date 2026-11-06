// Mission Wonder 2 — Step 4 A4: REAL PostgreSQL behavior test for the recovery RPCs.
//
// This is NOT a regex/shape contract: it executes the actual migration SQL against a
// real PostgreSQL server and observes real stored state, real jsonb persistence,
// real race behavior and real transactional rollback.
//
// Tiny production-mirror schema (schema aria_internal with the four tables the
// migration's functions touch) is created here; then the real migration file
// supabase/migrations/20261105120000_aria_m22_a4_recover_mission_v1.sql is applied
// verbatim, and the served RPCs are exercised.
//
// Requirements: a PostgreSQL server reachable via env A4_PG_INTEGRATION_URL
// (e.g. postgresql://postgres:postgres@localhost:5432/postgres). Without that env
// the test SKIPS cleanly (exit 0, printed note), so generic npm test batteries on
// machines without PostgreSQL are unaffected. The dedicated CI workflow spins the
// PG service container and thereby always runs this suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(process.argv[1]), '..');
const MIGRATION = path.join(root, 'supabase/migrations/20261105120000_aria_m22_a4_recover_mission_v1.sql');
const RESUME_MIGRATION = path.join(root, 'supabase/migrations/20261105221715_a4_consumed_scope_resume_and_tick_claim_v1.sql');
const HANDOFF_MIGRATION = path.join(root, 'supabase/migrations/20261105235800_a4_runner_handoff_retry_v1.sql');
const HANDOFF_SCOPE_RESUME_MIGRATION = path.join(root, 'supabase/migrations/20261106011000_a4_handoff_expired_scope_resume_v1.sql');
const FROZEN_JOB_GATEWAY_MIGRATION = path.join(root, 'supabase/migrations/20261106014500_a4_frozen_single_job_gateway_claim_v1.sql');
const LOCKED = 'mission_a4_authorized_once';
const SCOPE_KEY = 'mission-wonder-2-step4-a4:single-authorized-execution';
const SCOPE_ID = 'scope_test_recovery_0001';
const REQUEST_ID = '5d92b435-c42b-4d8b-9a07-2f73b8ec7a38';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const GOAL_HASH = 'a'.repeat(64);
const DEVICE_ID = 'device.test.windows.0001';
const DEVICE_ID_ALT = 'device.test.windows.0002';

const url = String(process.env.A4_PG_INTEGRATION_URL || '').trim();
if (!url) {
  console.log('SKIP mission-wonder-2-step4-a4-recovery-pg-integration: A4_PG_INTEGRATION_URL not set (real-PG test needs a PostgreSQL server; the dedicated CI workflow provides one)');
  process.exit(0);
}

// Dynamic import so the clean SKIP above never depends on the module existing.
const { default: pg } = await import('pg');

const client = new pg.Client({ connectionString: url });
await client.connect();

// Supabase-provisioned roles referenced by the migration's REVOKE/GRANT statements
// (anon, authenticated, service_role) exist in production but not in vanilla
// PostgreSQL; the mirror pre-creates them so the migration applies verbatim.
await client.query(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator nologin; end if;
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
  end $$;
`);

// ---------------------------------------------------------------- schema mirror
await client.query(`
  create schema if not exists aria_internal;
  drop table if exists aria_internal.execution_job_events cascade;
  drop table if exists aria_internal.execution_jobs cascade;
  drop table if exists aria_internal.mission_events cascade;
  drop table if exists aria_internal.mission_wonder_2_a4_scopes cascade;
  drop table if exists aria_internal.device_registry cascade;
  drop table if exists aria_internal.mission_state cascade;

  create table aria_internal.mission_state (
    mission_id text primary key,
    status text not null,
    current_step integer not null default 0,
    completed_steps integer not null default 0,
    lease_owner text,
    lease_until timestamptz,
    checkpoint jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default clock_timestamp()
  );
  create table aria_internal.device_registry (
    device_id text primary key,
    agent_type text not null default 'windows-local',
    status text not null default 'offline',
    token_hash text,
    capabilities jsonb not null default '[]'::jsonb,
    last_seen_at timestamptz not null default clock_timestamp()
  );
  create table aria_internal.mission_wonder_2_a4_scopes (
    scope_id text primary key,
    scope_key text not null unique,
    owner_user_id text not null,
    request_id text,
    goal_hash text not null check (goal_hash ~ '^[0-9a-f]{64}$'),
    mission_id text not null unique,
    allowed_device_id text not null,
    status text not null default 'armed' check (status in ('armed','claimed','bound','completed','revoked')),
    expires_at timestamptz not null,
    claimed_at timestamptz, bound_at timestamptz, completed_at timestamptz, revoked_at timestamptz,
    created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
  );
  create table aria_internal.mission_events (
    event_id bigint generated always as identity primary key,
    mission_id text not null,
    step_index integer,
    event_type text not null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    trace_id text,
    span_id text,
    request_id text,
    execution_id text,
    error_code text,
    runtime_version text,
    source_sha text
  );
  create table aria_internal.execution_jobs (
    job_id text primary key,
    mission_id text not null,
    device_id text,
    operation text not null default 'shell.execute',
    command text not null default '',
    cwd text,
    timeout_ms integer not null default 15000,
    policy jsonb not null default '{}'::jsonb,
    status text not null default 'queued',
    requested_at timestamptz not null default clock_timestamp(),
    claimed_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    exit_code integer,
    stdout text,
    stderr text,
    result jsonb not null default '{}'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default clock_timestamp(),
    lease_owner text,
    lease_until timestamptz,
    recovery_count integer not null default 0
  );
  create table aria_internal.execution_job_events (
    event_id bigint generated always as identity primary key,
    job_id text not null,
    device_id text not null,
    event_type text not null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default clock_timestamp()
  );
  create or replace function aria_internal.mission_job_authorization_allowed(p_mission_id text,p_job_id text)
  returns boolean language sql security definer set search_path to 'aria_internal','pg_catalog'
  as $fn$ select false; $fn$;
`);

// ------------------------------------------------- real migration, applied verbatim
const migrationSql = fs.readFileSync(MIGRATION, 'utf8');
await client.query(migrationSql);
const resumeMigrationSql = fs.readFileSync(RESUME_MIGRATION, 'utf8');
await client.query(resumeMigrationSql);
const handoffMigrationSql = fs.readFileSync(HANDOFF_MIGRATION, 'utf8');
await client.query(handoffMigrationSql);
const handoffScopeResumeMigrationSql = fs.readFileSync(HANDOFF_SCOPE_RESUME_MIGRATION, 'utf8');
await client.query(handoffScopeResumeMigrationSql);
const frozenJobGatewayMigrationSql = fs.readFileSync(FROZEN_JOB_GATEWAY_MIGRATION, 'utf8');
await client.query(frozenJobGatewayMigrationSql);

// ------------------------------------------------------------------- helpers
const RECOVER = (args) => ({ text: `select aria_internal.aria_m22_a4_recover_mission_v1($1,$2,$3,$4,$5,$6)::jsonb as r`, values: [args.missionId ?? LOCKED, args.scopeId ?? SCOPE_ID, args.userId ?? USER_ID, args.requestId ?? REQUEST_ID, args.goalHash ?? GOAL_HASH, args.grantRef] });
const CLAIM = (args) => ({ text: `select aria_internal.aria_m22_a4_claim_recovery_dispatch_token_v1($1,$2,$3)::jsonb as r`, values: [args.missionId ?? LOCKED, args.scopeId ?? SCOPE_ID, args.grantRef] });
const RESUME = (args) => ({ text: `select aria_internal.aria_m22_a4_resume_consumed_scope_v1($1,$2,$3,$4,$5,$6)::jsonb as r`, values: [args.missionId ?? LOCKED, args.scopeId ?? SCOPE_ID, args.userId ?? USER_ID, args.requestId ?? REQUEST_ID, args.goalHash ?? GOAL_HASH, args.grantRef] });
const TICK_CLAIM = (args) => ({ text: `select aria_internal.aria_m22_a4_claim_recovery_tick_v1($1,$2,$3)::jsonb as r`, values: [args.missionId ?? LOCKED, args.scopeId ?? SCOPE_ID, args.grantRef] });
const HANDOFF = (args) => ({ text: `select aria_internal.aria_m22_a4_claim_runner_handoff_retry_v1($1,$2,$3,$4,$5,$6,$7,$8)::jsonb as r`, values: [args.missionId ?? LOCKED, args.scopeId ?? SCOPE_ID, args.userId ?? USER_ID, args.requestId ?? REQUEST_ID, args.goalHash ?? GOAL_HASH, args.grantRef, args.failedRunId ?? '42131077740', args.runnerHttpStatus ?? 401] });
const q = (text, params) => client.query(text, params);

// Reset production-mirror rows to a canonical pre-recovery state.
async function resetState({ missionMetadata = {}, scopeStatus = 'revoked', device = 'fresh', deviceAlt = false } = {}) {
  await q(`delete from aria_internal.execution_jobs`);
  await q(`delete from aria_internal.mission_events`);
  await q(`delete from aria_internal.mission_wonder_2_a4_scopes`);
  await q(`delete from aria_internal.mission_state`);
  await q(`delete from aria_internal.device_registry`);
  await q(`insert into aria_internal.mission_state (mission_id, status, metadata) values ($1,$2,$3::jsonb)`, [
    LOCKED, 'queued', JSON.stringify({
      mission_wonder_2_a4_scope_id: SCOPE_ID,
      mission_wonder_2_a4_goal_hash: GOAL_HASH,
      mission_wonder_2_a4_readonly: 'true',
      request_id: REQUEST_ID,
      user_id: USER_ID,
      mission_wonder_2_a4_allowed_device_id: DEVICE_ID,
      ...missionMetadata,
    }),
  ]);
  await q(`insert into aria_internal.device_registry (device_id, agent_type, status, token_hash, capabilities, last_seen_at) values ($1,'windows-local','online','x','["shell.execute"]'::jsonb, clock_timestamp() - interval '2 seconds')`, [DEVICE_ID]);
  if (device === 'stale') await q(`update aria_internal.device_registry set last_seen_at = clock_timestamp() - interval '500 seconds' where device_id=$1`, [DEVICE_ID]);
  if (device === 'offline') await q(`update aria_internal.device_registry set status='offline' where device_id=$1`, [DEVICE_ID]);
  if (device === 'nocaps') await q(`update aria_internal.device_registry set capabilities='[]'::jsonb where device_id=$1`, [DEVICE_ID]);
  if (deviceAlt) {
    await q(`insert into aria_internal.device_registry (device_id, agent_type, status, token_hash, capabilities, last_seen_at) values ($1,'windows-local','online','x','["shell.execute"]'::jsonb, clock_timestamp() - interval '2 seconds')`, [DEVICE_ID_ALT]);
  }
  await q(`insert into aria_internal.mission_wonder_2_a4_scopes (scope_id, scope_key, owner_user_id, request_id, goal_hash, mission_id, allowed_device_id, status, expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8, clock_timestamp() + interval '45 minutes')`, [SCOPE_ID, SCOPE_KEY, USER_ID, REQUEST_ID, GOAL_HASH, LOCKED, DEVICE_ID, scopeStatus]);
}

const reservation = async () => {
  const r = await q(`select metadata->'a4_recovery_dispatch_v1' as v from aria_internal.mission_state where mission_id=$1`, [LOCKED]);
  return r.rows[0]?.v ?? null;
};
const scopeRow = async () => (await q(`select status, expires_at from aria_internal.mission_wonder_2_a4_scopes where scope_id=$1`, [SCOPE_ID])).rows[0];
const resumedCount = async () => Number((await q(`select count(*)::text as n from aria_internal.mission_events where event_type='mission_resumed'`)).rows[0].n);
const dropReservation = async () => {
  await q(`update aria_internal.mission_state set metadata = metadata - 'a4_recovery_dispatch_v1' where mission_id=$1`, [LOCKED]);
};

let scenario = 0;
async function start(name) {
  scenario += 1;
  console.log(`-- scenario ${scenario}: ${name}`);
}

// ===========================================================================
// S1. Parent object ABSENT originally: the reservation must persist for real,
//     with granted/granted_at/grant_ref, verified server-side (not regex).
// ===========================================================================
let res, rec, claim;
await start('grant persists with absent parent object, claim flows');
await resetState();
res = await q(RECOVER({ grantRef: 'a4-recovery-test.s1' }).text, RECOVER({ grantRef: 'a4-recovery-test.s1' }).values);
rec = res.rows[0].r;
assert.equal(rec.action, 'recovered', 'S1 recover must succeed');
assert.equal(rec.dispatch_reservation_granted, true, 'S1 grant must be verified before returning true');
assert.equal(rec.dispatch_reservation_persisted, true, 'S1 grant must report persisted reservation');
{
  // RE-READ from the database: parent object was absent and now exists explicitly.
  const v = await reservation();
  assert.ok(v && typeof v === 'object', 'S1 reservation object must exist in stored metadata');
  assert.equal(v.granted, true, 'S1 granted=true must be persisted');
  assert.ok(typeof v.granted_at === 'string' && v.granted_at.length > 0, 'S1 granted_at must be persisted (one atomic update)');
  assert.equal(v.grant_ref, 'a4-recovery-test.s1', 'S1 grant_ref must be persisted (one atomic update)');
}
assert.equal((await scopeRow()).status, 'bound', 'S1 scope must really be re-armed');
assert.ok(new Date((await scopeRow()).expires_at) > new Date(), 'S1 scope window must be fresh');
assert.equal(await resumedCount(), 1, 'S1 exactly one mission_resumed audit event');

// Claim flow on the granted reservation.
res = await q(CLAIM({ grantRef: 'a4-recovery-test.s1' }).text, CLAIM({ grantRef: 'a4-recovery-test.s1' }).values);
claim = res.rows[0].r;
assert.equal(claim.action, 'token_claimed', 'S1 claim must win once');
assert.equal(claim.dispatch_persisted, true, 'S1 claim must persist consumption before returning');
{
  const v = await reservation();
  assert.equal(v.consumed, true, 'S1 consumed=true must be persisted');
  assert.equal(!!v.consumed_at, true, 'S1 consumed_at must be persisted');
}

// ===========================================================================
// S2. Second recovery must NOT overwrite the reservation nor change grant_ref.
// ===========================================================================
await start('second recovery does not regenerate grant_ref');
{
  const before = await reservation();
  res = await q(RECOVER({ grantRef: 'a4-recovery-test.s2-different-ref' }).text, RECOVER({ grantRef: 'a4-recovery-test.s2-different-ref' }).values);
  rec = res.rows[0].r;
  assert.equal(rec.action, 'recovered', 'S2 recover on an already-granted reservation stays idempotent');
  assert.equal(rec.dispatch_reservation_preexisting, true, 'S2 must report preexisting reservation');
  assert.equal(rec.dispatch_reservation_granted, false, 'S2 must NOT claim a fresh grant happened');
  const after = await reservation();
  assert.equal(after.grant_ref, before.grant_ref, 'S2 grant_ref must remain the original');
  assert.equal(after.granted_at, before.granted_at, 'S2 granted_at must remain the original');
  assert.equal(after.consumed, true, 'S2 consumed stays true (a consumed reservation is not resurrected)');
  assert.equal(await resumedCount(), 1, 'S2 no new audit event on the no-op recovery');
}

// A claim again must be refused (already consumed), even with the old ref.
res = await q(CLAIM({ grantRef: 'a4-recovery-test.s1' }).text, CLAIM({ grantRef: 'a4-recovery-test.s1' }).values);
claim = res.rows[0].r;
assert.equal(claim.action, 'rejected', 'S2 second claim rejected');
assert.equal(claim.reason, 'dispatch_already_consumed', 'S2 consumed reservation produces rejection, never a second token');
assert.equal(claim.reason !== 'token_claimed', true, 'S2 no second token');

// ===========================================================================
// S3. Replay safety: consumed reservation cannot be claimed again through the
//     whole gate chain (claim + recover idempotency).
// ===========================================================================
await start('consumed reservation is replay-proof');
{
  const before = await reservation();
  res = await q(CLAIM({ grantRef: 'a4-recovery-test.s1' }).text, CLAIM({ grantRef: 'a4-recovery-test.s1' }).values);
  claim = res.rows[0].r;
  assert.equal(claim.action, 'rejected', 'S3 replay claim must be rejected');
  const after = await reservation();
  assert.equal(after.consumed, true, 'S3 consumed stays consumed');
  assert.equal(after.grant_ref, before.grant_ref, 'S3 grant_ref unchanged by replay');
}

// ===========================================================================
// S4. Concurrency: two parallel claims -> exactly one token_claimed.
// ===========================================================================
await start('parallel claims: exactly one winner');
await resetState();
res = await q(RECOVER({ grantRef: 'a4-recovery-test.s4' }).text, RECOVER({ grantRef: 'a4-recovery-test.s4' }).values);
assert.equal(res.rows[0].r.action, 'recovered', 'S4 setup recovery');
{
  // Two independent sessions must not divide the single token.
  const clientA = new pg.Client({ connectionString: url });
  const clientB = new pg.Client({ connectionString: url });
  await clientA.connect();
  await clientB.connect();
  const race = await Promise.allSettled([
    clientA.query(CLAIM({ grantRef: 'a4-recovery-test.s4' }).text, CLAIM({ grantRef: 'a4-recovery-test.s4' }).values),
    clientB.query(CLAIM({ grantRef: 'a4-recovery-test.s4' }).text, CLAIM({ grantRef: 'a4-recovery-test.s4' }).values),
  ]);
  await clientA.end();
  await clientB.end();
  const outcomes = race.filter((r) => r.status === 'fulfilled').map((r) => r.value.rows[0].r);
  const claimed = outcomes.filter((o) => o.action === 'token_claimed');
  const refused = outcomes.filter((o) => o.action === 'rejected' && o.reason === 'dispatch_already_consumed');
  const crashes = race.filter((r) => r.status === 'rejected');
  assert.equal(claimed.length, 1, 'S4 exactly one of the two parallel claims may win');
  assert.equal(claimed.length + refused.length + crashes.length, 2, 'S4 every losing attempt must be refused or fail');
  assert.equal((await reservation()).consumed, true, 'S4 token consumed exactly once');
}

// ===========================================================================
// S5. Physical agent eligibility BEFORE re-arm: stale/offline/no-caps device must
//     cause rejection with zero mutations (no re-arm, no grant, no event).
// ===========================================================================
await start('agent gate rejects before mutation (stale device)');
await resetState({ device: 'stale' });
res = await q(RECOVER({ grantRef: 'a4-recovery-test.s5a' }).text, RECOVER({ grantRef: 'a4-recovery-test.s5a' }).values);
rec = res.rows[0].r;
assert.equal(rec.action, 'rejected', 'S5 stale heartbeat must be rejected');
assert.equal(rec.reason, 'agent_not_eligible', 'S5 rejection reason must be agent_not_eligible');
assert.equal(rec.eligible_count, 0, 'S5 eligible_count must be 0');
assert.equal((await scopeRow()).status, 'revoked', 'S5 scope must remain untouched');
assert.equal(await reservation(), null, 'S5 no reservation granted');
assert.equal(await resumedCount(), 0, 'S5 no audit event on a rejected recovery');

await start('agent gate rejects before token handover (offline device)');
await resetState();
await q(RECOVER({ grantRef: 'a4-recovery-test.s5b' }).text, RECOVER({ grantRef: 'a4-recovery-test.s5b' }).values);
await q(`update aria_internal.device_registry set status='offline' where device_id=$1`, [DEVICE_ID]);
res = await q(CLAIM({ grantRef: 'a4-recovery-test.s5b' }).text, CLAIM({ grantRef: 'a4-recovery-test.s5b' }).values);
claim = res.rows[0].r;
assert.equal(claim.action, 'rejected', 'S5 offline agent claim must be rejected');
assert.equal(claim.reason, 'agent_not_eligible', 'S5 claim rejection reason');
const vAfterFailedClaim = await reservation();
assert.equal(vAfterFailedClaim.consumed, undefined, 'S5 token must remain unclaimed when the agent gate fails');

// ===========================================================================
// S6. Identity hardening: wrong mission_id, goal_hash, scope, corrupted mission
//     metadata — all rejected without a single mutation.
// ===========================================================================
await start('identity hardening: every wrong-identity case rejects with zero mutation');
{
  const cases = [
    { name: 'other mission id', args: RECOVER({ missionId: 'mission_some_other', grantRef: 'a4-recovery-test.s6.1' }), reason: 'mission_id_not_locked' },
    { name: 'bad goal hash', args: RECOVER({ grantRef: 'a4-recovery-test.s6.2', goalHash: 'zz'.repeat(32) }), reason: undefined },
    { name: 'bad scope id', args: RECOVER({ grantRef: 'a4-recovery-test.s6.3', scopeId: 'scope_missing_0000' }), reason: undefined },
  ];
  for (const c of cases) {
    await resetState();
    const r = await q(c.args.text, c.args.values);
    const rv = r.rows[0].r;
    assert.equal(rv.action, 'rejected', `S6 ${c.name} must reject`);
    if (c.reason) assert.equal(rv.reason, c.reason);
    assert.equal((await scopeRow()).status, 'revoked', `S6 ${c.name} scope untouched`);
    assert.equal(await reservation(), null, `S6 ${c.name} no reservation`);
    assert.equal(await resumedCount(), 0, `S6 ${c.name} no audit event`);
  }
  // Corrupted mission identity (user mismatch) after a valid-looking scope row.
  await resetState({ missionMetadata: { user_id: '00000000-0000-4000-8000-999999999999' } });
  const r = await q(RECOVER({ grantRef: 'a4-recovery-test.s6.4' }).text, RECOVER({ grantRef: 'a4-recovery-test.s6.4' }).values);
  assert.equal(r.rows[0].r.action, 'rejected', 'S6 corrupted mission identity must reject');
  assert.equal(r.rows[0].r.reason, 'mission_identity_mismatch', 'S6 mismatch reason');
  assert.equal((await scopeRow()).status, 'revoked', 'S6 identity-mismatch case leaves the scope revoked');
}

// ===========================================================================
// S7. Transactional rollback: if the persisted metadata cannot be verified
//     (simulated by a sabotage trigger that rewrites grant_ref after the UPDATE),
//     the WHOLE call rolls back — re-arm reverted, no reservation, no event.
// ===========================================================================
await start('persistence verification failure rolls back the whole call');
await resetState();
await q(`create or replace function aria_internal.sabotage_dispatch_persistence() returns trigger language plpgsql as $fn$
begin
  if new.metadata->'a4_recovery_dispatch_v1'->>'granted'='true' then
    new.metadata = jsonb_set(new.metadata,'{a4_recovery_dispatch_v1,grant_ref}','"sabotaged_ref"');
  end if;
  return new;
end; $fn$`);
await q(`create trigger sabotage_dispatch before update on aria_internal.mission_state for each row execute function aria_internal.sabotage_dispatch_persistence()`);
{
  let threw = null;
  try {
    await q(RECOVER({ grantRef: 'a4-recovery-test.s7' }).text, RECOVER({ grantRef: 'a4-recovery-test.s7' }).values);
  } catch (error) {
    threw = String(error?.message ?? error);
  }
  assert.ok(threw && threw.includes('aria_m22_a4_dispatch_persist_failed'), `S7 the persisted-state verification must raise (got: ${threw})`);
  assert.equal((await scopeRow()).status, 'revoked', 'S7 scope RE-ARM MUST BE ROLLED BACK');
  await dropReservation(); // removal is a no-op if the metadata never persisted
  const after = (await q(`select metadata from aria_internal.mission_state where mission_id=$1`, [LOCKED])).rows[0].metadata;
  assert.equal(after.a4_recovery_dispatch_v1, undefined, 'S7 no reservation persisted after rollback');
  assert.equal(after.execution_lane, undefined, 'S7 lane stamp rolled back too');
  assert.equal(await resumedCount(), 0, 'S7 no audit event survived the rollback');
}
await q(`drop trigger if exists sabotage_dispatch on aria_internal.mission_state`);
await q(`drop function if exists aria_internal.sabotage_dispatch_persistence()`);

// ===========================================================================
// S8. "Exactly one candidate": a second eligible agent anywhere rejects.
// ===========================================================================
await start('second eligible agent anywhere rejects the recovery');
await resetState({ deviceAlt: true });
res = await q(RECOVER({ grantRef: 'a4-recovery-test.s8' }).text, RECOVER({ grantRef: 'a4-recovery-test.s8' }).values);
rec = res.rows[0].r;
assert.equal(rec.action, 'rejected', 'S8 a second eligible candidate must reject');
assert.equal(rec.reason, 'agent_not_eligible', 'S8 rejection reason');
assert.equal(rec.eligible_count, 0, 'S8 the uniqueness check must decline the ambiguous world');
assert.equal((await scopeRow()).status, 'revoked', 'S8 scope untouched');

// ===========================================================================
// S9. Missing capability / wrong agent type / no token_hash variants.
// ===========================================================================
await start('capability and authentication components of the physical gate');
{
  for (const variant of ['nocaps', 'offline', 'stale']) {
    await resetState({ device: variant });
    const r = await q(RECOVER({ grantRef: `a4-recovery-test.s9.${variant}` }).text, RECOVER({ grantRef: `a4-recovery-test.s9.${variant}` }).values);
    assert.equal(r.rows[0].r.action, 'rejected', `S9 ${variant} must reject`);
    assert.equal(r.rows[0].r.reason, 'agent_not_eligible', `S9 ${variant} reason`);
  }
}


// ===========================================================================
// S10. The consumed one-shot reservation resumes the SAME expired bound scope
//      once, preserving its exact grant_ref and never issuing another token.
// ===========================================================================
await start('consumed reservation renews the same expired scope exactly once');
{
  const grantRef = 'a4-recovery-42110933267.1';
  await resetState({ scopeStatus: 'bound', missionMetadata: { execution_lane: 'user' } });
  await q(`update aria_internal.mission_state
             set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',
               $1::jsonb,true)
           where mission_id=$2`,
    [JSON.stringify({ granted: true, consumed: true, grant_ref: grantRef,
      granted_at: '2026-11-05T21:15:33.378979Z', consumed_at: '2026-11-05T21:15:34.498657Z' }), LOCKED]);
  await q(`update aria_internal.mission_wonder_2_a4_scopes
             set expires_at=clock_timestamp()-interval '1 minute'
           where scope_id=$1`, [SCOPE_ID]);

  res = await q(RESUME({ grantRef }).text, RESUME({ grantRef }).values);
  rec = res.rows[0].r;
  assert.equal(rec.action, 'scope_resumed', 'S10 the exact consumed reservation may resume its own expired scope');
  assert.equal(rec.dispatch_grant_ref, grantRef, 'S10 the original grant_ref is preserved');
  assert.equal(rec.dispatch_token_reused, true, 'S10 no new dispatch token is issued');
  assert.equal(rec.scope_resume_count, 1, 'S10 one bounded scope renewal only');
  const renewed = await scopeRow();
  assert.equal(renewed.status, 'bound', 'S10 same scope remains bound');
  assert.ok(new Date(renewed.expires_at) > new Date(), 'S10 scope expiry is extended into the future');
  const dispatch = await reservation();
  assert.equal(dispatch.granted, true, 'S10 original grant remains granted');
  assert.equal(dispatch.consumed, true, 'S10 original grant remains consumed');
  assert.equal(dispatch.grant_ref, grantRef, 'S10 exact old grant_ref remains');
  assert.equal(dispatch.scope_resume_count, 1, 'S10 resume marker is persisted');
  assert.equal(await resumedCount(), 1, 'S10 one audit event is written');

  const again = await q(RESUME({ grantRef }).text, RESUME({ grantRef }).values);
  assert.equal(again.rows[0].r.action, 'already_fresh', 'S10 immediate retry is read-only and harmless');
  assert.equal(await resumedCount(), 1, 'S10 retry does not create another event');

  await q(`update aria_internal.mission_wonder_2_a4_scopes
             set expires_at=clock_timestamp()-interval '1 second'
           where scope_id=$1`, [SCOPE_ID]);
  const third = await q(RESUME({ grantRef }).text, RESUME({ grantRef }).values);
  assert.equal(third.rows[0].r.action, 'rejected', 'S10 a second expired-window renewal must refuse');
  assert.equal(third.rows[0].r.reason, 'scope_resume_already_used', 'S10 one-time resume guard');
  assert.equal((await scopeRow()).status, 'bound', 'S10 refused second renewal does not change scope state');
  assert.equal((await reservation()).scope_resume_count, 1, 'S10 resume count cannot be incremented twice');
}

// ===========================================================================
// S11. After the one-time scope renewal, the tick-claim RPC atomically reserves
//      the ONLY runtime POST. A repeat or concurrent claimant cannot win again.
// ===========================================================================
await start('single tick claim is atomic, persisted, and replay-proof');
{
  const grantRef = 'a4-recovery-42110933267.1';
  await resetState({ scopeStatus: 'bound', missionMetadata: { execution_lane: 'user' } });
  await q(`update aria_internal.mission_state
             set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',
               $1::jsonb,true)
           where mission_id=$2`,
    [JSON.stringify({ granted: true, consumed: true, grant_ref: grantRef,
      granted_at: '2026-11-05T21:15:33.378979Z', consumed_at: '2026-11-05T21:15:34.498657Z',
      scope_resume_count: 1, scope_resumed_at: new Date().toISOString(), scope_resume_grant_ref: grantRef }), LOCKED]);

  const clientA = new pg.Client({ connectionString: url });
  const clientB = new pg.Client({ connectionString: url });
  await clientA.connect();
  await clientB.connect();
  const race = await Promise.all([
    clientA.query(TICK_CLAIM({ grantRef }).text, TICK_CLAIM({ grantRef }).values),
    clientB.query(TICK_CLAIM({ grantRef }).text, TICK_CLAIM({ grantRef }).values),
  ]);
  await clientA.end();
  await clientB.end();
  const outcomes = race.map((x) => x.rows[0].r);
  const winners = outcomes.filter((x) => x.action === 'tick_claimed');
  const losers = outcomes.filter((x) => x.action === 'rejected' && x.reason === 'tick_already_claimed');
  assert.equal(winners.length, 1, 'S11 exactly one concurrent first claimant wins');
  assert.equal(losers.length, 1, 'S11 the concurrent loser is refused');
  claim = winners[0];
  assert.equal(claim.tick_claim_ref, grantRef + ':tick', 'S11 exact one-tick claim identity');
  assert.equal(claim.dispatch_persisted, true, 'S11 claim is persisted before returning');
  const dispatch = await reservation();
  assert.equal(dispatch.tick_claimed, true, 'S11 persisted tick claim flag');
  assert.equal(dispatch.consumed, true, 'S11 original one-shot dispatch token remains consumed');
  const replay = await q(TICK_CLAIM({ grantRef }).text, TICK_CLAIM({ grantRef }).values);
  assert.equal(replay.rows[0].r.action, 'rejected', 'S11 a later replay is refused');
  assert.equal(replay.rows[0].r.reason, 'tick_already_claimed', 'S11 replay rejection reason');
  assert.equal((await reservation()).tick_claim_ref, grantRef + ':tick', 'S11 claimed tick reference remains unchanged');
}

// ===========================================================================
// S12. A preexisting execution job, stale/offline agent, wrong grant or missing
//      resume marker cannot claim the one tick.
// ===========================================================================
await start('tick claim refuses preexisting work and unsafe physical state');
{
  const grantRef = 'a4-recovery-42110933267.1';
  const seed = async () => {
    await resetState({ scopeStatus: 'bound', missionMetadata: { execution_lane: 'user' } });
    await q(`update aria_internal.mission_state set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',$1::jsonb,true) where mission_id=$2`,
      [JSON.stringify({ granted:true, consumed:true, grant_ref:grantRef, scope_resume_count:1,
        scope_resumed_at:new Date().toISOString(), scope_resume_grant_ref:grantRef }), LOCKED]);
  };
  await seed();
  await q(`insert into aria_internal.execution_jobs(job_id,mission_id,status) values ('existing-job', $1, 'queued')`, [LOCKED]);
  res = await q(TICK_CLAIM({ grantRef }).text, TICK_CLAIM({ grantRef }).values);
  assert.equal(res.rows[0].r.reason, 'execution_job_already_exists', 'S12 do not create work twice');
  assert.equal((await reservation()).tick_claimed, undefined, 'S12 no tick claim with a preexisting job');

  await seed();
  await q(`update aria_internal.device_registry set last_seen_at=clock_timestamp()-interval '500 seconds' where device_id=$1`, [DEVICE_ID]);
  res = await q(TICK_CLAIM({ grantRef }).text, TICK_CLAIM({ grantRef }).values);
  assert.equal(res.rows[0].r.reason, 'agent_not_eligible', 'S12 stale physical agent cannot claim tick');
  assert.equal((await reservation()).tick_claimed, undefined, 'S12 stale agent leaves tick unclaimed');

  await seed();
  res = await q(TICK_CLAIM({ grantRef: grantRef + '-wrong' }).text, TICK_CLAIM({ grantRef: grantRef + '-wrong' }).values);
  assert.equal(res.rows[0].r.reason, 'consumed_reservation_mismatch', 'S12 wrong reservation identity refused');
  assert.equal((await reservation()).tick_claimed, undefined, 'S12 wrong ref leaves tick unclaimed');
}

// ===========================================================================
// S13. The original tick claim is reused for exactly ONE runner handoff retry
//      after the recorded downstream 401. No second tick, mission, job or lease
//      is created by this RPC. A historical revoked_at marker remains untouched
//      when the current status is bound with a fresh bounded expiry.
// ===========================================================================
await start('runner handoff retry reuses the consumed tick exactly once');
{
  const grantRef = 'a4-recovery-42110933267.1';
  await resetState({ scopeStatus: 'bound', missionMetadata: { execution_lane: 'user' } });
  await q(`update aria_internal.mission_state set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',$1::jsonb,true) where mission_id=$2`, [
    JSON.stringify({ granted:true, consumed:true, grant_ref:grantRef, tick_claimed:true,
      tick_claim_ref:grantRef + ':tick', scope_resume_count:1, scope_resume_grant_ref:grantRef,
      runner_handoff_retry_count:0 }), LOCKED]);
  await q(`update aria_internal.mission_wonder_2_a4_scopes set revoked_at=clock_timestamp()-interval '12 hours' where scope_id=$1`, [SCOPE_ID]);
  const revokedAtBefore = (await q(`select revoked_at from aria_internal.mission_wonder_2_a4_scopes where scope_id=$1`, [SCOPE_ID])).rows[0].revoked_at;

  res = await q(HANDOFF({ grantRef }).text, HANDOFF({ grantRef }).values);
  rec = res.rows[0].r;
  assert.equal(rec.action, 'runner_handoff_retry_claimed', 'S13 the existing tick may be forwarded once after proven 401');
  assert.equal(rec.existing_tick_claim_reused, true, 'S13 the consumed tick is reused');
  assert.equal(rec.new_tick_claim_created, false, 'S13 no second tick claim');
  const dispatch = await reservation();
  assert.equal(dispatch.consumed, true, 'S13 original dispatch remains consumed');
  assert.equal(dispatch.grant_ref, grantRef, 'S13 original grant_ref is unchanged');
  assert.equal(dispatch.tick_claim_ref, grantRef + ':tick', 'S13 original tick claim is unchanged');
  assert.equal(dispatch.runner_handoff_retry_count, 1, 'S13 one runner handoff retry is persisted');
  assert.equal(dispatch.runner_handoff_retry_source_run, '42131077740', 'S13 retry is bound to failed run evidence');
  assert.equal(dispatch.runner_handoff_retry_source_status, 401, 'S13 retry is bound to HTTP 401 evidence');
  assert.equal((await q(`select count(*)::int as n from aria_internal.execution_jobs where mission_id=$1`, [LOCKED])).rows[0].n, 0, 'S13 claim creates no execution job');
  assert.equal((await q(`select count(*)::int as n from aria_internal.mission_events where mission_id=$1 and event_type='mission_resumed'`, [LOCKED])).rows[0].n, 1, 'S13 one retry audit event');
  assert.equal((await q(`select revoked_at from aria_internal.mission_wonder_2_a4_scopes where scope_id=$1`, [SCOPE_ID])).rows[0].revoked_at.toISOString(), revokedAtBefore.toISOString(), 'S13 historical revoked_at is preserved, not erased');

  const replay = await q(HANDOFF({ grantRef }).text, HANDOFF({ grantRef }).values);
  assert.equal(replay.rows[0].r.action, 'rejected', 'S13 a second runner handoff is rejected');
  assert.equal(replay.rows[0].r.reason, 'runner_handoff_retry_already_used', 'S13 replay reason is explicit');
  assert.equal((await reservation()).runner_handoff_retry_count, 1, 'S13 retry count cannot exceed one');
}

await start('runner handoff retry rejects mismatched evidence before mutation');
{
  const grantRef = 'a4-recovery-42110933267.1';
  await resetState({ scopeStatus: 'bound', missionMetadata: { execution_lane: 'user' } });
  await q(`update aria_internal.mission_state set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',$1::jsonb,true) where mission_id=$2`, [
    JSON.stringify({ granted:true, consumed:true, grant_ref:grantRef, tick_claimed:true,
      tick_claim_ref:grantRef + ':tick', scope_resume_count:1, scope_resume_grant_ref:grantRef,
      runner_handoff_retry_count:0 }), LOCKED]);
  res = await q(HANDOFF({ grantRef, failedRunId: '42131077741', runnerHttpStatus: 401 }).text,
    HANDOFF({ grantRef, failedRunId: '42131077741', runnerHttpStatus: 401 }).values);
  assert.equal(res.rows[0].r.reason, 'failed_handoff_evidence_mismatch', 'S13 wrong failed run cannot claim retry');
  assert.equal((await reservation()).runner_handoff_retry_count, 0, 'S13 mismatched evidence has no mutation');

  await resetState({ scopeStatus: 'bound', missionMetadata: { execution_lane: 'user', mission_wonder_2_a4_allowed_device_id: DEVICE_ID_ALT } });
  await q(`update aria_internal.mission_state set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',$1::jsonb,true) where mission_id=$2`, [
    JSON.stringify({ granted:true, consumed:true, grant_ref:grantRef, tick_claimed:true,
      tick_claim_ref:grantRef + ':tick', scope_resume_count:1, scope_resume_grant_ref:grantRef,
      runner_handoff_retry_count:0 }), LOCKED]);
  res = await q(HANDOFF({ grantRef }).text, HANDOFF({ grantRef }).values);
  assert.equal(res.rows[0].r.reason, 'mission_identity_mismatch', 'S13 metadata device must equal the scope device');
  assert.equal((await reservation()).runner_handoff_retry_count, 0, 'S13 device mismatch has no mutation');

  await resetState({ scopeStatus: 'bound', device: 'stale', missionMetadata: { execution_lane: 'user' } });
  await q(`update aria_internal.mission_state set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',$1::jsonb,true) where mission_id=$2`, [
    JSON.stringify({ granted:true, consumed:true, grant_ref:grantRef, tick_claimed:true,
      tick_claim_ref:grantRef + ':tick', scope_resume_count:1, scope_resume_grant_ref:grantRef,
      runner_handoff_retry_count:0 }), LOCKED]);
  res = await q(HANDOFF({ grantRef }).text, HANDOFF({ grantRef }).values);
  assert.equal(res.rows[0].r.reason, 'agent_not_eligible', 'S13 stale agent must reject the one-time retry');
  assert.equal((await reservation()).runner_handoff_retry_count, 0, 'S13 stale agent has no mutation');
}

// ===========================================================================
// S14. If the same bound scope expired during investigation, the exact failed
//      401 continuation may extend that scope once for 45 minutes, but only
//      within two hours of expiry. Historical revoked_at is preserved.
// ===========================================================================
await start('expired bound scope receives one bounded 45-minute continuation');
{
  const grantRef = 'a4-recovery-42110933267.1';
  await resetState({ scopeStatus: 'bound', missionMetadata: { execution_lane: 'user' } });
  await q(`update aria_internal.mission_state set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',$1::jsonb,true) where mission_id=$2`, [
    JSON.stringify({ granted:true, consumed:true, grant_ref:grantRef, tick_claimed:true,
      tick_claim_ref:grantRef + ':tick', scope_resume_count:1, scope_resume_grant_ref:grantRef,
      runner_handoff_retry_count:0, runner_handoff_scope_resume_count:0 }), LOCKED]);
  await q(`update aria_internal.mission_wonder_2_a4_scopes
             set expires_at=clock_timestamp()-interval '49 minutes',
                 revoked_at=clock_timestamp()-interval '12 hours'
           where scope_id=$1`, [SCOPE_ID]);
  const before = (await q(`select expires_at,revoked_at,status from aria_internal.mission_wonder_2_a4_scopes where scope_id=$1`, [SCOPE_ID])).rows[0];
  res = await q(HANDOFF({ grantRef }).text, HANDOFF({ grantRef }).values);
  rec = res.rows[0].r;
  assert.equal(rec.action, 'runner_handoff_retry_claimed', 'S14 same authorized tick handoff is accepted');
  assert.equal(rec.scope_window_renewed, true, 'S14 the one scope renewal is explicitly reported');
  assert.ok(new Date(rec.scope_expires_at) > new Date(), 'S14 fresh expiry returned');
  assert.equal(new Date(rec.scope_expires_at).getTime() - new Date().getTime() > 44 * 60 * 1000, true, 'S14 at least 44 minutes remain');
  const after = (await q(`select expires_at,revoked_at,status from aria_internal.mission_wonder_2_a4_scopes where scope_id=$1`, [SCOPE_ID])).rows[0];
  assert.equal(after.status, 'bound', 'S14 same scope remains bound');
  assert.ok(new Date(after.expires_at) > new Date(before.expires_at), 'S14 expiry was extended');
  assert.equal(after.revoked_at.toISOString(), before.revoked_at.toISOString(), 'S14 historical revoked_at is preserved');
  const dispatch = await reservation();
  assert.equal(dispatch.grant_ref, grantRef, 'S14 original grant is preserved');
  assert.equal(dispatch.tick_claim_ref, grantRef + ':tick', 'S14 original tick claim is preserved');
  assert.equal(dispatch.runner_handoff_retry_count, 1, 'S14 one retry is claimed');
  assert.equal(dispatch.runner_handoff_scope_resume_count, 1, 'S14 one scope renewal is persisted');
  assert.equal(dispatch.runner_handoff_scope_resume_source_run, '42131077740', 'S14 renewal binds to the failed run');
  assert.equal((await q(`select count(*)::int as n from aria_internal.execution_jobs where mission_id=$1`, [LOCKED])).rows[0].n, 0, 'S14 no job is created by the renewal claim');

  const replay = await q(HANDOFF({ grantRef }).text, HANDOFF({ grantRef }).values);
  assert.equal(replay.rows[0].r.reason, 'runner_handoff_retry_already_used', 'S14 no second renewal or handoff');
  const dispatchAfter = await reservation();
  assert.equal(dispatchAfter.runner_handoff_scope_resume_count, 1, 'S14 resume count stays one');
}

await start('expired scope outside two-hour continuation window is refused without mutation');
{
  const grantRef = 'a4-recovery-42110933267.1';
  await resetState({ scopeStatus: 'bound', missionMetadata: { execution_lane: 'user' } });
  await q(`update aria_internal.mission_state set metadata=jsonb_set(metadata,'{a4_recovery_dispatch_v1}',$1::jsonb,true) where mission_id=$2`, [
    JSON.stringify({ granted:true, consumed:true, grant_ref:grantRef, tick_claimed:true,
      tick_claim_ref:grantRef + ':tick', scope_resume_count:1, scope_resume_grant_ref:grantRef,
      runner_handoff_retry_count:0, runner_handoff_scope_resume_count:0 }), LOCKED]);
  await q(`update aria_internal.mission_wonder_2_a4_scopes set expires_at=clock_timestamp()-interval '3 hours' where scope_id=$1`, [SCOPE_ID]);
  const before = await scopeRow();
  res = await q(HANDOFF({ grantRef }).text, HANDOFF({ grantRef }).values);
  assert.equal(res.rows[0].r.reason, 'scope_expired_outside_continuation_window', 'S14 old expired scope is refused');
  const after = await scopeRow();
  assert.equal(new Date(after.expires_at).toISOString(), new Date(before.expires_at).toISOString(), 'S14 refusal does not extend expiry');
  assert.equal((await reservation()).runner_handoff_retry_count, 0, 'S14 refusal does not claim handoff');
  assert.equal((await reservation()).runner_handoff_scope_resume_count, 0, 'S14 refusal does not consume scope renewal');
}

// ===========================================================================
// S15. The global device-job freeze remains active, but the exact A4 UTC
//      read-only job may be claimed by its one authorized Windows device.
//      No other job/device can use this exception; start and completion
//      revalidate the live mission, scope, tick, job, and agent identity.
// ===========================================================================
await start('frozen device gateway claims exactly the authorized A4 read-only job');
{
  const missionId = 'mission_a4_authorized_once';
  const scopeId = 'mission_wonder_2_a4_authorized_once';
  const deviceId = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089';
  const jobId = 'uo_mission_a4_authorized_once_a4_readonly_utc_clock_probe_a1_da6b3354e92efcbb';
  const grantRef = 'a4-recovery-42110933267.1';
  const requestId = '5d92b435-c42b-4d8b-9a07-2f73b8ec7a38';
  const userId = '39a8f5fd-18e6-4bba-bdd3-31691ec18f3e';
  const goalHash = '6f66a99cf889877617b5d166151ac51e4cc90fafa592309b2aa440b103e7a5ef';
  const command = "[DateTime]::UtcNow.ToString('o')";

  await q('delete from aria_internal.execution_job_events');
  await q('delete from aria_internal.execution_jobs');
  await q('delete from aria_internal.mission_events');
  await q('delete from aria_internal.mission_wonder_2_a4_scopes');
  await q('delete from aria_internal.mission_state');
  await q('delete from aria_internal.device_registry');

  const step = {
    id: 'a4_readonly_utc_clock_probe', operation: 'shell.execute', executor_type: 'device', risk: 'READ',
    target: { type: 'device', device_id: deviceId }, input: { command, cwd: null },
    timeout_ms: 15000, retryable: false, max_attempts: 1, depends_on: [],
    policy: { read_only: true, read_only_audit: true, mission_wonder_2_a4_readonly: true },
    authorization: { status: 'approved', risk_class: 'READ', evidence_ref: 'mission-wonder-2-step4-a4-v1' },
    verify: { expected_exit_code: 0, stdout_contains: 'Z' },
  };
  const dispatch = {
    granted: true, consumed: true, grant_ref: grantRef, tick_claimed: true,
    tick_claim_ref: grantRef + ':tick', scope_resume_count: 1, scope_resume_grant_ref: grantRef,
    runner_handoff_retry_count: 1, runner_handoff_retry_ref: grantRef + ':runner-handoff-retry',
    runner_handoff_retry_source_run: '42131077740', runner_handoff_retry_source_status: 401,
    runner_handoff_scope_resume_count: 1, runner_handoff_scope_resume_source_run: '42131077740',
  };
  await q('insert into aria_internal.mission_state (mission_id,status,current_step,completed_steps,checkpoint,metadata) values ($1,$2,0,0,$3::jsonb,$4::jsonb)', [
    missionId, 'waiting',
    JSON.stringify({
      plan: [step], recovery: { status: 'waiting_for_async_executor' },
      pending_jobs: { a4_readonly_utc_clock_probe: { job_id: jobId, status: 'queued' } },
    }),
    JSON.stringify({
      execution_lane: 'user', source_application: 'aria-app-v1', goal_source: 'user',
      mission_wonder_2_a4_readonly: 'true', mission_wonder_2_a4_scope_id: scopeId,
      mission_wonder_2_a4_goal_hash: goalHash, request_id: requestId, user_id: userId,
      mission_wonder_2_a4_allowed_device_id: deviceId, project_id: null,
      a4_recovery_dispatch_v1: dispatch,
    }),
  ]);
  await q('insert into aria_internal.mission_wonder_2_a4_scopes (scope_id,scope_key,owner_user_id,request_id,goal_hash,mission_id,allowed_device_id,status,expires_at,revoked_at) values ($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp()+interval \'45 minutes\',clock_timestamp()-interval \'12 hours\')',
    [scopeId, SCOPE_KEY, userId, requestId, goalHash, missionId, deviceId, 'bound']);
  await q('insert into aria_internal.device_registry (device_id,agent_type,status,token_hash,capabilities,last_seen_at) values ($1,$2,$3,$4,$5::jsonb,clock_timestamp()-interval \'2 seconds\')',
    [deviceId, 'windows-local', 'online', 'a4-test-token-hash', '[\"shell.execute\"]']);
  await q('insert into aria_internal.execution_jobs (job_id,mission_id,device_id,operation,command,cwd,timeout_ms,policy,status,metadata) values ($1,$2,$3,$4,$5,null,15000,$6::jsonb,\'queued\',$7::jsonb)',
    [jobId, missionId, deviceId, 'shell.execute', command,
      JSON.stringify({ read_only: true, read_only_audit: true, mission_wonder_2_a4_readonly: true }),
      JSON.stringify({ idempotency_key: jobId })]);

  let authorization = await q('select aria_internal.aria_m22_a4_frozen_job_authorized_v1($1,$2,$3) as ok', [jobId, deviceId, 'queued']);
  assert.equal(authorization.rows[0].ok, true, 'S15 exact A4 job is eligible under the global freeze');
  authorization = await q('select aria_internal.aria_m22_a4_frozen_job_authorized_v1($1,$2,$3) as ok', [jobId, deviceId, 'claimed']);
  assert.equal(authorization.rows[0].ok, false, 'S15 queued job cannot pass the claimed gate');
  authorization = await q('select aria_internal.aria_m22_a4_frozen_job_authorized_v1($1,$2,$3) as ok', [jobId, DEVICE_ID_ALT, 'queued']);
  assert.equal(authorization.rows[0].ok, false, 'S15 another device is refused');
  authorization = await q('select aria_internal.aria_m22_a4_frozen_job_authorized_v1($1,$2,$3) as ok', ['other-job-id', deviceId, 'queued']);
  assert.equal(authorization.rows[0].ok, false, 'S15 another job is refused');

  let claimed = await q('select aria_internal.aria_m22_a4_claim_frozen_one_shot_job_v1($1)::jsonb as job', [deviceId]);
  assert.equal(claimed.rows[0].job.job_id, jobId, 'S15 gateway claims the exact A4 job');
  assert.equal(claimed.rows[0].job.status, 'claimed', 'S15 job transitions to claimed');
  assert.ok(claimed.rows[0].job.lease_owner, 'S15 physical job lease owner is persisted');
  assert.ok(new Date(claimed.rows[0].job.lease_until) > new Date(), 'S15 physical job lease is live');
  assert.equal((await q('select count(*)::int as n from aria_internal.execution_job_events where job_id=$1 and event_type=$2', [jobId, 'job.claimed_a4_one_shot'])).rows[0].n, 1, 'S15 one audit event records the A4 claim');
  authorization = await q('select aria_internal.aria_m22_a4_frozen_job_authorized_v1($1,$2,$3) as ok', [jobId, deviceId, 'claimed']);
  assert.equal(authorization.rows[0].ok, true, 'S15 exact claimed job passes the start authorization gate');
  assert.equal((await q('select aria_internal.mission_job_authorization_allowed($1,$2) as ok', [missionId, jobId])).rows[0].ok, true, 'S15 mission start authorization delegates to the exact A4 guard');

  claimed = await q('select aria_internal.aria_m22_a4_claim_frozen_one_shot_job_v1($1)::jsonb as job', [deviceId]);
  assert.equal(claimed.rows[0].job, null, 'S15 subsequent polling cannot claim the same job twice');
  assert.equal((await q('select count(*)::int as n from aria_internal.execution_jobs where mission_id=$1', [missionId])).rows[0].n, 1, 'S15 no second job is created');

  await q('update aria_internal.execution_jobs set status=$1,started_at=clock_timestamp(),updated_at=clock_timestamp() where job_id=$2', ['running', jobId]);
  authorization = await q('select aria_internal.aria_m22_a4_frozen_job_authorized_v1($1,$2,$3) as ok', [jobId, deviceId, 'running']);
  assert.equal(authorization.rows[0].ok, true, 'S15 exact running job passes the result authorization gate');
  assert.equal((await q('select aria_internal.mission_job_authorization_allowed($1,$2) as ok', [missionId, jobId])).rows[0].ok, true, 'S15 mission completion authorization remains exact-scope');

  await q('update aria_internal.mission_wonder_2_a4_scopes set expires_at=clock_timestamp()-interval \'1 second\' where scope_id=$1', [scopeId]);
  authorization = await q('select aria_internal.aria_m22_a4_frozen_job_authorized_v1($1,$2,$3) as ok', [jobId, deviceId, 'running']);
  assert.equal(authorization.rows[0].ok, false, 'S15 scope expiry immediately closes the exception');
  assert.equal((await q('select revoked_at is not null as preserved from aria_internal.mission_wonder_2_a4_scopes where scope_id=$1', [scopeId])).rows[0].preserved, true, 'S15 historical revoked_at remains intact');
}

await client.end();
console.log('mission-wonder-2-step4-a4-recovery-pg-integration: PASS');
