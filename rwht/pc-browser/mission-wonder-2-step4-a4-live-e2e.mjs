import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const PROJECT = String(process.env.SUPABASE_PROJECT_REF || '');
const RUNTIME_SECRET = String(process.env.ARIA_RUNTIME_SHARED_SECRET || '');
const EMAIL = String(process.env.RWHT_EMAIL || '');
const PASSWORD = String(process.env.RWHT_PASSWORD || '');
const BASE = (String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/#.*$/, '').replace(/\/+$/, '') + '/');
const RUN_ID = String(process.env.GITHUB_RUN_ID || '');
const RUN_ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || '1');
const ARTIFACT_DIR = path.resolve(process.env.RWHT_ARTIFACT_DIR || 'a4-live-artifacts');
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

function fail(message) { throw new Error(message); }
function sqlQuote(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function runSql(query, write = false) {
  const args = ['db', 'query', query, ...(write ? ['--yes'] : ['--read-only']), '--remote'];
  const result = spawnSync('supabase', args, { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 });
  const output = String(result.stdout || '') + '\n' + String(result.stderr || '');
  if (result.status !== 0) {
    console.error('SUPABASE_SQL_FAILED exit=' + result.status + ' output=' + output.slice(-3000));
    fail('supabase_sql_failed');
  }
  return output;
}
function requireMarker(output, marker) {
  if (!output.includes(marker)) {
    console.error('EXPECTED_SQL_MARKER=' + marker + ' OUTPUT=' + output.slice(-3000));
    fail('sql_marker_missing:' + marker);
  }
}
async function browserSession(page) {
  let session = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem('aria_session_v2');
      const value = raw ? JSON.parse(raw) : null;
      return value && typeof value.accessToken === 'string' && value.userId
        ? { accessToken: value.accessToken, userId: String(value.userId) }
        : null;
    } catch { return null; }
  });
  const status = async (token) => page.evaluate(async (value) => {
    const response = await fetch('/api/diagnostics/health', { headers: { authorization: 'Bearer ' + value, accept: 'application/json' }, cache: 'no-store' });
    return response.status;
  }, token);
  if (session && [200, 204].includes(await status(session.accessToken))) return session;

  await page.evaluate(() => localStorage.removeItem('aria_session_v2')).catch(() => {});
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const email = page.locator('form.authCard input[aria-label="Correo"],form.authCard input[type="email"],form.authCard input[name="email"],form.authCard input[autocomplete="username"]').first();
  const password = page.locator('form.authCard input[type="password"],form.authCard input[name="password"],form.authCard input[autocomplete="current-password"]').first();
  await email.waitFor({ state: 'visible', timeout: 60000 });
  await password.waitFor({ state: 'visible', timeout: 30000 });
  if (!EMAIL || !PASSWORD) fail('PWA credentials unavailable and stored session was invalid');
  await email.fill(EMAIL);
  await password.fill(PASSWORD);
  const submit = page.locator('form.authCard button[type="submit"],form.authCard input[type="submit"],form.authCard button')
    .filter({ hasText: /entrar|iniciar|login|sign[ -]?in|continuar|acceder/i }).first();
  if (await submit.count()) await submit.click();
  else await password.press('Enter');

  await page.waitForFunction(() => {
    try {
      const raw = localStorage.getItem('aria_session_v2');
      const value = raw ? JSON.parse(raw) : null;
      return Boolean(value && typeof value.accessToken === 'string' && value.userId);
    } catch { return false; }
  }, null, { timeout: 60000 });
  session = await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('aria_session_v2') || '{}');
    return { accessToken: value.accessToken, userId: String(value.userId || '') };
  });
  if (!session.accessToken || !session.userId || ![200, 204].includes(await status(session.accessToken))) fail('PWA authenticated session could not be verified');
  return session;
}
async function pwaApi(page, token, url, options = {}) {
  return page.evaluate(async ({ url, token, options }) => {
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', ...(options.headers || {}) },
      cache: 'no-store',
    });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw: raw.slice(0, 1000) }; }
    return { status: response.status, body };
  }, { url, token, options });
}
async function runtimeTick(missionId) {
  const response = await fetch(`https://${PROJECT}.supabase.co/functions/v1/aria-canonical-runtime-v1`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + RUNTIME_SECRET, 'Content-Type': 'application/json', 'x-aria-trigger': 'mission-tick' },
    body: JSON.stringify({ mission_id: missionId }),
    signal: AbortSignal.timeout(90000),
  });
  const raw = await response.text();
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw: raw.slice(0, 1000) }; }
  return { status: response.status, body };
}

const report = {
  status: 'running',
  run_id: RUN_ID,
  run_attempt: RUN_ATTEMPT,
  pwa_authenticated: false,
  scope_armed: false,
  pwa_post_seen: false,
  request_id: null,
  mission_id: null,
  device_id: null,
  runtime_ticks: [],
  mission_terminal_status: null,
  mission_verified_events: 0,
  verified_notifications: 0,
  pwa_detail_visible: false,
  global_freeze_negative_controls: {},
  scope_revoked: false,
  failure: null,
};
let browser = null;
let page = null;
let scopeId = null;
let scopeInserted = false;

try {
  assert.ok(PROJECT && RUNTIME_SECRET && RUN_ID, 'A4 workflow secrets/context missing');
  assert.equal(PROJECT, 'icuqsstxfdbvjytkhlog', 'unexpected ARIA Supabase project');
  assert.ok(/^https:\/\//.test(BASE), 'PWA URL must be HTTPS');
  // This workflow is attached to runtime deploys. After the one authorized mission
  // has consumed its scope, later deploys must be a clean no-op, never a second mission.
  scopeId = 'mission_wonder_2_a4_authorized_once';
  const missionId = 'mission_a4_authorized_once';
  const priorScope = runSql(`SELECT CASE WHEN EXISTS(
    SELECT 1 FROM aria_internal.mission_wonder_2_a4_scopes WHERE scope_id=${sqlQuote(scopeId)}
  ) THEN 'A4_SCOPE_ALREADY_CONSUMED' ELSE 'A4_SCOPE_UNUSED' END;`);
  if (priorScope.includes('A4_SCOPE_ALREADY_CONSUMED')) {
    report.status = 'SKIPPED_ALREADY_CONSUMED';
    console.log('MISSION_WONDER_2_STEP4_A4_LIVE_E2E=SKIPPED_ALREADY_CONSUMED');
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'a4-report.json'), JSON.stringify(report, null, 2));
    process.exit(0);
  }
  browser = await chromium.launch({ headless: true });
  const storageState = process.env.RWHT_STORAGE_STATE || '';
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(storageState && fs.existsSync(storageState) ? { storageState } : {}),
  });
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  await page.goto(BASE + '#projects', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const session = await browserSession(page);
  report.pwa_authenticated = true;
  assert.ok(session.userId, 'authenticated user id missing');

  const deviceOutput = runSql(`
    SELECT 'A4_DEVICE_ID=' || device_id
      FROM aria_internal.device_registry
     WHERE agent_type='windows-local'
       AND status='online'
       AND capabilities @> '["shell.execute"]'::jsonb
       AND last_seen_at > clock_timestamp() - interval '3 minutes'
     ORDER BY last_seen_at DESC
     LIMIT 1;
  `);
  const deviceId = deviceOutput.match(/A4_DEVICE_ID=([A-Za-z0-9._-]+)/)?.[1] || '';
  assert.ok(deviceId, 'no fresh online Windows shell.execute agent; scope not armed');
  report.device_id = deviceId;

  const goal = `Mission Wonder 2 — certificación A4 PWA de solo lectura, ejecución ${RUN_ID}.${RUN_ATTEMPT}: comprobar el flujo autenticado PWA → una única misión canónica → un único job/lease → verificación independiente → mission_verified → notificación visible. Ejecuta exclusivamente la lectura de la hora UTC del agente Windows autorizado. No modificar repositorios, archivos, configuración, dispositivos, cuentas ni datos financieros.`;
  const goalHash = createHash('sha256').update(JSON.stringify({
    version: 1, user_id: String(session.userId), goal: goal.trim(), project_id: null,
  }), 'utf8').digest('hex');
  // A globally unique scope key makes this authorization a true lifetime one-shot.
  // Re-running or retrying this workflow cannot create a second A4 mission.
  const scopeKey = 'mission-wonder-2-step4-a4:single-authorized-execution';
  const insert = `
    INSERT INTO aria_internal.mission_wonder_2_a4_scopes
      (scope_id,scope_key,owner_user_id,goal_hash,mission_id,allowed_device_id,status,expires_at)
    VALUES (${sqlQuote(scopeId)},${sqlQuote(scopeKey)},${sqlQuote(session.userId)},${sqlQuote(goalHash)},
      ${sqlQuote(missionId)},${sqlQuote(deviceId)},'armed',clock_timestamp()+interval '25 minutes')
    ON CONFLICT (scope_id) DO NOTHING;
  `;
  runSql(insert, true);
  const armedCheck = `
    SELECT CASE WHEN count(*)=1 THEN 'A4_SCOPE_ARMED_PASS' ELSE 'A4_SCOPE_ARMED_FAIL' END
      FROM aria_internal.mission_wonder_2_a4_scopes
     WHERE scope_id=${sqlQuote(scopeId)} AND owner_user_id=${sqlQuote(session.userId)}
       AND goal_hash=${sqlQuote(goalHash)} AND mission_id=${sqlQuote(missionId)}
       AND allowed_device_id=${sqlQuote(deviceId)} AND status='armed';
  `;
  requireMarker(runSql(armedCheck), 'A4_SCOPE_ARMED_PASS');
  scopeInserted = true;
  report.scope_armed = true;

  await page.goto(BASE + '#home', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('.topActions button.primary.desktopOnly').click();
  const goalField = page.locator('textarea[aria-label="Objetivo de la misión"]');
  await goalField.waitFor({ state: 'visible' });
  await goalField.fill(goal);

  const postResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === 'POST' && new URL(response.url()).pathname.endsWith('/api/missions');
  }, { timeout: 90000 });
  await page.getByRole('button', { name: 'Crear misión', exact: true }).click();
  const postResponse = await postResponsePromise;
  const postRequestHeaders = await postResponse.request().allHeaders();
  const requestId = String(postRequestHeaders['x-aria-request-id'] || '');
  const postBody = await postResponse.json().catch(() => null);
  report.pwa_post_seen = true;
  report.request_id = requestId;
  assert.equal(postResponse.status(), 200, 'PWA /api/missions submission was not HTTP 200');
  assert.ok(requestId, 'real PWA x-aria-request-id header missing');
  assert.equal(String(postBody?.mission_id || postBody?.mission?.mission_id || ''), missionId, 'canonical mission id did not match the armed one-shot scope');
  report.mission_id = missionId;

  const claimedOutput = runSql(`
    SELECT CASE WHEN count(*)=1 THEN 'A4_SCOPE_BOUND_PASS' ELSE 'A4_SCOPE_BOUND_FAIL' END
      FROM aria_internal.mission_wonder_2_a4_scopes
     WHERE scope_id=${sqlQuote(scopeId)} AND request_id=${sqlQuote(requestId)}
       AND status='bound' AND mission_id=${sqlQuote(missionId)};
  `);
  requireMarker(claimedOutput, 'A4_SCOPE_BOUND_PASS');

  let mission = null;
  const missionUrl = '/api/missions/' + encodeURIComponent(missionId);
  // Dispatch exactly once. Polling below is read-only and must never re-enter the runner.
  const tick = await runtimeTick(missionId);
  report.runtime_ticks.push({ attempt: 1, http_status: tick.status, status: tick.body?.status || tick.body?.error || null });
  if (tick.status !== 200 && tick.status !== 202) {
    console.error('A4_RUNTIME_TICK_FAILURE', JSON.stringify(tick));
    fail('canonical_runtime_a4_tick_http_' + tick.status);
  }
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    await page.waitForTimeout(1200);
    const readback = await pwaApi(page, session.accessToken, missionUrl);
    if (readback.status !== 200) fail('PWA mission readback HTTP ' + readback.status);
    mission = readback.body?.mission || null;
    const status = String(mission?.status || '');
    if (['succeeded','failed','blocked','cancelled','paused'].includes(status)) {
      report.mission_terminal_status = status;
      break;
    }
    await page.waitForTimeout(2500);
  }
  assert.equal(report.mission_terminal_status, 'succeeded', 'A4 mission did not reach succeeded state');
  assert.equal(Number(mission?.completed_steps), 1, 'A4 must complete exactly one step');
  assert.equal(Number(mission?.total_steps), 1, 'A4 must contain exactly one step');

  const [eventsResult, notificationResult] = await Promise.all([
    pwaApi(page, session.accessToken, missionUrl + '/events'),
    pwaApi(page, session.accessToken, '/api/meditation/notifications?limit=50'),
  ]);
  assert.equal(eventsResult.status, 200, 'PWA events readback failed');
  assert.equal(notificationResult.status, 200, 'PWA notifications readback failed');
  const events = Array.isArray(eventsResult.body?.events) ? eventsResult.body.events : [];
  const verifiedEvents = events.filter(event => event?.event_type === 'mission_verified');
  report.mission_verified_events = verifiedEvents.length;
  assert.equal(verifiedEvents.length, 1, 'exactly one mission_verified event is required');
  const notifications = Array.isArray(notificationResult.body?.notifications) ? notificationResult.body.notifications : [];
  const verifiedNotifications = notifications.filter(item =>
    item?.kind === 'mission_completed_verified' && String(item?.mission_id || '') === missionId);
  report.verified_notifications = verifiedNotifications.length;
  assert.equal(verifiedNotifications.length, 1, 'exactly one verified notification must be visible through PWA API');

  await page.waitForFunction(() => {
    const detail = document.querySelector('.detailModal');
    if (!detail) return false;
    return /complet|verific|succeeded|exitosa/i.test(String(detail.innerText || ''));
  }, null, { timeout: 45000 }).catch(() => {});
  report.pwa_detail_visible = await page.locator('.detailModal').isVisible().catch(() => false);
  assert.ok(report.pwa_detail_visible, 'PWA mission detail did not display the terminal result');

  const auditSql = `
    SELECT CASE WHEN
      (SELECT count(*) FROM aria_internal.mission_state
        WHERE mission_id=${sqlQuote(missionId)} AND goal=${sqlQuote(goal)}
          AND metadata->>'user_id'=${sqlQuote(session.userId)}
          AND metadata->>'request_id'=${sqlQuote(requestId)}
          AND metadata->>'mission_wonder_2_a4_scope_id'=${sqlQuote(scopeId)}
          AND metadata->>'mission_wonder_2_a4_readonly'='true'
          AND status='succeeded' AND completed_steps=1 AND total_steps=1
          AND lease_owner IS NULL AND lease_until IS NULL) = 1
      AND (SELECT count(*) FROM aria_internal.mission_state
        WHERE metadata->>'user_id'=${sqlQuote(session.userId)} AND metadata->>'request_id'=${sqlQuote(requestId)}) = 1
      AND (SELECT count(*) FROM aria_internal.execution_jobs WHERE mission_id=${sqlQuote(missionId)}) = 1
      AND (SELECT count(*) FROM aria_internal.execution_jobs
        WHERE mission_id=${sqlQuote(missionId)} AND device_id=${sqlQuote(deviceId)}
          AND operation='shell.execute' AND command=${sqlQuote("[DateTime]::UtcNow.ToString('o')")}
          AND status='succeeded' AND exit_code=0
          AND claimed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at IS NOT NULL
          AND lease_owner IS NULL AND lease_until IS NULL
          AND btrim(stdout) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?Z$') = 1
      AND (SELECT count(*) FROM aria_internal.mission_events
        WHERE mission_id=${sqlQuote(missionId)} AND event_type='mission_verified') = 1
      AND (SELECT count(*) FROM aria_internal.meditation_notifications n
        JOIN aria_internal.mission_events e ON e.event_id=n.source_event_id
        WHERE n.mission_id=${sqlQuote(missionId)} AND n.kind='mission_completed_verified'
          AND e.event_type='mission_verified') = 1
      AND (SELECT count(*) FROM aria_internal.mission_wonder_2_a4_scopes
        WHERE scope_id=${sqlQuote(scopeId)} AND status='completed' AND request_id=${sqlQuote(requestId)}) = 1
    THEN 'A4_FINAL_LIVE_AUDIT_PASS' ELSE 'A4_FINAL_LIVE_AUDIT_FAIL' END;
  `;
  requireMarker(runSql(auditSql), 'A4_FINAL_LIVE_AUDIT_PASS');

  const deniedPwa = await pwaApi(page, session.accessToken, '/api/missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-aria-request-id': 'a4-denied-' + RUN_ID + '-' + RUN_ATTEMPT },
    body: JSON.stringify({ goal: 'A4 global freeze negative control; must remain denied.' }),
  });
  report.global_freeze_negative_controls.pwa_mission = deniedPwa.status;
  assert.equal(deniedPwa.status, 423, 'ordinary PWA mission creation must remain frozen outside A4 scope');

  async function internalNegative(slug, body) {
    const response = await fetch(`https://${PROJECT}.supabase.co/functions/v1/${slug}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RUNTIME_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    return response.status;
  }
  report.global_freeze_negative_controls.direct = await internalNegative('aria-direct-v1', { goal: 'A4 freeze negative', metadata: {} });
  report.global_freeze_negative_controls.intake = await internalNegative('aria-mission-intake-v1', { goal: 'A4 freeze negative', metadata: {} });
  report.global_freeze_negative_controls.canonical = await internalNegative('aria-canonical-runtime-v1', { mission_id: 'mission_a4_freeze_negative_control' });
  report.global_freeze_negative_controls.runner = await internalNegative('aria-mission-runner-v22', { mission_id: 'mission_a4_freeze_negative_control' });
  for (const [gate, status] of Object.entries(report.global_freeze_negative_controls)) {
    assert.equal(status, 423, 'global freeze negative control did not return 423: ' + gate);
  }

  report.status = 'PASS';
  console.log('MISSION_WONDER_2_STEP4_A4_LIVE_E2E=PASS');
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = 'FAIL';
  report.failure = String(error?.stack || error).slice(0, 5000);
  console.error('MISSION_WONDER_2_STEP4_A4_LIVE_E2E=FAIL');
  console.error(report.failure);
  if (page) await page.screenshot({ path: path.join(ARTIFACT_DIR, 'a4-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (scopeInserted && scopeId) {
    try {
      const revoke = runSql(`SELECT aria_internal.aria_m22_a4_revoke_scope_v1(${sqlQuote(scopeId)}) AS revoked;`, true);
      requireMarker(revoke, 'true');
      const check = runSql(`SELECT CASE WHEN status='revoked' THEN 'A4_SCOPE_REVOKED_PASS' ELSE 'A4_SCOPE_REVOKED_FAIL' END FROM aria_internal.mission_wonder_2_a4_scopes WHERE scope_id=${sqlQuote(scopeId)};`);
      requireMarker(check, 'A4_SCOPE_REVOKED_PASS');
      report.scope_revoked = true;
      if (report.status === 'PASS') console.log('A4_SCOPE_REVOKED=PASS');
    } catch (error) {
      report.scope_revoked = false;
      report.failure = (report.failure || '') + '\nSCOPE_REVOKE_FAILURE=' + String(error?.message || error);
      report.status = 'FAIL';
      console.error('A4_SCOPE_REVOKED=FAIL', String(error?.message || error));
    }
  }
  if (page) await page.screenshot({ path: path.join(ARTIFACT_DIR, 'a4-final.png'), fullPage: true }).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'a4-report.json'), JSON.stringify(report, null, 2));
  if (report.status !== 'PASS') process.exitCode = 1;
}
