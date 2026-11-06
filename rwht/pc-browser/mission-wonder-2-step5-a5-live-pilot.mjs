import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import {
  M22_A5_SCOPE_ID, M22_A5_MISSION_ID, M22_A5_SCOPE_KEY,
  m22A5BuildRecoveryProbeStepV1, m22A5ExpectedJobIdV1, m22A5GoalIdentityHashV1,
} from "../../supabase/functions/_shared/mission-wonder-2-a5-scope-v1.mjs";

const PROJECT = String(process.env.SUPABASE_PROJECT_REF || "");
const RUNTIME_SECRET = String(process.env.ARIA_RUNTIME_SHARED_SECRET || "");
const EMAIL = String(process.env.RWHT_EMAIL || "");
const PASSWORD = String(process.env.RWHT_PASSWORD || "");
const BASE = (String(process.env.RWHT_URL || "https://aria.robvg9.workers.dev/pwa/").replace(/#.*$/, "").replace(/\/+$/, "") + "/");
const RUN_ID = String(process.env.GITHUB_RUN_ID || "");
const RUN_ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || "1");
const ARTIFACT_DIR = path.resolve(process.env.A5_ARTIFACT_DIR || "a5-live-artifacts");
const DEVICE_ID = "windows-fe722cc6681e4f9c9cc35f5ebbb0a089";
const MISSION_ID = M22_A5_MISSION_ID;
const JOB_ID = await m22A5ExpectedJobIdV1();
const GOAL = "Mission Wonder 2 — Step 5 A5: demostrar recuperación real de una misión ordinaria creada desde la PWA. Ejecuta un único marcador idempotente en el agente Windows autorizado, conserva el mismo job_id durante la interrupción, recupera el intento 2 y demuestra que el artefacto no se duplica. No crear otras misiones, no tocar repositorios, configuración, credenciales, cuentas ni datos financieros.";
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

function fail(message) { throw new Error(message); }
function sqlQuote(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function runSql(query, write = false) {
  const args = ["db", "query", query, ...(write ? ["--yes"] : ["--read-only"]), "--remote"];
  const result = spawnSync("supabase", args, {
    cwd: process.env.GITHUB_WORKSPACE, encoding: "utf8", env: process.env, maxBuffer: 8 * 1024 * 1024,
  });
  const output = String(result.stdout || "") + "\n" + String(result.stderr || "");
  if (result.status !== 0) {
    console.error("A5_SUPABASE_SQL_FAILED " + output.slice(-2500));
    fail("a5_supabase_sql_failed");
  }
  return output;
}
function requireMarker(output, marker) {
  if (!output.includes(marker)) {
    console.error("A5_EXPECTED_MARKER=" + marker + " OUTPUT=" + output.slice(-2500));
    fail("a5_sql_marker_missing:" + marker);
  }
  return output;
}
async function browserSession(page) {
  let session = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem("aria_session_v2");
      const value = raw ? JSON.parse(raw) : null;
      return value && typeof value.accessToken === "string" && value.userId
        ? { accessToken: value.accessToken, userId: String(value.userId) } : null;
    } catch { return null; }
  });
  const status = async (token) => page.evaluate(async (value) => {
    const response = await fetch("/api/diagnostics/health", {
      headers: { authorization: "Bearer " + value, accept: "application/json" }, cache: "no-store",
    });
    return response.status;
  }, token);
  if (session && [200, 204].includes(await status(session.accessToken))) return session;
  await page.evaluate(() => localStorage.removeItem("aria_session_v2")).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  const email = page.locator('form.authCard input[aria-label="Correo"],form.authCard input[type="email"],form.authCard input[name="email"],form.authCard input[autocomplete="username"]').first();
  const password = page.locator('form.authCard input[type="password"],form.authCard input[name="password"],form.authCard input[autocomplete="current-password"]').first();
  await email.waitFor({ state: "visible", timeout: 60000 });
  await password.waitFor({ state: "visible", timeout: 30000 });
  if (!EMAIL || !PASSWORD) fail("A5 PWA credentials unavailable and stored session was invalid");
  await email.fill(EMAIL);
  await password.fill(PASSWORD);
  const submit = page.locator("form.authCard button[type='submit'],form.authCard input[type='submit'],form.authCard button")
    .filter({ hasText: /entrar|iniciar|login|sign[ -]?in|continuar|acceder/i }).first();
  if (await submit.count()) await submit.click(); else await password.press("Enter");
  await page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem("aria_session_v2");
      const value = raw ? JSON.parse(raw) : null;
      return Boolean(value && typeof value.accessToken === "string" && value.userId);
    } catch { return false; }
  }, null, { timeout: 60000 });
  session = await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem("aria_session_v2") || "{}");
    return { accessToken: value.accessToken, userId: String(value.userId || "") };
  });
  if (!session.accessToken || !session.userId || ![200, 204].includes(await status(session.accessToken))) {
    fail("A5 authenticated PWA session could not be verified");
  }
  return session;
}
async function pwaApi(page, token, url, options = {}) {
  return page.evaluate(async ({ url, token, options }) => {
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: "Bearer " + token, Accept: "application/json", ...(options.headers || {}) },
      cache: "no-store",
    });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw: raw.slice(0, 700) }; }
    return { status: response.status, body };
  }, { url, token, options });
}
async function runtimeTick() {
  const response = await fetch("https://" + PROJECT + ".supabase.co/functions/v1/aria-canonical-runtime-v1", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + RUNTIME_SECRET,
      "Content-Type": "application/json",
      "x-aria-trigger": "mission-tick",
    },
    body: JSON.stringify({ mission_id: MISSION_ID }),
    signal: AbortSignal.timeout(90000),
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw: raw.slice(0, 700) }; }
  return { status: response.status, body };
}

const report = {
  status: "running", run_id: RUN_ID, run_attempt: RUN_ATTEMPT,
  pwa_authenticated: false, scope_armed: false, pwa_mission_created: false, pwa_mission_resumed: false,
  scope_bound: false, runtime_tick: null, mission_id: MISSION_ID,
  request_id: null, device_id: null, job_id: JOB_ID,
  job_running: false, artifact_checkpoint_waiting: false,
  global_freeze_negative_control: null, failure: null,
};
let browser = null;
let page = null;
let scopeCleanupRequired = false;
let scopeOwnerId = null;
let scopeGoalHash = null;

try {
  assert.ok(PROJECT && RUNTIME_SECRET && RUN_ID, "A5 workflow context/secrets missing");
  assert.equal(PROJECT, "icuqsstxfdbvjytkhlog", "unexpected ARIA Supabase project");
  assert.ok(/^https:\/\//.test(BASE), "PWA URL must be HTTPS");

  // The prior failed claim left one mission/job in place; the pilot resumes that exact identity.

  browser = await chromium.launch({ headless: true });
  const storageState = process.env.RWHT_STORAGE_STATE || "";
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(storageState && fs.existsSync(storageState) ? { storageState } : {}),
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(BASE + "#projects", { waitUntil: "domcontentloaded", timeout: 60000 });
  const session = await browserSession(page);
  report.pwa_authenticated = true;
  assert.ok(session.userId, "authenticated PWA owner id missing");
  const goalHash = await m22A5GoalIdentityHashV1(session.userId, GOAL, null);
  scopeOwnerId = session.userId;
  scopeGoalHash = goalHash;
  const step = m22A5BuildRecoveryProbeStepV1(DEVICE_ID);
  assert.equal(await m22A5ExpectedJobIdV1(), JOB_ID);

  const deviceSql = [
    "SELECT 'A5_DEVICE_ID=' || device_id",
    "FROM aria_internal.device_registry",
    "WHERE device_id=" + sqlQuote(DEVICE_ID),
    "AND agent_type='windows-local' AND status='online'",
    "AND token_hash IS NOT NULL",
    "AND capabilities @> '[\"shell.execute\"]'::jsonb",
    "AND last_seen_at > clock_timestamp() - interval '180 seconds'",
    "AND NOT EXISTS (SELECT 1 FROM aria_internal.device_registry other",
    " WHERE other.device_id <> " + sqlQuote(DEVICE_ID),
    " AND other.agent_type='windows-local' AND other.status='online'",
    " AND other.token_hash IS NOT NULL AND other.capabilities @> '[\"shell.execute\"]'::jsonb",
    " AND other.last_seen_at > clock_timestamp() - interval '180 seconds');"
  ].join("\n");
  const deviceOutput = runSql(deviceSql);
  const deviceId = deviceOutput.match(/A5_DEVICE_ID=([A-Za-z0-9._-]+)/)?.[1] || "";
  assert.equal(deviceId, DEVICE_ID, "exact A5 Windows agent is not uniquely eligible");
  report.device_id = deviceId;

  // Resume the exact PWA mission and job left untouched by the first failed gateway claim.
  // Do not POST /api/missions again and do not create a replacement job.
  const resumePreflightSql = [
    "SELECT CASE WHEN count(*)=1 AND bool_and(",
    "s.scope_key=" + sqlQuote(M22_A5_SCOPE_KEY),
    "AND s.owner_user_id=" + sqlQuote(session.userId) + " AND s.goal_hash=" + sqlQuote(goalHash),
    "AND s.mission_id=" + sqlQuote(MISSION_ID) + " AND s.job_id=" + sqlQuote(JOB_ID),
    "AND s.allowed_device_id=" + sqlQuote(DEVICE_ID) + " AND s.command=" + sqlQuote(step.input.command),
    "AND s.status='revoked' AND s.recovery_used=false AND s.request_id IS NOT NULL",
    "AND m.goal=" + sqlQuote(GOAL) + " AND m.status='waiting'",
    "AND m.current_step=0 AND m.completed_steps=0 AND m.total_steps=1",
    "AND m.metadata->>'user_id'=" + sqlQuote(session.userId),
    "AND m.metadata->>'request_id'=s.request_id",
    "AND m.metadata->>'mission_wonder_2_a5_scope_id'=" + sqlQuote(M22_A5_SCOPE_ID),
    "AND m.metadata->>'mission_wonder_2_a5_goal_hash'=" + sqlQuote(goalHash),
    "AND m.metadata->>'mission_wonder_2_a5_allowed_device_id'=" + sqlQuote(DEVICE_ID),
    "AND m.metadata->>'mission_wonder_2_a5_recovery'='true'",
    "AND m.metadata->>'execution_lane'='user' AND m.metadata->>'source_application'='aria-app-v1'",
    "AND m.metadata->>'goal_source'='user' AND nullif(coalesce(m.metadata->>'project_id',''),'') IS NULL",
    "AND m.checkpoint->'recovery'->>'status'='waiting_for_async_executor'",
    "AND m.checkpoint->'pending_jobs'->'a5_idempotent_recovery_marker'->>'job_id'=" + sqlQuote(JOB_ID),
    "AND m.checkpoint->'pending_jobs'->'a5_idempotent_recovery_marker'->>'attempt'='1'",
    "AND j.status='queued' AND j.completed_at IS NULL",
    "AND j.claimed_at IS NULL AND j.lease_owner IS NULL AND j.lease_until IS NULL",
    "AND j.recovery_count=0 AND j.device_id=" + sqlQuote(DEVICE_ID),
    "AND j.operation='shell.execute' AND j.command=" + sqlQuote(step.input.command),
    "AND j.cwd='C:\\Windows\\Temp' AND j.timeout_ms=900000",
    "AND j.policy @> '{\"mission_wonder_2_a5_recovery\":true,\"idempotent_artifact\":true,\"max_artifacts\":1}'::jsonb",
    "AND j.metadata->>'idempotency_key'=" + sqlQuote(JOB_ID)
    + ") THEN 'A5_RESUME_ORPHAN_PASS' ELSE 'A5_RESUME_ORPHAN_FAIL' END",
    "FROM aria_internal.mission_wonder_2_a5_scopes s",
    "JOIN aria_internal.mission_state m ON m.mission_id=s.mission_id",
    "JOIN aria_internal.execution_jobs j ON j.job_id=s.job_id",
    "WHERE s.scope_id=" + sqlQuote(M22_A5_SCOPE_ID) + " AND",
    "(SELECT count(*) FROM aria_internal.execution_jobs WHERE mission_id=" + sqlQuote(MISSION_ID) + ")=1;"
  ].join("\n");
  requireMarker(runSql(resumePreflightSql), "A5_RESUME_ORPHAN_PASS");

  const requestOutput = runSql(
    "SELECT 'A5_RESUME_REQUEST_ID=' || request_id FROM aria_internal.mission_wonder_2_a5_scopes WHERE scope_id="
      + sqlQuote(M22_A5_SCOPE_ID) + ";"
  );
  const requestId = requestOutput.match(/A5_RESUME_REQUEST_ID=([0-9a-f-]{20,})/i)?.[1] || "";
  assert.ok(requestId, "original PWA request id missing from orphaned A5 scope");
  report.request_id = requestId;

  const existingMissionReadback = await pwaApi(page, session.accessToken, "/api/missions/" + encodeURIComponent(MISSION_ID));
  report.pwa_existing_mission_readback_http = existingMissionReadback.status;
  assert.equal(existingMissionReadback.status, 200, "original A5 mission is not readable from the authenticated PWA");
  const existingMission = existingMissionReadback.body?.mission || null;
  assert.equal(String(existingMission?.status || ""), "waiting", "orphaned A5 mission must still be waiting");
  assert.equal(Number(existingMission?.completed_steps), 0);
  assert.equal(Number(existingMission?.total_steps), 1);
  report.pwa_mission_resumed = true;

  // Re-arm only the already-approved A5 row, after proving owner, goal, mission and job identity.
  const rearmSql = [
    "UPDATE aria_internal.mission_wonder_2_a5_scopes",
    "SET status='armed',expires_at=clock_timestamp()+interval '45 minutes',revoked_at=NULL,updated_at=clock_timestamp()",
    "WHERE scope_id=" + sqlQuote(M22_A5_SCOPE_ID),
    "AND scope_key=" + sqlQuote(M22_A5_SCOPE_KEY),
    "AND owner_user_id=" + sqlQuote(session.userId) + " AND request_id=" + sqlQuote(requestId),
    "AND goal_hash=" + sqlQuote(goalHash) + " AND mission_id=" + sqlQuote(MISSION_ID),
    "AND job_id=" + sqlQuote(JOB_ID) + " AND allowed_device_id=" + sqlQuote(DEVICE_ID),
    "AND command=" + sqlQuote(step.input.command) + " AND status='revoked' AND recovery_used=false",
    "AND EXISTS (SELECT 1 FROM aria_internal.mission_state m WHERE m.mission_id=" + sqlQuote(MISSION_ID),
    "AND m.status='waiting' AND m.current_step=0 AND m.completed_steps=0 AND m.total_steps=1",
    "AND m.metadata->>'user_id'=" + sqlQuote(session.userId),
    "AND m.metadata->>'request_id'=" + sqlQuote(requestId),
    "AND m.metadata->>'mission_wonder_2_a5_goal_hash'=" + sqlQuote(goalHash) + ")",
    "AND EXISTS (SELECT 1 FROM aria_internal.execution_jobs j WHERE j.job_id=" + sqlQuote(JOB_ID),
    "AND j.mission_id=" + sqlQuote(MISSION_ID) + " AND j.status='queued' AND j.completed_at IS NULL",
    "AND j.claimed_at IS NULL AND j.lease_owner IS NULL AND j.lease_until IS NULL AND j.recovery_count=0)",
    "AND (SELECT count(*) FROM aria_internal.execution_jobs WHERE mission_id=" + sqlQuote(MISSION_ID) + ")=1",
    "RETURNING 'A5_SCOPE_REARMED=' || scope_id;"
  ].join("\n");
  scopeCleanupRequired = true;
  requireMarker(runSql(rearmSql, true), "A5_SCOPE_REARMED=" + M22_A5_SCOPE_ID);

  const claimScopeSql = "SELECT 'A5_SCOPE_CLAIM=' || coalesce(aria_internal.aria_m22_a5_claim_scope_v1("
    + [sqlQuote(session.userId), sqlQuote(requestId), sqlQuote(goalHash), "NULL"].join(",")
    + ")->>'status','null');";
  requireMarker(runSql(claimScopeSql, true), "A5_SCOPE_CLAIM=claimed");

  const bindScopeSql = "SELECT 'A5_SCOPE_BIND=' || aria_internal.aria_m22_a5_bind_scope_v1("
    + [sqlQuote(M22_A5_SCOPE_ID), sqlQuote(MISSION_ID), sqlQuote(session.userId),
      sqlQuote(requestId), sqlQuote(goalHash)].join(",") + ")::text;";
  requireMarker(runSql(bindScopeSql, true), "A5_SCOPE_BIND=true");
  report.scope_armed = true;
  report.scope_bound = true;
  report.pwa_mission_created = false;
  console.log("MISSION_WONDER_2_STEP5_A5_ORIGINAL_PWA_MISSION_RESUMED=PASS");

  const denied = await pwaApi(page, session.accessToken, "/api/missions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-aria-request-id": "a5-denied-" + RUN_ID + "-" + RUN_ATTEMPT,
    },
    body: JSON.stringify({ goal: "A5 global freeze negative control; must remain denied." }),
  });
  report.global_freeze_negative_control = denied.status;
  assert.equal(denied.status, 423, "unscoped ordinary PWA mission must remain frozen");

  const tick = await runtimeTick();
  report.runtime_tick = { http_status: tick.status, status: tick.body?.status || tick.body?.error || null };
  if (tick.status !== 200 && tick.status !== 202) fail("A5 canonical runtime tick HTTP " + tick.status);

  const checkpointSql = [
    "SELECT 'A5_CHECKPOINT_READY=' || CASE WHEN",
    "(SELECT count(*) FROM aria_internal.mission_state m",
    "JOIN aria_internal.mission_wonder_2_a5_scopes s ON s.mission_id=m.mission_id",
    "WHERE m.mission_id=" + sqlQuote(MISSION_ID) + " AND m.status='waiting'",
    "AND m.current_step=0 AND m.completed_steps=0 AND m.total_steps=1",
    "AND m.metadata->>'mission_wonder_2_a5_scope_id'=" + sqlQuote(M22_A5_SCOPE_ID),
    "AND m.metadata->>'request_id'=" + sqlQuote(requestId),
    "AND m.checkpoint->'recovery'->>'status'='waiting_for_async_executor'",
    "AND m.checkpoint->'pending_jobs'->'a5_idempotent_recovery_marker'->>'job_id'=" + sqlQuote(JOB_ID),
    "AND m.checkpoint->'pending_jobs'->'a5_idempotent_recovery_marker'->>'attempt'='1'",
    "AND s.status='bound' AND s.job_id=" + sqlQuote(JOB_ID),
    "AND s.allowed_device_id=" + sqlQuote(DEVICE_ID) + " AND s.expires_at>clock_timestamp())=1",
    "AND (SELECT count(*) FROM aria_internal.execution_jobs j",
    "WHERE j.mission_id=" + sqlQuote(MISSION_ID) + " AND j.job_id=" + sqlQuote(JOB_ID),
    "AND j.device_id=" + sqlQuote(DEVICE_ID) + " AND j.operation='shell.execute'",
    "AND j.command=" + sqlQuote(step.input.command) + " AND j.cwd='C:\\Windows\\Temp'",
    "AND j.timeout_ms=900000 AND j.status='running' AND j.completed_at IS NULL",
    "AND j.lease_owner IS NOT NULL AND j.lease_until>clock_timestamp()",
    "AND j.policy @> '{\"mission_wonder_2_a5_recovery\":true,\"idempotent_artifact\":true,\"max_artifacts\":1}'::jsonb",
    "AND j.metadata->>'idempotency_key'=" + sqlQuote(JOB_ID) + ")=1",
    "AND (SELECT count(*) FROM aria_internal.execution_jobs WHERE mission_id=" + sqlQuote(MISSION_ID) + ")=1",
    "THEN 'true' ELSE 'false' END;"
  ].join("\n");
  let ready = false;
  for (let poll = 1; poll <= 90; poll += 1) {
    const output = runSql(checkpointSql);
    if (output.includes("A5_CHECKPOINT_READY=true")) { ready = true; break; }
    await sleep(2000);
  }
  if (!ready) {
    const diagnosticSql = [
      "SELECT m.status,m.current_step,m.completed_steps,m.total_steps,",
      "m.checkpoint->'recovery' AS recovery,m.checkpoint->'pending_jobs' AS pending_jobs,",
      "j.status AS job_status,j.completed_at,j.lease_until,s.status AS scope_status",
      "FROM aria_internal.mission_state m",
      "LEFT JOIN aria_internal.execution_jobs j ON j.mission_id=m.mission_id",
      "LEFT JOIN aria_internal.mission_wonder_2_a5_scopes s ON s.mission_id=m.mission_id",
      "WHERE m.mission_id=" + sqlQuote(MISSION_ID) + ";"
    ].join("\n");
    console.error("A5_CHECKPOINT_DIAGNOSTIC " + runSql(diagnosticSql).slice(-4000));
    fail("A5 ordinary PWA mission did not reach the exact running-job checkpoint");
  }
  report.job_running = true;
  report.artifact_checkpoint_waiting = true;
  report.checkpoint_status = "PASS";
  console.log("MISSION_WONDER_2_STEP5_A5_CHECKPOINT=PASS");

  // This is the only recovery grant for this one-shot scope/run.
  const recoveryGrantRef = "a5-recovery-" + RUN_ID + "." + RUN_ATTEMPT;
  const recoverySql = "SELECT 'A5_RECOVERY_RESULT=' || aria_internal.aria_m22_a5_recover_running_job_v1("
    + [sqlQuote(MISSION_ID), sqlQuote(M22_A5_SCOPE_ID), sqlQuote(JOB_ID), sqlQuote(recoveryGrantRef)].join(",")
    + ")::text;";
  const recoveryOutput = runSql(recoverySql, true);
  const recoveryMatch = recoveryOutput.match(/A5_RECOVERY_RESULT=(\{[^\r\n]*\})/);
  if (!recoveryMatch) {
    console.error("A5_RECOVERY_RESULT_MISSING " + recoveryOutput.slice(-2500));
    fail("A5 controlled recovery RPC did not return JSON evidence");
  }
  const recovery = JSON.parse(recoveryMatch[1]);
  assert.equal(recovery.action, "recovered", "A5 recovery RPC was not accepted");
  assert.equal(recovery.mission_id, MISSION_ID);
  assert.equal(recovery.scope_id, M22_A5_SCOPE_ID);
  assert.equal(recovery.job_id, JOB_ID, "recovery must retain the exact original job_id");
  assert.equal(recovery.previous_attempt, 1);
  assert.equal(recovery.next_attempt, 2);
  assert.equal(recovery.same_job_id, true);
  assert.equal(recovery.new_job_created, false);
  assert.equal(recovery.recovery_count, 1);
  report.recovery = {
    action: recovery.action,
    job_id: recovery.job_id,
    previous_attempt: recovery.previous_attempt,
    next_attempt: recovery.next_attempt,
    same_job_id: recovery.same_job_id,
    new_job_created: recovery.new_job_created,
    recovery_count: recovery.recovery_count,
    grant_ref: recoveryGrantRef,
  };
  console.log("MISSION_WONDER_2_STEP5_A5_RECOVERY_RPC=PASS");

  const finalSql = [
    "SELECT 'A5_FINAL_LIVE_READY=' || CASE WHEN",
    "(SELECT count(*) FROM aria_internal.mission_state m",
    "JOIN aria_internal.execution_jobs j ON j.mission_id=m.mission_id",
    "JOIN aria_internal.mission_wonder_2_a5_scopes s ON s.mission_id=m.mission_id",
    "WHERE m.mission_id=" + sqlQuote(MISSION_ID) + " AND m.status='succeeded'",
    "AND m.completed_steps=1 AND m.total_steps=1",
    "AND j.recovery_count=1",
    "AND m.lease_owner IS NULL AND m.lease_until IS NULL",
    "AND j.job_id=" + sqlQuote(JOB_ID) + " AND j.device_id=" + sqlQuote(DEVICE_ID),
    "AND j.status='succeeded' AND j.exit_code=0 AND j.completed_at IS NOT NULL",
    "AND j.lease_owner IS NULL AND j.lease_until IS NULL",
    "AND j.metadata->>'mission_wonder_2_a5_attempt'='2'",
    "AND j.stdout LIKE '%A5_RECOVERY_ALREADY_IDENTICAL;attempt=2;files=1;sha256=%'",
    "AND s.scope_id=" + sqlQuote(M22_A5_SCOPE_ID) + " AND s.status='completed'",
    "AND s.recovery_used=true AND s.recovery_grant_ref=" + sqlQuote(recoveryGrantRef) + ")=1",
    "AND (SELECT count(*) FROM aria_internal.execution_jobs WHERE mission_id=" + sqlQuote(MISSION_ID) + ")=1",
    "AND (SELECT count(*) FROM aria_internal.execution_job_events WHERE job_id=" + sqlQuote(JOB_ID) + " AND event_type='job.timeout')=1",
    "AND (SELECT count(*) FROM aria_internal.execution_job_events WHERE job_id=" + sqlQuote(JOB_ID) + " AND event_type='job.claimed_a5_one_shot' AND payload->>'attempt'='1')=1",
    "AND (SELECT count(*) FROM aria_internal.execution_job_events WHERE job_id=" + sqlQuote(JOB_ID) + " AND event_type='job.claimed_a5_one_shot' AND payload->>'attempt'='2')=1",
    "AND (SELECT count(*) FROM aria_internal.execution_job_events WHERE job_id=" + sqlQuote(JOB_ID) + " AND event_type='job.a5_stale_attempt_rejected' AND payload->>'expected_http_status'='409' AND payload->>'stale_attempt'='1' AND payload->>'current_attempt'='2')=1",
    "AND (SELECT count(*) FROM aria_internal.execution_job_events WHERE job_id=" + sqlQuote(JOB_ID) + " AND event_type='job.succeeded')=1",
    "AND (SELECT count(*) FROM aria_internal.mission_events WHERE mission_id=" + sqlQuote(MISSION_ID) + " AND event_type='mission_verified')=1",
    "THEN 'true' ELSE 'false' END;"
  ].join("\n");
  let finalReady = false;
  for (let poll = 1; poll <= 180; poll += 1) {
    const output = runSql(finalSql);
    if (output.includes("A5_FINAL_LIVE_READY=true")) { finalReady = true; break; }
    await sleep(2000);
  }
  if (!finalReady) {
    const diagnosticSql = [
      "SELECT m.status AS mission_status,m.current_step,m.completed_steps,m.total_steps,m.recovery_count,",
      "m.checkpoint->'recovery' AS recovery,j.status AS job_status,j.metadata AS job_metadata,",
      "j.result->'metadata' AS result_metadata,j.lease_until,s.status AS scope_status,s.recovery_used,",
      "(SELECT jsonb_agg(jsonb_build_object('event_type',e.event_type,'payload',e.payload) ORDER BY e.created_at)",
      " FROM aria_internal.execution_job_events e WHERE e.job_id=j.job_id) AS job_events",
      "FROM aria_internal.mission_state m",
      "LEFT JOIN aria_internal.execution_jobs j ON j.mission_id=m.mission_id",
      "LEFT JOIN aria_internal.mission_wonder_2_a5_scopes s ON s.mission_id=m.mission_id",
      "WHERE m.mission_id=" + sqlQuote(MISSION_ID) + ";"
    ].join("\n");
    console.error("A5_FINAL_DIAGNOSTIC " + runSql(diagnosticSql).slice(-5000));
    fail("A5 recovery did not reach the independently verified terminal state");
  }
  report.final_live_audit = "PASS";
  report.mission_terminal_status = "succeeded";
  report.same_job_reclaimed = true;
  report.old_attempt_http_409 = true;
  report.duplicate_jobs = 0;
  report.duplicate_effects = 0;

  const missionUrl = "/api/missions/" + encodeURIComponent(MISSION_ID);
  const missionReadback = await pwaApi(page, session.accessToken, missionUrl);
  report.pwa_mission_readback_http = missionReadback.status;
  assert.equal(missionReadback.status, 200, "A5 PWA mission readback failed");
  const mission = missionReadback.body?.mission || null;
  assert.equal(String(mission?.status || ""), "succeeded", "PWA must display the terminal succeeded mission");
  assert.equal(Number(mission?.completed_steps), 1);
  assert.equal(Number(mission?.total_steps), 1);

  const [eventsReadback, notificationReadback] = await Promise.all([
    pwaApi(page, session.accessToken, missionUrl + "/events"),
    pwaApi(page, session.accessToken, "/api/meditation/notifications?limit=50"),
  ]);
  assert.equal(eventsReadback.status, 200, "A5 PWA events readback failed");
  assert.equal(notificationReadback.status, 200, "A5 PWA notifications readback failed");
  const verifiedEvents = (Array.isArray(eventsReadback.body?.events) ? eventsReadback.body.events : [])
    .filter((event) => event?.event_type === "mission_verified");
  const verifiedNotifications = (Array.isArray(notificationReadback.body?.notifications) ? notificationReadback.body.notifications : [])
    .filter((item) => item?.kind === "mission_completed_verified" && String(item?.mission_id || "") === MISSION_ID);
  report.mission_verified_events = verifiedEvents.length;
  report.verified_notifications = verifiedNotifications.length;
  assert.equal(verifiedEvents.length, 1, "A5 requires exactly one mission_verified event");
  assert.equal(verifiedNotifications.length, 1, "A5 requires exactly one verified PWA notification");

  const deniedAfterRecovery = await pwaApi(page, session.accessToken, "/api/missions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-aria-request-id": "a5-denied-after-recovery-" + RUN_ID + "-" + RUN_ATTEMPT,
    },
    body: JSON.stringify({ goal: "A5 freeze remains closed after the one-shot recovery." }),
  });
  report.global_freeze_after_recovery = deniedAfterRecovery.status;
  assert.equal(deniedAfterRecovery.status, 423, "global freeze must remain closed after A5 completion");

  report.status = "PASS";
  console.log("MISSION_WONDER_2_STEP5_A5_LIVE_E2E=PASS");
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = "FAIL";
  report.failure = String(error?.stack || error).slice(0, 4500);
  console.error("MISSION_WONDER_2_STEP5_A5_PILOT_FAIL " + JSON.stringify(report));
  throw error;
} finally {
  if (scopeCleanupRequired && report.status !== "PASS") {
    try {
      const revokeSql = [
        "SELECT CASE",
        "WHEN NOT EXISTS (SELECT 1 FROM aria_internal.mission_wonder_2_a5_scopes WHERE scope_id=" + sqlQuote(M22_A5_SCOPE_ID) + " AND owner_user_id=" + sqlQuote(scopeOwnerId) + " AND goal_hash=" + sqlQuote(scopeGoalHash) + ") THEN 'A5_SCOPE_NOT_CREATED'",
        "WHEN EXISTS (SELECT 1 FROM aria_internal.mission_wonder_2_a5_scopes WHERE scope_id=" + sqlQuote(M22_A5_SCOPE_ID) + " AND owner_user_id=" + sqlQuote(scopeOwnerId) + " AND goal_hash=" + sqlQuote(scopeGoalHash) + " AND status='completed') THEN 'A5_SCOPE_COMPLETED_PRESERVED'",
        "WHEN EXISTS (SELECT 1 FROM aria_internal.mission_wonder_2_a5_scopes WHERE scope_id=" + sqlQuote(M22_A5_SCOPE_ID) + " AND owner_user_id=" + sqlQuote(scopeOwnerId) + " AND goal_hash=" + sqlQuote(scopeGoalHash) + " AND status='revoked') THEN 'A5_SCOPE_ALREADY_REVOKED'",
        "ELSE 'A5_SCOPE_REVOKE=' || aria_internal.aria_m22_a5_revoke_scope_v1(" + sqlQuote(M22_A5_SCOPE_ID) + ")::text END;"
      ].join("\n");
      const revokeOutput = runSql(revokeSql, true);
      report.scope_revoked = revokeOutput.includes("A5_SCOPE_REVOKE=true") || revokeOutput.includes("A5_SCOPE_ALREADY_REVOKED");
      if (!report.scope_revoked && !revokeOutput.includes("A5_SCOPE_COMPLETED_PRESERVED") && !revokeOutput.includes("A5_SCOPE_NOT_CREATED")) {
        throw new Error("A5 scope cleanup could not be verified");
      }
    } catch (cleanupError) {
      report.scope_revoked = false;
      report.failure = (report.failure || "") + "\nA5_SCOPE_CLEANUP_FAILURE=" + String(cleanupError?.message || cleanupError);
      report.status = "FAIL";
      console.error("A5_SCOPE_CLEANUP=FAIL " + String(cleanupError?.message || cleanupError));
    }
  }
  if (page) await page.screenshot({ path: path.join(ARTIFACT_DIR, "a5-final.png"), fullPage: true }).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  fs.writeFileSync(path.join(ARTIFACT_DIR, "a5-live-report.json"), JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
}
