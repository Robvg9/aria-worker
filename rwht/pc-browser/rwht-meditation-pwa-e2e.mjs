import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = path.resolve(process.env.RWHT_ARTIFACT_DIR || 'meditation-e2e-artifacts');
fs.mkdirSync(artifactDir, { recursive: true });
function envBool(name, fallback = false) { const value = process.env[name]; return value == null ? fallback : /^(1|true|yes)$/i.test(String(value)); }

async function waitFor(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const EMAIL = String(process.env.RWHT_EMAIL || '');
const PASSWORD = String(process.env.RWHT_PASSWORD || '');
const STORAGE_STATE = String(process.env.RWHT_STORAGE_STATE || '');
const ANON = 'sb_publishable_E2AmZNo2hAbOYlytkVbyBQ_X7JH0HPw';

async function login(page) {
  await page.waitForFunction(() => {
    const form = document.querySelector('input[type="password"]');
    const surface = document.querySelector('.projectShell,.dashboardScreen');
    return Boolean(surface) || Boolean(form);
  }, null, { timeout: 60000 }).catch(() => {});

  if (STORAGE_STATE) {
    const liveSession = await ensureLiveSession(page);
    if (liveSession) return { mode:'storage_state_refresh_or_validated', status:'authenticated', attempts:0 };
    await page.evaluate(() => localStorage.removeItem('aria_session_v2')).catch(() => {});
    await page.reload({ waitUntil:'domcontentloaded', timeout:30000 }).catch(() => {});
    await waitFor(1000);
  }

  if (!EMAIL || !PASSWORD) throw new Error('authenticated_session_source_missing_or_expired');
  const authForm = page.locator('input[aria-label="Correo"],input[type="email"],input[name="email"],input[autocomplete="username"]').first();
  const authenticatedSurface = page.locator('.projectShell,.dashboardScreen').first();
  await Promise.race([
    authForm.waitFor({ state:'visible', timeout:60000 }),
    authenticatedSurface.waitFor({ state:'visible', timeout:60000 })
  ]).catch(() => {});
  if (await authenticatedSurface.isVisible().catch(() => false)) {
    const liveSession = await ensureLiveSession(page);
    if (liveSession) return { mode:'existing_session', status:'authenticated', attempts:0 };
  }
  if (!(await authForm.isVisible().catch(() => false))) throw new Error('meditation_auth_surface_not_visible');

  const password = page.locator('input[type="password"],input[name="password"],input[autocomplete="current-password"]').first();
  await password.waitFor({ state:'visible', timeout:30000 });
  const maxAttempts = Math.max(1, Math.min(1, Number(process.env.RWHT_AUTH_ATTEMPTS || 1)));
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await authForm.fill(EMAIL);
    await password.fill(PASSWORD);
    const submit = page.locator('button[type="submit"],input[type="submit"],button')
      .filter({ hasText:/entrar|iniciar|login|sign[ -]?in|continuar|acceder/i }).first();
    if (await submit.count()) await submit.click();
    else await password.press('Enter');
    try {
      await page.waitForFunction(() => {
        const pwd = [...document.querySelectorAll('input[type="password"]')].some(el => {
          const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
        });
        return !pwd;
      }, null, { timeout:60000 });
      const session = await readSession(page);
      if (session?.accessToken && session?.userId) {
        return { mode:'password', status:'authenticated', attempts:[...attempts,{attempt,status:'authenticated'}] };
      }
      throw new Error('authenticated_session_not_persisted');
    } catch (error) {
      attempts.push({ attempt, status:'failed', error:String(error?.message || error).slice(0,300) });
      if (attempt < maxAttempts) {
        await page.reload({ waitUntil:'domcontentloaded', timeout:30000 }).catch(() => {});
        await waitFor(2000 * attempt);
      }
    }
  }
  throw new Error('authenticated_login_failed_after_' + maxAttempts + ':' + JSON.stringify(attempts).slice(0,1200));
}

async function readSession(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('aria_session_v2');
      const session = raw ? JSON.parse(raw) : null;
      return session && typeof session.accessToken === 'string' && typeof session.refreshToken === 'string'
        ? {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            userId: String(session.userId || ''),
            expiresAt: Number(session.expiresAt || 0),
            email: session.email || null
          }
        : null;
    } catch { return null; }
  });
}

async function apiAuthStatus(page, accessToken) {
  return page.evaluate(async (token) => {
    try {
      const response = await fetch('/api/diagnostics/health', {
        headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
        cache: 'no-store'
      });
      return response.status;
    } catch { return 0; }
  }, accessToken);
}

async function refreshStoredSession(page) {
  const session = await readSession(page);
  if (!session?.refreshToken) return null;
  const result = await page.evaluate(async ({ refreshToken, anon }) => {
    try {
      const response = await fetch('/auth/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: anon, accept: 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: 'no-store'
      });
      const body = await response.json().catch(() => null);
      return {
        status: response.status,
        access_token: body?.access_token || null,
        refresh_token: body?.refresh_token || null,
        user_id: body?.user?.id || null,
        expires_in: Number(body?.expires_in || 0)
      };
    } catch {
      return { status: 0, access_token: null, refresh_token: null, user_id: null, expires_in: 0 };
    }
  }, { refreshToken: session.refreshToken, anon: ANON });
  if (result.status !== 200 || !result.access_token || !result.user_id) return null;
  const next = {
    ...session,
    accessToken: result.access_token,
    refreshToken: result.refresh_token || session.refreshToken,
    userId: result.user_id,
    expiresAt: Date.now() + Math.max(60, result.expires_in || 3600) * 1000
  };
  await page.evaluate((value) => localStorage.setItem('aria_session_v2', JSON.stringify(value)), next);
  return next;
}

async function ensureLiveSession(page) {
  let session = await readSession(page);
  if (!session?.accessToken) return null;
  const status = await apiAuthStatus(page, session.accessToken);
  if (status === 200 || status === 204) return session;
  const refreshed = await refreshStoredSession(page);
  if (!refreshed) return null;
  const refreshedStatus = await apiAuthStatus(page, refreshed.accessToken);
  return refreshedStatus === 200 || refreshedStatus === 204 ? refreshed : null;
}


function runSupabaseSql(project, query) {
  const { execFileSync } = require('node:child_process');
  return execFileSync('supabase', ['db', 'query', '--linked', query], {
    env: { ...process.env, SUPABASE_PROJECT_REF: project },
    encoding: 'utf8',
    timeout: 120000
  });
}

async function registerBackgroundPush(page, token) {
  await page.context().grantPermissions(['notifications'], { origin: new URL(page.url()).origin });
  const result = await page.evaluate(async ({ token }) => {
    const statusResponse = await fetch('/api/meditation/push/status', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      cache: 'no-store'
    });
    const status = await statusResponse.json();
    if (statusResponse.status !== 200 || status.configured !== true || !status.vapid_public) {
      throw new Error('web_push_status_unavailable:' + statusResponse.status);
    }
    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) throw new Error('push_manager_unavailable');
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: Uint8Array.from(atob(status.vapid_public.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(status.vapid_public.length/4)*4,'=')), c => c.charCodeAt(0))
    });
    const json = subscription.toJSON();
    const saveResponse = await fetch('/api/meditation/push/subscribe', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        expiration_time: json.expirationTime ?? null,
        user_agent: navigator.userAgent.slice(0,512)
      })
    });
    const save = await saveResponse.json().catch(() => null);
    if (saveResponse.status !== 200) throw new Error('web_push_subscribe_failed:' + saveResponse.status);
    await caches.open('aria-push-receipts-v1').then(cache => cache.delete('/pwa/__aria-push-receipt__')).catch(() => {});
    return { endpoint: json.endpoint, active_subscriptions: save?.subscription?.active ? 1 : 0 };
  }, { token });
  return result;
}

async function triggerBackgroundPush(project, missionId, userId, notificationId) {
  const sql = `
begin;
insert into aria_internal.mission_state
  (mission_id, goal, status, current_step, total_steps, completed_steps, checkpoint, metadata, lease_owner, lease_until)
values
  ('${missionId}','RWHT background Web Push probe','succeeded',1,1,1,
   jsonb_build_object('probe',true,'plan',jsonb_build_array()),
   jsonb_build_object('user_id','${userId}','probe','background_web_push_e2e'),
   null,null)
on conflict (mission_id) do nothing;
with ev as (
  insert into aria_internal.mission_events (mission_id,event_type,payload)
  values ('${missionId}','mission_verified',jsonb_build_object('probe',true,'web_push_e2e',true))
  returning event_id
)
insert into aria_internal.meditation_notifications
  (source_event_id, mission_id, kind, severity, title, message, action, metadata)
select event_id, '${missionId}', 'mission_completed_verified', 'success',
       'Misión completada y verificada', 'RWHT background Web Push E2E', 'review_result',
       jsonb_build_object('probe',true,'web_push_e2e',true,'notification_id','${notificationId}')
from ev;
commit;
`;
  runSupabaseSql(project, sql);
}

async function readPushReceipt(page) {
  return page.evaluate(async () => {
    const cache = await caches.open('aria-push-receipts-v1');
    const response = await cache.match('/pwa/__aria-push-receipt__');
    const receipt = response ? await response.json().catch(() => null) : null;
    const registration = await navigator.serviceWorker.ready;
    const shown = await registration.getNotifications({ tag: receipt?.notification_id ? 'aria-meditation-' + receipt.notification_id : undefined });
    return {
      receipt,
      shown_notifications: shown.length,
      permission: 'Notification' in window ? Notification.permission : 'unsupported'
    };
  });
}

async function expectApi(page, apiPath, token) {
  return page.evaluate(async ({ apiPath, token }) => {
    const r = await fetch('/api' + apiPath, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  }, { apiPath, token });
}

async function run() {
  const base = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/#.*$/, '');
  const requireAuth = envBool('RWHT_REQUIRE_AUTH', true);
  void requireAuth;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: envBool('RWHT_HEADLESS', true) });
  const context = await browser.newContext({ viewport: { width: Number(process.env.RWHT_VIEWPORT_WIDTH || 1440), height: Number(process.env.RWHT_VIEWPORT_HEIGHT || 900) }, ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}) });
  let page = await context.newPage();
  const consoleErrors = []; const pageErrors = []; const failedResponses = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e?.message || e)));
  page.on('response', response => { if (response.status() >= 500) failedResponses.push({ status: response.status(), url: response.url() }); });
  const report = { status:'partial_or_failed', auth_verified:false, reload_auth_verified:false, meditation_surface_verified:false, background_push_verified:false, api_health_verified:false, idea_analyzer_verified:false, governed_proposal_verified:false, mission_conversion_verified:false, mission_persistence_verified:false, notifications_route_verified:false, cleaned_up:false, mission_id:null, proposal_id:null, page_errors:0, console_errors:0, failed_responses:0, failure:null };
  try {
    await page.goto(base + '#projects', { waitUntil:'domcontentloaded', timeout:30000 });
    await page.waitForTimeout(1200);
    const loginResult = await login(page);
    assert.equal(loginResult.status, 'authenticated');
    const persisted = await readSession(page);
    assert.ok(persisted?.accessToken && persisted?.userId, 'authenticated session was not persisted');
    report.auth_verified = true;
    await page.goto(base + '#meditation', { waitUntil:'domcontentloaded', timeout:30000 });
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => {
      const password = [...document.querySelectorAll('input[type="password"]')].some(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const surface = Boolean(document.querySelector('.projectShell,.dashboardScreen'));
      return surface || !password;
    }, null, { timeout:30000 });
    assert.equal(await page.locator('input[type="password"]:visible').count(), 0, 'meditation route must remain authenticated');
    await page.getByText('ANALIZADOR DE IDEAS', { exact:true }).waitFor({ state:'visible', timeout:30000 });
    await page.getByText('MEDITACIÓN IA', { exact:true }).waitFor({ state:'visible', timeout:30000 });
    await page.locator('.statePanel .bigStatus').waitFor({ state:'visible', timeout:30000 });
    await page.getByText('EJECUCIÓN EN TIEMPO REAL', { exact:true }).waitFor({ state:'visible', timeout:30000 });
    await page.getByRole('button', { name:'Ver ideas y crear misión' }).click();
    await page.getByRole('button', { name:'ANALIZAR Y PROPONER' }).waitFor({ state:'visible', timeout:30000 });
    report.meditation_surface_verified = true;
    const session = await readSession(page);
    assert.ok(session?.accessToken && session?.userId, 'aria session missing after login');
    const pushProbeMissionId = 'mission_webpush_e2e_' + Date.now();
    const pushProbeNotificationId = crypto.randomUUID();
    await registerBackgroundPush(page, session.accessToken);
    await page.close();
    const project = String(process.env.SUPABASE_PROJECT_REF || 'icuqsstxfdbvjytkhlog');
    await new Promise(resolve => setTimeout(resolve, 250));
    await triggerBackgroundPush(project, pushProbeMissionId, session.userId, pushProbeNotificationId);
    let pushReceipt = null;
    let probePage = await context.newPage();
    await probePage.goto(base + '#meditation', { waitUntil:'domcontentloaded', timeout:30000 });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await probePage.waitForTimeout(1000);
      pushReceipt = await readPushReceipt(probePage).catch(() => null);
      if (pushReceipt?.receipt?.notification_id === pushProbeNotificationId) break;
    }
    assert.equal(pushReceipt?.receipt?.notification_id, pushProbeNotificationId, 'background push did not reach the service worker after page close');
    assert.equal(pushReceipt?.shown_notifications, 1, 'service worker did not expose the delivered native notification');
    assert.equal(pushReceipt?.permission, 'granted', 'notification permission was not granted');

    let delivery = '';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      delivery = runSupabaseSql(project, "select status from aria_internal.meditation_push_deliveries where notification_id='" + pushProbeNotificationId + "' order by updated_at desc limit 1;");
      if (/\bsent\b/i.test(delivery)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(/\bsent\b/i.test(delivery), 'background push server delivery was not persisted as sent');
    report.background_push_verified = true;
    await probePage.close();
    page = await context.newPage();
    await page.goto(base + '#meditation', { waitUntil:'domcontentloaded', timeout:30000 });
    await page.waitForTimeout(1500);
    const [overview, health, ideas, notifications] = await Promise.all([
      expectApi(page, '/meditation/overview', session.accessToken),
      expectApi(page, '/diagnostics/health', session.accessToken),
      expectApi(page, '/meditation/ideas', session.accessToken),
      expectApi(page, '/meditation/notifications?limit=20', session.accessToken)
    ]);
    for (const [name, result] of [['overview',overview],['health',health],['ideas',ideas],['notifications',notifications]]) assert.equal(result.status,200,name+'_http_'+result.status);
    assert.ok(Array.isArray(ideas.body?.items)); assert.ok(Array.isArray(notifications.body?.notifications));
    report.api_health_verified = true; report.notifications_route_verified = true;
    const marker = 'RWHTMEDIATION' + Date.now();
    const idea = 'Certificación Meditation IA ' + marker + ': mejorar el diagnóstico operativo y preparar una ruta gobernada sin ejecutar cambios externos.';
    const analyzerInput = page.locator('.ideaAnalyzerInput').first();
    await analyzerInput.fill(idea);
    const analysisPromise = page.waitForResponse(r => r.url().includes('/api/meditation/idea-to-mission') && r.request().method()==='POST', { timeout:30000 });
    await page.getByRole('button', { name:'ANALIZAR Y PROPONER' }).click();
    const analysisResponse = await analysisPromise; assert.equal(analysisResponse.status(),200,'idea analyzer POST must return 200');
    const proposalCard = page.locator('.ideaProposalCard').filter({ hasText:marker }).first();
    await proposalCard.waitFor({ state:'visible', timeout:30000 });
    const analyzerPanel = page.locator('.ideaAnalyzerPanel').first();
    await analyzerPanel.getByText('NO AUTOENCOLADA', { exact:true }).waitFor({ state:'visible', timeout:10000 });
    await analyzerPanel.getByText('NO AUTOEJECUTA', { exact:true }).waitFor({ state:'visible', timeout:10000 });
    report.idea_analyzer_verified = true;
    const proposalResult = await expectApi(page, '/meditation/ideas', session.accessToken);
    const proposal = (proposalResult.body?.items || []).find(item => String(item?.input?.idea || '') === idea);
    assert.equal(proposalResult.status,200); assert.ok(proposal?.proposal_id,'proposal was not persisted'); assert.equal(proposal.status,'proposed');
    report.proposal_id = String(proposal.proposal_id); report.governed_proposal_verified = true;
    await proposalCard.getByRole('button', { name:'Aceptar propuesta' }).click();
    await page.waitForTimeout(700);
    const accepted = await expectApi(page, '/meditation/ideas', session.accessToken);
    const acceptedProposal = (accepted.body?.items || []).find(item => String(item?.proposal_id) === report.proposal_id);
    assert.equal(accepted.status,200); assert.equal(acceptedProposal?.status,'accepted');
    const template = acceptedProposal?.missions?.[0]; assert.ok(template?.mission_id,'accepted proposal has no mission template');
    const createButton = page.locator('.ideaProposalCard').filter({ hasText:marker }).first().getByRole('button', { name:'Crear misión' }).first();
    await createButton.waitFor({ state:'visible', timeout:30000 });
    const convertPromise = page.waitForResponse(r => r.url().includes('/api/meditation/ideas/') && r.url().endsWith('/convert') && r.request().method()==='POST', { timeout:30000 });
    await createButton.click(); const convertResponse = await convertPromise; assert.equal(convertResponse.status(),200,'idea conversion POST must return 200');
    const convertedBody = await convertResponse.json().catch(() => null); const convertedMissionId = convertedBody?.mission?.mission_id || convertedBody?.mission_id;
    assert.ok(convertedMissionId,'conversion response has no mission id'); report.mission_id = String(convertedMissionId);
    await page.getByText('MISIÓN CREADA', { exact:true }).first().waitFor({ state:'visible', timeout:30000 });
    report.mission_conversion_verified = true;
    const missionOverview = await expectApi(page, '/meditation/overview', session.accessToken);
    assert.equal(missionOverview.status,200); assert.ok((missionOverview.body?.missions || []).some(m => String(m?.mission_id) === report.mission_id),'converted mission not persisted in overview');
    report.mission_persistence_verified = true;
    await page.reload({ waitUntil:'domcontentloaded', timeout:30000 }); await page.waitForTimeout(2500);
    assert.equal(await page.locator('input[type="password"]').count(),0,'reload lost authentication');
    await page.getByText('ANALIZADOR DE IDEAS', { exact:true }).waitFor({ state:'visible', timeout:30000 });
    const reloadedProposal = page.locator('.ideaProposalCard').filter({ hasText:marker }).first();
    await reloadedProposal.waitFor({ state:'visible', timeout:30000 }); await reloadedProposal.getByText('MISIÓN CREADA', { exact:true }).first().waitFor({ state:'visible', timeout:15000 });
    report.reload_auth_verified = true;
    const missionCheck = await page.evaluate(async ({ id, token }) => { const r = await fetch('/api/missions/' + encodeURIComponent(id), { headers:{ Authorization:'Bearer '+token, Accept:'application/json' } }); return { status:r.status, body:await r.json().catch(()=>null) }; }, { id:report.mission_id, token:session.accessToken });
    assert.equal(missionCheck.status,200);
    const cleanup = await page.evaluate(async ({ id, token }) => { const r = await fetch('/api/missions/' + encodeURIComponent(id) + '/cancel', { method:'POST', headers:{ Authorization:'Bearer '+token, Accept:'application/json' } }); return { status:r.status, body:await r.json().catch(()=>null) }; }, { id:report.mission_id, token:session.accessToken });
    assert.equal(cleanup.status,200,'test mission cleanup failed'); assert.equal(cleanup.body?.cancelled,true); report.cleaned_up=true;
    report.status='verified';
  } catch (error) { report.failure=String(error?.message || error); throw error; }
  finally {
    report.page_errors=pageErrors.length; report.console_errors=consoleErrors.length; report.failed_responses=failedResponses.length;
    fs.writeFileSync(path.join(artifactDir,'rwht-meditation-pwa-report.json'), JSON.stringify(report,null,2));
    await page.screenshot({ path:path.join(artifactDir,'meditation-pwa-final.png'), fullPage:true }).catch(()=>{}); await browser.close();
  }
  if (report.page_errors || report.console_errors || report.failed_responses) throw new Error('meditation_pwa_browser_errors');
}
run().catch(error => { console.error(JSON.stringify({ status:'partial_or_failed', error:String(error?.message || error) },null,2)); process.exit(2); });
