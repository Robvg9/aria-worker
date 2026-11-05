// Mission Wonder 2 — Step 4 A4 recovery tick (DESIGN ONLY — NOT EXECUTED YET).
//
// Single controlled re-entry for THE existing mission mission_a4_authorized_once,
// runnable only after (a) the owner grants the explicit recovery authorization,
// (b) the read-only state diagnostic has confirmed the true server state, and
// (c) the scope has been restored to 'bound' by the identity-verified RPC
// aria_m22_a4_recover_mission_v1.
//
// Guarantees (by construction, enforced by the contract test):
//   * Creates/arms NOTHING: no scope, mission, execution-job or lease rows are inserted.
//   * Performs one narrowly-scoped, atomic SQL RPC to reserve the sole tick claim;
//     the RPC re-checks the consumed grant, exact mission/scope identity, agent
//     eligibility and absence of preexisting jobs. Replays are rejected server-side.
//   * Does NOT claim a job lease, create work or run the shell command itself. The
//     canonical runner performs the A4 readonly-probe plan, physical execution and
//     scope completion after the single runtime tick is forwarded.
//   * Dispatches the runtime tick EXACTLY ONCE.
//   * Verifies: mission succeeded with exactly one completed step, at least one
//     mission_verified event, a visible notification for the user, exactly ONE mission
//     row for the attempt's request_id (pre and post), and the scope left in
//     'completed' by the runner's own A4 completion RPC.
//   * Fail-closed preflight: aborts BEFORE dispatching the tick unless scope='bound',
//     unexpired, lane stamped and the mission status is 'queued'.
//   * On a post-dispatch failure: records evidence and exits 1 WITHOUT revoking or
//     rewinding anything (cleanup after a failed recovery is a human decision,
//     unlike the original one-shot E2E, which was the first and only automatic pass).
//   * Masks device/secret-shaped identifiers in all stdout.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';

const PROJECT = String(process.env.SUPABASE_PROJECT_REF || '');
const RUNTIME_SECRET = process.env.ARIA_RUNTIME_SHARED_SECRET || '';
const SESSION_STATE_GZIP_B64 = String(process.env.RWHT_STORAGE_STATE_GZIP_B64 || '');
const SESSION_STATE_B64 = String(process.env.RWHT_STORAGE_STATE_B64 || '');
const SCOPE_ID = String(process.env.A4_RECOVERY_SCOPE_ID || ''); // FULL scope id, supplied by the recovery workflow
const GRANT_REF = String(process.env.A4_DISPATCH_GRANT_REF || ''); // reservation ref persisted by the recover RPC
const TOKEN_CLAIMED = String(process.env.A4_DISPATCH_TOKEN_CLAIMED || ''); // must be 'true', set only by a successful claim
const MISSION_API_BASE = String(process.env.RWHT_MISSION_API_BASE || 'https://aria.robvg9.workers.dev/api/missions');
const NOTIF_API_URL = String(process.env.RWHT_NOTIF_API_URL || 'https://aria.robvg9.workers.dev/api/meditation/notifications');
const TICK_URL = String(process.env.A4_RECOVERY_TICK_URL || `https://${PROJECT}.supabase.co/functions/v1/aria-canonical-runtime-v1`);
const POLL_MS = 6000; // read-only pacing tick every 6 s
const MAX_POLLS = Math.ceil((Number(process.env.A4_RECOVERY_POLL_SECONDS || 540) * 1000) / (POLL_MS + 1));
const RUN_ID = String(process.env.GITHUB_RUN_ID || '');
const RUN_ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || '1');

// Identity of the ONE stalled attempt (a4-report.json from run 42022813342).
const MISSION_ID = 'mission_a4_authorized_once';
const SCOPE_KEY = 'mission-wonder-2-step4-a4:single-authorized-execution';

function fail(message) { throw new Error(message); }
function sqlQuote(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function runSql(query) {
  const args = ['db', 'query', query, '--read-only', '--remote'];
  const result = spawnSync('supabase', args, { cwd: process.env.GITHUB_WORKSPACE, encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 });
  const output = String(result.stdout || '') + '\n' + String(result.stderr || '');
  if (result.status !== 0) fail('supabase_sql_failed ' + output.slice(-1500));
  return output;
}

// The ONLY write in this script: an atomic, persisted, single-use claim for the
// one runtime POST below. It is intentionally separate from all read-only probes.
function runSqlWriteOnce(query) {
  const args = ['db', 'query', query, '--yes', '--remote'];
  const result = spawnSync('supabase', args, { cwd: process.env.GITHUB_WORKSPACE, encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 });
  const output = String(result.stdout || '') + '\n' + String(result.stderr || '');
  if (result.status !== 0) fail('supabase_tick_claim_failed ' + output.slice(-1500));
  return output;
}
function requireMarker(output, mark) {
  if (!output.includes(mark)) fail('sql marker missing: ' + mark);
  return output;
}

const report = {
  status: 'running', run_id: RUN_ID, run_attempt: RUN_ATTEMPT, mission_id: MISSION_ID,
  pwa_authenticated: false, preflight_pass: false, agent_eligible_pass: false,
  recovery_dispatched: false, tick_claimed: false,
  runtime_ticks: [], mission_terminal_status: null, mission_verified_events: 0,
  notifications_seen: 0, request_missions_pre: null, request_missions_post: null,
  scope_terminal_status: null, failure: null,
};

const ARTIFACT_DIR = path.resolve(process.env.RWHT_ARTIFACT_DIR || 'a4-recovery-artifacts');
const persistReport = () => { try { fs.mkdirSync(ARTIFACT_DIR, { recursive: true }); fs.writeFileSync(path.join(ARTIFACT_DIR, 'a4-recovery-report.json'), JSON.stringify(report, null, 2)); } catch { /* best effort */ } };
const masked = (value) => String(value ?? '').replace(/[a-f0-9]{40,}/gi, 'MASKED_ID');

assert.ok(PROJECT, 'SUPABASE_PROJECT_REF required');
assert.ok(RUNTIME_SECRET, 'ARIA_RUNTIME_SHARED_SECRET required');
assert.ok(/^[0-9a-f-]{10,64}$/.test(SCOPE_ID), 'A4_RECOVERY_SCOPE_ID (full scope id) required');
assert.ok(/^[A-Za-z0-9_.:\/-]{4,120}$/.test(GRANT_REF), 'A4_DISPATCH_GRANT_REF required');
assert.equal(TOKEN_CLAIMED, 'true', 'A4_DISPATCH_TOKEN_CLAIMED must be true: only a successful server-side dispatch-token claim (RPC) sets it; without it this script must never dispatch');
assert.ok(SESSION_STATE_B64 || SESSION_STATE_GZIP_B64, 'authenticated storage state required (no interactive browser here)');
report.pwa_authenticated = true;

// --- PWA session from the stored browser state (no browser, no credential entry).
const stateJson = SESSION_STATE_GZIP_B64
  ? JSON.parse(zlib.gunzipSync(Buffer.from(SESSION_STATE_GZIP_B64, 'base64')).toString('utf8'))
  : JSON.parse(Buffer.from(SESSION_STATE_B64, 'base64').toString('utf8'));
const sessionEntry = (stateJson.origins || []).flatMap((o) => o.localStorage || []).find((e) => e.name === 'aria_session_v2');
const session = sessionEntry ? JSON.parse(sessionEntry.value) : null;
if (!session?.accessToken || !session?.userId) fail('PWA session token unavailable from storage state');
report.pwa_authenticated = true;

// --- Read-only preflight (fail-closed BEFORE any dispatch).
requireMarker(runSql(`
  SELECT CASE WHEN count(*)=1 AND bool_and(
    m.status='queued'
    AND m.metadata->>'mission_wonder_2_a4_readonly'='true'
    AND m.metadata->>'execution_lane'='user'
    AND (m.metadata->>'mission_wonder_2_a4_allowed_device_id')=(s.allowed_device_id)
    AND s.status='bound'
    AND s.scope_key=${sqlQuote(SCOPE_KEY)}
    AND s.expires_at > clock_timestamp()
    AND m.metadata->'a4_recovery_dispatch_v1'->>'granted'='true'
    AND m.metadata->'a4_recovery_dispatch_v1'->>'consumed'='true'
    AND m.metadata->'a4_recovery_dispatch_v1'->>'grant_ref'=${sqlQuote(GRANT_REF)}
  ) THEN 'A4_RECOVERY_PREFLIGHT_PASS' ELSE 'A4_RECOVERY_PREFLIGHT_FAIL' END
    FROM aria_internal.mission_state m
    JOIN aria_internal.mission_wonder_2_a4_scopes s
      ON s.mission_id=m.mission_id AND s.scope_id=${sqlQuote(SCOPE_ID)}
   WHERE m.mission_id=${sqlQuote(MISSION_ID)};
`), 'A4_RECOVERY_PREFLIGHT_PASS');
report.preflight_pass = true;
// Physical agent eligibility gate #2 (read-only), immediately before the only dispatch:
// authenticated (token_hash present), online, heartbeat < 180 s, shell.execute
// capability, matching the exact allowed device, and exactly ONE eligible candidate.
requireMarker(runSql(`
  SELECT CASE WHEN (
    SELECT count(*) FROM aria_internal.device_registry d
     WHERE d.device_id = (SELECT s.allowed_device_id FROM aria_internal.mission_wonder_2_a4_scopes s WHERE s.scope_id=${sqlQuote(SCOPE_ID)})
       AND d.agent_type='windows-local'
       AND d.status='online'
       AND d.token_hash IS NOT NULL
       AND d.capabilities @> '["shell.execute"]'::jsonb
       AND d.last_seen_at > clock_timestamp() - interval '180 seconds'
       AND NOT EXISTS (
         SELECT 1 FROM aria_internal.device_registry other
          WHERE other.device_id <> d.device_id
            and other.agent_type='windows-local'
            and other.status='online'
            and other.token_hash IS NOT NULL
            and other.capabilities @> '["shell.execute"]'::jsonb
            and other.last_seen_at > clock_timestamp() - interval '180 seconds'
       )
  ) = 1 THEN 'A4_RECOVERY_AGENT_ELIGIBLE_PASS' ELSE 'A4_RECOVERY_AGENT_ELIGIBLE_FAIL' END;
`), 'A4_RECOVERY_AGENT_ELIGIBLE_PASS');
report.agent_eligible_pass = true;
report.request_missions_pre = Number(String(requireMarker(runSql(`
  SELECT 'A4_RECOVERY_REQUEST_COUNT=' || count(*)::text
    FROM aria_internal.mission_state
   WHERE metadata->>'request_id' = (SELECT request_id FROM aria_internal.mission_wonder_2_a4_scopes WHERE scope_id=${sqlQuote(SCOPE_ID)});
`), 'A4_RECOVERY_REQUEST_COUNT').match(/=(\d+)$/)?.[1] ?? '-1'));
assert.equal(report.request_missions_pre, 1, 'exactly one mission row must exist for the request_id');

// Atomically reserve the ONLY possible runtime POST. A retry after this point
// is rejected by PostgreSQL, even if the first process crashes before fetch().
const tickClaimOutput = runSqlWriteOnce(`
  SELECT 'A4_TICK_CLAIM_OK=' ||
    CASE WHEN coalesce(v->>'action','')='tick_claimed'
       AND coalesce(v->>'tick_claim_ref','')=${sqlQuote(GRANT_REF + ':tick')}
      THEN 'true' ELSE 'false' END
    FROM (
      SELECT aria_internal.aria_m22_a4_claim_recovery_tick_v1(
        ${sqlQuote(MISSION_ID)}, ${sqlQuote(SCOPE_ID)}, ${sqlQuote(GRANT_REF)}
      ) AS v
    ) claimed;
`);
requireMarker(tickClaimOutput, 'A4_TICK_CLAIM_OK=true');
report.tick_claimed = true;
persistReport();

// --- Dispatch the runtime tick EXACTLY ONCE. Polling below is read-only.
const tickResponse = await fetch(TICK_URL, {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + RUNTIME_SECRET, 'Content-Type': 'application/json', 'x-aria-trigger': 'mission-tick' },
  body: JSON.stringify({ mission_id: MISSION_ID }),
  signal: AbortSignal.timeout(90000),
});
const tickBody = await tickResponse.json().catch(() => null);
report.recovery_dispatched = true;
report.runtime_ticks.push({ attempt: 1, http_status: tickResponse.status, body: tickBody });
if (![200, 202].includes(tickResponse.status)) fail('canonical_runtime_recovery_tick_http_' + tickResponse.status);
persistReport();

// --- Read-only outcome polling discovered through the PWA API.
let mission = null;
for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  const response = await fetch(`${MISSION_API_BASE}/${encodeURIComponent(MISSION_ID)}`, {
    headers: { Authorization: 'Bearer ' + session.accessToken, Accept: 'application/json' }, cache: 'no-store',
  });
  if (!response.ok) fail('PWA mission readback HTTP ' + response.status);
  const body = await response.json().catch(() => null);
  mission = body?.mission || null;
  const status = String(mission?.status || '');
  console.log(masked('A4_RECOVERY_POLL poll=' + poll + ' status=' + status + ' completed=' + (mission?.completed_steps ?? 'null')));
  if (['succeeded', 'failed', 'blocked', 'cancelled', 'paused'].includes(status)) {
    report.mission_terminal_status = status;
    break;
  }
}
persistReport();
if (report.mission_terminal_status !== 'succeeded') {
  report.failure = 'A4 recovery mission did not reach succeeded; scope left intact for the human gate';
  persistReport();
  console.error(masked('A4_RECOVERY_OUTCOME ' + JSON.stringify(report)));
  process.exit(1);
}
assert.equal(Number(mission?.completed_steps), 1, 'A4 must complete exactly one step');
assert.equal(Number(mission?.total_steps), 1, 'A4 must contain exactly one step');

// --- Verification evidence: runner-emitted mission_verified event + notification + scope terminal state.
requireMarker(runSql(`
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM aria_internal.mission_events
     WHERE mission_id=${sqlQuote(MISSION_ID)} AND event_type='mission_verified'
       AND payload->>'verified'='true'
  ) THEN 'A4_RECOVERY_VERIFIED_EVENT_PASS' ELSE 'A4_RECOVERY_VERIFIED_EVENT_FAIL' END;
`), 'A4_RECOVERY_VERIFIED_EVENT_PASS');
const notifResponse = await fetch(NOTIF_API_URL + '?limit=50', {
  headers: { Authorization: 'Bearer ' + session.accessToken, Accept: 'application/json' }, cache: 'no-store',
});
if (notifResponse.ok) {
  const body = await notifResponse.json().catch(() => null);
  report.notifications_seen = Array.isArray(body?.notifications)
    ? body.notifications.filter((n) => String(n?.mission_id || '') === MISSION_ID).length
    : 0;
}
assert.ok(report.notifications_seen >= 1, 'A4 mission_verified notification must be visible to the user');
const scopeStatusOutput = runSql(`
  SELECT 'A4_RECOVERY_SCOPE_STATUS=' || s.status::text
    FROM aria_internal.mission_wonder_2_a4_scopes s WHERE s.scope_id=${sqlQuote(SCOPE_ID)};
`);
requireMarker(scopeStatusOutput, 'A4_RECOVERY_SCOPE_STATUS=');
report.scope_terminal_status = String(scopeStatusOutput.match(/A4_RECOVERY_SCOPE_STATUS=([a-z]+)/)?.[1] ?? 'unknown');
assert.equal(report.scope_terminal_status, 'completed', 'runner must complete the A4 scope itself');
report.request_missions_post = Number(String(requireMarker(runSql(`
  SELECT 'A4_RECOVERY_REQUEST_COUNT=' || count(*)::text
    FROM aria_internal.mission_state
   WHERE metadata->>'request_id' = (SELECT request_id FROM aria_internal.mission_wonder_2_a4_scopes WHERE scope_id=${sqlQuote(SCOPE_ID)});
`), 'A4_RECOVERY_REQUEST_COUNT').match(/=(\d+)$/)?.[1] ?? '-1'));
assert.equal(report.request_missions_post, 1, 'no second mission may exist for the request_id');

report.status = 'PASS_RECOVERED';
persistReport();
console.log(masked('A4_RECOVERY_PASS ' + JSON.stringify(report.runtime_ticks)));
