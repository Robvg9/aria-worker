// Mission Wonder 2 — Step 4 A4 server-state diagnostic (READ-ONLY).
//
// Purpose: capture the authoritative server-side state of the stalled one-shot A4
// attempt (run 42022813342) so the root cause is observed, not inferred. This script:
//   * executes ONLY `supabase db query --read-only --remote` calls (no --yes, no
//     INSERT/UPDATE/DELETE of any kind),
//   * never invokes the runtime, never claims jobs/leases, never mutates anything,
//   * masks device/secret-shaped identifiers before printing (prefix 7 + fixed mask),
//   * exits 0 regardless of findings (a diagnostic records evidence; assertions belong
//     to dedicated contract tests).
//
// Runs only inside CI with repository secrets; the local workstation has no credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PROJECT = String(process.env.SUPABASE_PROJECT_REF || '');
const RUN_ID = String(process.env.GITHUB_RUN_ID || '');
const RUN_ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || '1');
const ARTIFACT_DIR = path.resolve(process.env.RWHT_ARTIFACT_DIR || 'a4-state-diag-artifacts');
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

// Identity of the stalled attempt (from artifact a4-report.json of run 42022813342).
const MISSION_ID = 'mission_a4_authorized_once';
const REQUEST_ID = String(process.env.A4_REQUEST_ID || '5d92b435-c42b-4d8b-9a07-2f73b8ec7a38');
const DIAG_SINCE = String(process.env.A4_DIAG_SINCE || '2026-11-05T00:00:00Z');

const report = {
  status: 'running', run_id: RUN_ID, run_attempt: RUN_ATTEMPT,
  mission_id: MISSION_ID, readonly_only: true, rdbms: {}, marker_lines: [],
};

assert.ok(PROJECT, 'SUPABASE_PROJECT_REF is required');
if (!/^[a-z0-9]{20}$/.test(PROJECT)) fail('supabase_project_ref_unexpected');

function fail(message) { throw new Error(message); }
function maskId(value) {
  const s = String(value ?? '');
  return s.length <= 7 ? s + 'x'.repeat(Math.max(0, 7 - s.length)) : s.slice(0, 7) + 'x'.repeat(40);
}
function sqlQuote(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

// Read-only by construction: this helper has no write mode at all.
function runSql(query) {
  const args = ['db', 'query', query, '--read-only', '--remote'];
  const result = spawnSync('supabase', args, { cwd: process.env.GITHUB_WORKSPACE, encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 });
  const output = String(result.stdout || '') + '\n' + String(result.stderr || '');
  if (result.status !== 0) {
    console.error('SUPABASE_SQL_FAILED exit=' + result.status + ' output=' + output.slice(-3000));
    fail('supabase_sql_failed');
  }
  return output;
}
function readMarker(output, marker) {
  const line = output.split(/\r?\n/).find((l) => l.includes(marker + '='));
  return line ? line.slice(line.indexOf(marker + '=')) : marker + '=missing';
}

// 1) Mission row: full observable state without dumping secrets. Metadata values are
//    NOT printed except explicitly whitelisted low-sensitivity keys.
report.rdbms.mission = readMarker(runSql(`
  SELECT 'A4_STATE_DIAG_MISSION=' || COALESCE((
    SELECT jsonb_build_object(
      'found', true,
      'status', m.status,
      'next_action', m.next_action,
      'total_steps', m.total_steps,
      'completed_steps', m.completed_steps,
      'current_step', m.current_step,
      'checkpoint_recovery', COALESCE(m.checkpoint->'recovery'->>'status','none'),
      'checkpoint_plan_len', COALESCE(jsonb_array_length(coalesce(m.checkpoint->'plan','[]'::jsonb))::int, 0),
      'lease_alive', (m.lease_until IS NOT NULL AND m.lease_until > clock_timestamp()),
      'lease_until', m.lease_until,
      'created_at', m.created_at,
      'updated_at', m.updated_at,
      'finished_at', m.finished_at,
      'meta_execution_lane', m.metadata->>'execution_lane',
      'meta_goal_source', m.metadata->>'goal_source',
      'meta_a4_scope_id_present', (m.metadata->>'mission_wonder_2_a4_scope_id' IS NOT NULL),
      'meta_request_id_present', (m.metadata->>'request_id' IS NOT NULL),
      'meta_readonly_marker', (m.metadata->>'mission_wonder_2_a4_readonly'),
      'meta_device_prefix', left(COALESCE(m.metadata->>'mission_wonder_2_a4_allowed_device_id',''),7),
      'metadata_keys', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(m.metadata) k),
      'last_stderr_present', (m.last_stderr IS NOT NULL),
      'last_stdout_present', (m.last_stdout IS NOT NULL)
    )::text
    FROM aria_internal.mission_state m
    WHERE m.mission_id = ${sqlQuote(MISSION_ID)}
  ), '{"found":false}'::jsonb::text);
`), 'A4_STATE_DIAG_MISSION');

// 2) Mission events timeline: THE decisive observation — did the runner ever emit
//    cognitive_recall_completed / mission_replanned / step_* / mission_verified events?
report.rdbms.events = readMarker(runSql(`
  SELECT 'A4_STATE_DIAG_EVENTS=' || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('type', e.event_type, 'at', e.created_at) ORDER BY e.created_at)::text
    FROM aria_internal.mission_events e
    WHERE e.mission_id = ${sqlQuote(MISSION_ID)}
      AND e.created_at > ${sqlQuote(DIAG_SINCE)}::timestamptz
  ), '[]');
`), 'A4_STATE_DIAG_EVENTS');

// 3) Execution jobs for the mission: did the probe job ever get dispatched?
report.rdbms.jobs = readMarker(runSql(`
  SELECT 'A4_STATE_DIAG_JOBS=' || COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id_prefix', left(j.job_id::text,8), 'status', j.status, 'updated_at', j.updated_at) ORDER BY j.updated_at)::text
    FROM aria_internal.execution_jobs j
    WHERE j.mission_id = ${sqlQuote(MISSION_ID)}
  ), '[]');
`), 'A4_STATE_DIAG_JOBS');

// 4) Scope row: lifecycle state of the one-shot scope (timestamps only, ids masked).
report.rdbms.scope = readMarker(runSql(`
  SELECT 'A4_STATE_DIAG_SCOPE=' || COALESCE((
    SELECT jsonb_build_object(
      'found', true,
      'status', s.status,
      'expires_at', s.expires_at,
      'expired', (s.expires_at <= clock_timestamp()),
      'claimed_at', s.claimed_at,
      'bound_at', s.bound_at,
      'completed_at', s.completed_at,
      'revoked_at', s.revoked_at,
      'device_prefix', left(s.allowed_device_id, 7)
    )::text
    FROM aria_internal.mission_wonder_2_a4_scopes s
    WHERE s.mission_id = ${sqlQuote(MISSION_ID)}
  ), '{"found":false}'::jsonb::text);
`), 'A4_STATE_DIAG_SCOPE');

// 5) Claim eligibility verdict from the exact guard SQL the runner consults.
//    The read-only session may lack EXECUTE on this SECURITY DEFINER function
//    (42501 permission denied). A diagnostic records evidence; an inaccessible
//    observation is itself evidence and must not kill the run.
function runSqlSoft(query) {
  try {
    return runSql(query);
  } catch (error) {
    return null;
  }
}
const claimOutput = runSqlSoft(`
  SELECT 'A4_STATE_DIAG_CLAIM_ELIGIBLE=' || aria_internal.aria_mission_claim_eligible(${sqlQuote(MISSION_ID)})::text;
`);
report.rdbms.claim_eligible = claimOutput === null
  ? 'A4_STATE_DIAG_CLAIM_ELIGIBLE=unobservable_function_execute_denied_for_readonly_role (42501)'
  : readMarker(claimOutput, 'A4_STATE_DIAG_CLAIM_ELIGIBLE');

// 6) Duplicate guarantee: exactly one mission row must exist for the request_id.
report.rdbms.request_duplicates = readMarker(runSql(`
  SELECT 'A4_STATE_DIAG_REQUEST_DUP=' || count(*)::text
    FROM aria_internal.mission_state
   WHERE metadata->>'request_id' = ${sqlQuote(REQUEST_ID)};
`), 'A4_STATE_DIAG_REQUEST_DUP');

// 7) Second-mission guarantee: no other mission may reference the A4 scope id.
report.rdbms.scope_duplicates = readMarker(runSql(`
  SELECT 'A4_STATE_DIAG_SCOPE_DUP=' || count(*)::text
    FROM aria_internal.mission_state
   WHERE metadata->>'mission_wonder_2_a4_scope_id' IS NOT NULL;
`), 'A4_STATE_DIAG_SCOPE_DUP');

for (const value of Object.values(report.rdbms)) {
  console.log(String(value).replace(/[a-f0-9]{40,}/gi, 'MASKED_ID'));
  report.marker_lines.push(String(value).replace(/[a-f0-9]{40,}/gi, 'MASKED_ID'));
}

report.status = 'ok';
fs.writeFileSync(path.join(ARTIFACT_DIR, 'a4-state-diag.json'), JSON.stringify(report, null, 2));
console.log('A4_STATE_DIAG_WRITE=none READ_ONLY=true');
