import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const PROJECT = String(process.env.SUPABASE_PROJECT_REF || "");
const ACCESS_TOKEN = String(process.env.SUPABASE_ACCESS_TOKEN || "");
const RUNTIME_SECRET = String(process.env.ARIA_RUNTIME_SHARED_SECRET || "");
const SESSION_STATE_GZIP_B64 = String(process.env.RWHT_STORAGE_STATE_GZIP_B64 || "");
const SESSION_STATE_B64 = String(process.env.RWHT_STORAGE_STATE_B64 || "");
const RWHT_EMAIL = String(process.env.RWHT_EMAIL || "");
const RWHT_PASSWORD = String(process.env.RWHT_PASSWORD || "");
const EXECUTE = String(process.env.EXECUTE_RUNNER_HANDOFF_RETRY || "false") === "true";
const MISSION_ID = "mission_a4_authorized_once";
const SCOPE_KEY = "mission-wonder-2-step4-a4:single-authorized-execution";
const GRANT_REF = "a4-recovery-42110933267.1";
const FAILED_RUN_ID = "42131077740";
const RUNNER_HTTP_STATUS = 401;
const RUNNER_URL = "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mission-runner-v22";
const PWA_MISSION_API = String(process.env.RWHT_MISSION_API_BASE || "https://aria.robvg9.workers.dev/api/missions");
const PWA_NOTIFICATIONS_API = String(process.env.RWHT_NOTIF_API_URL || "https://aria.robvg9.workers.dev/api/meditation/notifications?limit=50");
const POLL_MS = 6000;
const MAX_POLLS = Math.ceil((Number(process.env.A4_HANDOFF_POLL_SECONDS || 720) * 1000) / POLL_MS);
const REPORT_DIR = path.resolve(process.env.RWHT_ARTIFACT_DIR || "a4-runner-handoff-artifacts");
const report = {
  run_id: String(process.env.GITHUB_RUN_ID || ""),
  mission_id: MISSION_ID,
  mode: EXECUTE ? "execute" : "dry_run",
  auth_probe: null,
  preflight: null,
  retry_claim: null,
  runner_handoff: null,
  terminal: null,
  pwa_readback: null,
  notification_readback: null,
  failure: null,
};

function persist() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, "a4-runner-handoff-report.json"), JSON.stringify(report, null, 2));
}
function fail(message) {
  report.failure = message;
  persist();
  throw new Error(message);
}
function sqlQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function runSql(sql, write = false) {
  const args = ["db", "query", sql, ...(write ? ["--yes"] : ["--read-only"]), "--remote"];
  const result = spawnSync("supabase", args, {
    cwd: process.env.GITHUB_WORKSPACE || process.cwd(),
    encoding: "utf8",
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = String(result.stdout || "") + "\n" + String(result.stderr || "");
  if (result.status !== 0) fail("supabase_sql_failed exit=" + result.status + " " + output.slice(-1200));
  return output;
}
function parseMarker(output, marker) {
  const lines = String(output).split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(marker);
    if (idx < 0) continue;
    let value = line.slice(idx + marker.length).trim();
    value = value.replace(/[│|]+\s*$/g, "").trim();
    const endObject = value.lastIndexOf("}");
    if (endObject >= 0) value = value.slice(0, endObject + 1);
    return value;
  }
  fail("sql_marker_missing:" + marker);
}
async function responseBody(response) {
  return await response.text().catch(() => "");
}
async function loadApiKeys() {
  const url = "https://api.supabase.com/v1/projects/" + encodeURIComponent(PROJECT) + "/api-keys?reveal=true";
  const response = await fetch(url, {
    headers: { Authorization: "Bearer " + ACCESS_TOKEN, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) fail("supabase_management_api_keys_http_" + response.status);
  const body = await response.json();
  if (!Array.isArray(body)) fail("supabase_management_api_keys_shape_invalid");
  const candidates = body
    .filter((item) => typeof item?.api_key === "string" && item.api_key.length > 10)
    .filter((item) => String(item?.type || "").toLowerCase() === "publishable" ||
      String(item?.name || "").toLowerCase() === "anon")
    .sort((a, b) => (String(a.type).toLowerCase() === "publishable" ? -1 : 1));
  if (!candidates.length) fail("no_publishable_or_anon_api_key_available");
  return candidates.map((item) => ({ name: String(item.name || item.type), value: item.api_key }));
}

async function main() {
  assert.ok(PROJECT === "icuqsstxfdbvjytkhlog", "wrong Supabase project");
  assert.ok(ACCESS_TOKEN, "SUPABASE_ACCESS_TOKEN required");
  assert.ok(RUNTIME_SECRET, "ARIA_RUNTIME_SHARED_SECRET required");
  assert.ok(SESSION_STATE_GZIP_B64 || SESSION_STATE_B64, "PWA storage state required");

  const identitySql = `
    WITH m AS (
      SELECT * FROM aria_internal.mission_state WHERE mission_id=${sqlQuote(MISSION_ID)}
    ), s AS (
      SELECT * FROM aria_internal.mission_wonder_2_a4_scopes WHERE mission_id=${sqlQuote(MISSION_ID)}
    )
    SELECT 'A4_HANDOFF_PREFLIGHT=' || jsonb_build_object(
      'mission_count',(SELECT count(*) FROM m),
      'mission_id',(SELECT mission_id FROM m),
      'mission_status',(SELECT status FROM m),
      'current_step',(SELECT current_step FROM m),
      'completed_steps',(SELECT completed_steps FROM m),
      'user_id',(SELECT metadata->>'user_id' FROM m),
      'request_id',(SELECT metadata->>'request_id' FROM m),
      'goal_hash',(SELECT metadata->>'mission_wonder_2_a4_goal_hash' FROM m),
      'scope_id',(SELECT scope_id FROM s),
      'scope_count',(SELECT count(*) FROM s),
      'scope_key',(SELECT scope_key FROM s),
      'scope_status',(SELECT status FROM s),
      'scope_expires_at',(SELECT expires_at FROM s),
      'allowed_device_id',(SELECT allowed_device_id FROM s),
      'grant_ref',(SELECT metadata->'a4_recovery_dispatch_v1'->>'grant_ref' FROM m),
      'grant_consumed',(SELECT metadata->'a4_recovery_dispatch_v1'->>'consumed' FROM m),
      'tick_claimed',(SELECT metadata->'a4_recovery_dispatch_v1'->>'tick_claimed' FROM m),
      'tick_claim_ref',(SELECT metadata->'a4_recovery_dispatch_v1'->>'tick_claim_ref' FROM m),
      'scope_resume_count',(SELECT metadata->'a4_recovery_dispatch_v1'->>'scope_resume_count' FROM m),
      'scope_resume_grant_ref',(SELECT metadata->'a4_recovery_dispatch_v1'->>'scope_resume_grant_ref' FROM m),
      'retry_count',(SELECT coalesce(metadata->'a4_recovery_dispatch_v1'->>'runner_handoff_retry_count','0') FROM m),
      'mission_lease_active',(SELECT lease_owner IS NOT NULL AND lease_until > clock_timestamp() FROM m),
      'job_count',(SELECT count(*) FROM aria_internal.execution_jobs WHERE mission_id=${sqlQuote(MISSION_ID)}),
      'eligible_agents',(SELECT count(*) FROM aria_internal.device_registry d WHERE d.agent_type='windows-local' AND d.status='online' AND d.token_hash IS NOT NULL AND d.capabilities @> '[\"shell.execute\"]'::jsonb AND d.last_seen_at > clock_timestamp()-interval '180 seconds'),
      'allowed_agent_eligible',(SELECT count(*) FROM aria_internal.device_registry d JOIN s ON d.device_id=s.allowed_device_id WHERE d.agent_type='windows-local' AND d.status='online' AND d.token_hash IS NOT NULL AND d.capabilities @> '[\"shell.execute\"]'::jsonb AND d.last_seen_at > clock_timestamp()-interval '180 seconds')
    )::text;
  `;
  const identityRaw = parseMarker(runSql(identitySql), "A4_HANDOFF_PREFLIGHT=");
  const identity = JSON.parse(identityRaw);
  report.preflight = identity;
  const required = {
    mission_count: 1,
    mission_id: MISSION_ID,
    mission_status: "queued",
    current_step: 0,
    completed_steps: 0,
    scope_count: 1,
    scope_key: SCOPE_KEY,
    scope_status: "bound",
    grant_ref: GRANT_REF,
    grant_consumed: "true",
    tick_claimed: "true",
    tick_claim_ref: GRANT_REF + ":tick",
    scope_resume_count: "1",
    scope_resume_grant_ref: GRANT_REF,
    retry_count: "0",
    mission_lease_active: false,
    job_count: 0,
    eligible_agents: 1,
    allowed_agent_eligible: 1,
  };
  for (const [key, value] of Object.entries(required)) {
    if (identity[key] !== value) fail("preflight_mismatch:" + key + ":expected=" + String(value) + ":actual=" + String(identity[key]));
  }
  if (!identity.user_id || !/^[a-f0-9-]{10,80}$/.test(identity.user_id)) fail("preflight_user_id_invalid");
  if (!identity.request_id || !/^[a-f0-9-]{10,80}$/.test(identity.request_id)) fail("preflight_request_id_invalid");
  if (!identity.goal_hash || !/^[0-9a-f]{64}$/.test(identity.goal_hash)) fail("preflight_goal_hash_invalid");
  if (!identity.scope_id || !/^[A-Za-z0-9_-]{8,120}$/.test(identity.scope_id)) fail("preflight_scope_id_invalid");
  if (!identity.allowed_device_id) fail("preflight_device_missing");
  const scopeExpiryMs = Date.parse(identity.scope_expires_at);
  if (!Number.isFinite(scopeExpiryMs) || scopeExpiryMs <= Date.now() - 2 * 60 * 60 * 1000) {
    fail("preflight_scope_expired_outside_one_time_continuation_window");
  }

  const apiKeys = await loadApiKeys();
  let acceptedApiKey = null;
  for (const candidate of apiKeys) {
    const probe = await fetch(RUNNER_URL, {
      method: "POST",
      headers: {
        apikey: candidate.value,
        Authorization: "Bearer " + RUNTIME_SECRET,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(20000),
    });
    const body = await responseBody(probe);
    if (probe.status === 423) {
      acceptedApiKey = candidate.value;
      report.auth_probe = { status: 423, expected: 423, key_type: candidate.name, passed: true };
      break;
    }
    report.auth_probe = { status: probe.status, expected: 423, key_type: candidate.name, body: body.slice(0, 300), passed: false };
  }
  if (!acceptedApiKey) fail("runner_auth_probe_failed_before_any_database_write");
  // Mask this public API key in all subsequent GitHub Action output.
  console.log("::add-mask::" + acceptedApiKey);

  if (!EXECUTE) {
    report.status = "DRY_RUN_AUTH_AND_IDENTITY_PASS_NO_WRITE";
    persist();
    console.log("A4_RUNNER_HANDOFF_DRY_RUN_PASS");
    return;
  }

  const claimSql = `
    SELECT 'A4_HANDOFF_RETRY=' ||
      coalesce(v->>'action','') || '|REF=' || coalesce(v->>'handoff_retry_ref','')
    FROM (
      SELECT aria_internal.aria_m22_a4_claim_runner_handoff_retry_v1(
        ${sqlQuote(MISSION_ID)},
        ${sqlQuote(identity.scope_id)},
        ${sqlQuote(identity.user_id)},
        ${sqlQuote(identity.request_id)},
        ${sqlQuote(identity.goal_hash)},
        ${sqlQuote(GRANT_REF)},
        ${sqlQuote(FAILED_RUN_ID)},
        ${RUNNER_HTTP_STATUS}
      ) AS v
    ) claimed;
  `;
  const claim = parseMarker(runSql(claimSql, true), "A4_HANDOFF_RETRY=");
  const expectedRetryRef = GRANT_REF + ":runner-handoff-retry";
  if (claim !== "runner_handoff_retry_claimed|REF=" + expectedRetryRef) {
    fail("runner_handoff_claim_refused:" + claim);
  }
  report.retry_claim = { action: "runner_handoff_retry_claimed", retry_ref: expectedRetryRef, original_tick_reused: true };
  persist();

  const runnerResponse = await fetch(RUNNER_URL, {
    method: "POST",
    headers: {
      apikey: acceptedApiKey,
      Authorization: "Bearer " + RUNTIME_SECRET,
      "Content-Type": "application/json",
      "X-ARIA-Trace-Id": "d119e8f1-abbc-41e8-a1aa-ca08a6fbc3f3",
    },
    body: JSON.stringify({ mission_id: MISSION_ID }),
    signal: AbortSignal.timeout(150000),
  });
  const runnerBody = await responseBody(runnerResponse);
  report.runner_handoff = { http_status: runnerResponse.status, body: runnerBody.slice(0, 3000), retry_ref: expectedRetryRef };
  persist();
  if (![200, 202].includes(runnerResponse.status)) {
    fail("direct_runner_handoff_http_" + runnerResponse.status + "_after_one_time_retry_claim");
  }

  let finalState = null;
  for (let poll = 1; poll <= MAX_POLLS; poll += 1) {
    const stateSql = `
      SELECT 'A4_FINAL_STATE=' || jsonb_build_object(
        'status',m.status,'current_step',m.current_step,'completed_steps',m.completed_steps,'total_steps',m.total_steps,
        'job_count',(SELECT count(*) FROM aria_internal.execution_jobs j WHERE j.mission_id=m.mission_id),
        'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('job_id',j.job_id,'status',j.status,'exit_code',j.exit_code,'device_id',j.device_id,'operation',j.operation)), '[]'::jsonb) FROM aria_internal.execution_jobs j WHERE j.mission_id=m.mission_id),
        'verified_events',(SELECT count(*) FROM aria_internal.mission_events e WHERE e.mission_id=m.mission_id AND e.event_type='mission_verified'),
        'notifications',(SELECT count(*) FROM aria_internal.meditation_notifications n WHERE n.mission_id=m.mission_id),
        'scope_status',s.status,'scope_expires_at',s.expires_at,'scope_completed_at',s.completed_at,'scope_revoked_at',s.revoked_at,
        'mission_lease_owner',m.lease_owner,'mission_lease_until',m.lease_until,
        'active_job_leases',(SELECT count(*) FROM aria_internal.execution_jobs j WHERE j.mission_id=m.mission_id AND j.lease_owner IS NOT NULL AND j.lease_until > clock_timestamp())
      )::text
      FROM aria_internal.mission_state m
      JOIN aria_internal.mission_wonder_2_a4_scopes s ON s.mission_id=m.mission_id
      WHERE m.mission_id=${sqlQuote(MISSION_ID)};
    `;
    const state = JSON.parse(parseMarker(runSql(stateSql), "A4_FINAL_STATE="));
    finalState = state;
    report.terminal = { poll, ...state };
    persist();
    if (["succeeded", "failed", "blocked", "cancelled", "paused"].includes(String(state.status))) break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  if (!finalState) fail("mission_state_readback_missing");
  if (finalState.status !== "succeeded") fail("mission_not_succeeded:" + finalState.status);
  if (Number(finalState.completed_steps) !== 1 || Number(finalState.total_steps) !== 1) fail("mission_step_count_mismatch");
  if (Number(finalState.job_count) !== 1) fail("mission_job_count_mismatch");
  if (Number(finalState.verified_events) < 1) fail("mission_verified_event_missing");
  if (Number(finalState.notifications) < 1) fail("mission_notification_missing");
  if (Number(finalState.active_job_leases) !== 0) fail("active_job_lease_remains");

  // Refresh the persisted PWA session once, then read the exact mission through the
  // same authenticated PWA endpoint used by the UI. This is a read-only operation.
  let session = null;
  try {
    const stateJson = SESSION_STATE_GZIP_B64
      ? JSON.parse(zlib.gunzipSync(Buffer.from(SESSION_STATE_GZIP_B64, "base64")).toString("utf8"))
      : JSON.parse(Buffer.from(SESSION_STATE_B64, "base64").toString("utf8"));
    const entry = (stateJson.origins || []).flatMap((origin) => origin.localStorage || []).find((item) => item.name === "aria_session_v2");
    session = entry ? JSON.parse(entry.value) : null;
  } catch {}
  if (session?.userId && session.userId !== identity.user_id) {
    fail("pwa_session_owner_mismatch");
  }
  let accessToken = String(session?.accessToken || "");
  let authSource = accessToken ? "stored_session" : "password_fallback";
  let pwaResponse = accessToken ? await fetch(PWA_MISSION_API + "/" + encodeURIComponent(MISSION_ID), {
    headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" }, cache: "no-store",
  }) : null;
  if (pwaResponse?.status === 401 && (session?.refreshToken || session?.refresh_token)) {
    const refreshResponse = await fetch("https://" + PROJECT + ".supabase.co/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: acceptedApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken || session.refresh_token }),
      signal: AbortSignal.timeout(20000),
    });
    if (refreshResponse.ok) {
      const refreshed = await refreshResponse.json();
      accessToken = String(refreshed.access_token || "");
      if (accessToken) {
        authSource = "refreshed_session";
        pwaResponse = await fetch(PWA_MISSION_API + "/" + encodeURIComponent(MISSION_ID), {
          headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" }, cache: "no-store",
        });
      }
    }
  }
  if (!pwaResponse || pwaResponse.status === 401) {
    if (!RWHT_EMAIL || !RWHT_PASSWORD) fail("pwa_session_invalid_and_rwht_login_unavailable");
    const loginResponse = await fetch("https://" + PROJECT + ".supabase.co/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: acceptedApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email: RWHT_EMAIL, password: RWHT_PASSWORD }),
      signal: AbortSignal.timeout(20000),
    });
    const login = await loginResponse.json().catch(() => null);
    if (!loginResponse.ok || !login?.access_token || String(login?.user?.id || "") !== identity.user_id) {
      fail("pwa_password_fallback_failed_or_owner_mismatch_http_" + loginResponse.status);
    }
    accessToken = String(login.access_token);
    authSource = "password_fallback";
    pwaResponse = await fetch(PWA_MISSION_API + "/" + encodeURIComponent(MISSION_ID), {
      headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" }, cache: "no-store",
    });
  }
  if (!pwaResponse) fail("pwa_mission_readback_request_missing");
  const pwaBody = await pwaResponse.json().catch(() => null);
  const pwaMission = pwaBody?.mission || pwaBody;
  report.pwa_readback = {
    http_status: pwaResponse.status,
    auth_source: authSource,
    mission_status: pwaMission?.status || null,
    completed_steps: pwaMission?.completed_steps ?? null,
    passed: pwaResponse.ok && pwaMission?.status === "succeeded" && Number(pwaMission?.completed_steps) === 1,
  };
  if (!report.pwa_readback.passed) fail("pwa_mission_readback_failed_http_" + pwaResponse.status);

  const notificationsResponse = await fetch(PWA_NOTIFICATIONS_API, {
    headers: { Authorization: "Bearer " + accessToken, Accept: "application/json" }, cache: "no-store",
  });
  const notificationsBody = await notificationsResponse.json().catch(() => null);
  const items = Array.isArray(notificationsBody) ? notificationsBody
    : Array.isArray(notificationsBody?.notifications) ? notificationsBody.notifications
    : Array.isArray(notificationsBody?.items) ? notificationsBody.items
    : [];
  const missionNotification = items.find((item) =>
    item?.kind === "mission_completed_verified" &&
    (item?.mission_id === MISSION_ID || item?.metadata?.mission_id === MISSION_ID)
  ) || null;
  report.notification_readback = {
    http_status: notificationsResponse.status,
    kind: missionNotification?.kind || null,
    visible: Boolean(missionNotification),
  };
  if (!notificationsResponse.ok) fail("pwa_notifications_http_" + notificationsResponse.status);
  if (!missionNotification) fail("verified_pwa_notification_not_visible");

  report.status = "PASS";
  persist();
  console.log("MISSION_WONDER_2_A4_RUNNER_HANDOFF_RETRY_PASS");
}
main().catch((error) => {
  console.error("A4_RUNNER_HANDOFF_RETRY_FAILED: " + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
});
