import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const artifactDir = path.resolve(process.env.RWHT_ARTIFACT_DIR || 'meditation-e2e-artifacts');
fs.mkdirSync(artifactDir, { recursive: true });
function envBool(name, fallback = false) { const value = process.env[name]; return value == null ? fallback : /^(1|true|yes)$/i.test(String(value)); }

async function waitFor(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + '_timeout_after_' + timeoutMs + 'ms')), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/diagnostics/health', {
        headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      return response.status;
    } catch { return 0; }
    finally { clearTimeout(timer); }
  }, accessToken);
}

async function refreshStoredSession(page) {
  const session = await readSession(page);
  if (!session?.refreshToken) return null;
  const result = await page.evaluate(async ({ refreshToken, anon }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/auth/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: anon, accept: 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: 'no-store',
        signal: controller.signal
      });
      const body = await response.json().catch(() => null);
      return {
        status: response.status,
        access_token: body?.access_token || null,
        refresh_token: body?.refresh_token || null,
        user_id: body?.user?.id || null,
        expires_in: Number(body?.expires_in || 0)
      };
    } catch (error) {
      return { status: 0, access_token: null, refresh_token: null, user_id: null, expires_in: 0, error: String(error?.name || error) };
    } finally {
      clearTimeout(timer);
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


async function verifyWebPushConfig(page, token) {
  await page.context().grantPermissions(['notifications'], { origin: new URL(page.url()).origin });
  const result = await page.evaluate(async ({ token }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/meditation/push/status', {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      const body = await response.json().catch(() => null);
      if (response.status !== 200 || body?.configured !== true || !body?.vapid_public) {
        throw new Error('web_push_not_ready:' + response.status + ':' + JSON.stringify(body));
      }
      return { configured: true, has_vapid_public: true };
    } catch (error) {
      throw new Error('web_push_status_request_failed:' + String(error?.name || error?.message || error));
    } finally {
      clearTimeout(timer);
    }
  }, { token });
  return result;
}

async function deliverBackgroundPushViaCdp(controllerPage, origin, notificationId, missionId) {
  const cdp = await controllerPage.context().newCDPSession(controllerPage);
  const registrations = new Map();
  const onRegistration = (params) => {
    for (const registration of params?.registrations || []) {
      if (registration?.scopeURL) registrations.set(String(registration.scopeURL), String(registration.registrationId));
    }
  };
  cdp.on('ServiceWorker.workerRegistrationUpdated', onRegistration);
  await cdp.send('ServiceWorker.enable');

  let registrationId = [...registrations.entries()].find(([scope]) => scope.startsWith(origin + '/pwa/'))?.[1] || null;
  for (let attempt = 0; !registrationId && attempt < 10; attempt += 1) {
    await controllerPage.waitForTimeout(1000);
    registrationId = [...registrations.entries()].find(([scope]) => scope.startsWith(origin + '/pwa/'))?.[1] || null;
  }
  if (!registrationId) throw new Error('service_worker_registration_not_found');

  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin,
    registrationId,
    data: JSON.stringify({
      title: 'Misión completada y verificada',
      body: 'ARIA terminó una misión y comprobó que el resultado quedó correcto.',
      notification_id: notificationId,
      mission_id: missionId,
      url: '/pwa/#notification=' + encodeURIComponent(notificationId)
    })
  });
  return { registrationId, scope: [...registrations.entries()].find(([, id]) => id === registrationId)?.[0] || null };
}

async function readPushReceipt(page) {
  return withTimeout(page.evaluate(async () => {
    const cache = await caches.open('aria-push-receipts-v1');
    const response = await cache.match('/pwa/__aria-push-receipt__');
    const receipt = response ? await response.json().catch(() => null) : null;
    const registration = await navigator.serviceWorker.ready;
    const shown = await registration.getNotifications({
      tag: receipt?.notification_id ? 'aria-meditation-' + receipt.notification_id : undefined
    });
    return {
      receipt,
      shown_notifications: shown.length,
      permission: 'Notification' in window ? Notification.permission : 'unsupported'
    };
  }), 8000, 'read_push_receipt');
}

async function dispatchNotificationClickViaServiceWorker(context, page, notificationId) {
  const scriptUrl = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL || '';
  });
  assert.ok(scriptUrl, 'active_service_worker_script_url_missing');
  let worker = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    worker = context.serviceWorkers().find(candidate => candidate.url() === scriptUrl) || null;
    if (worker) break;
    await waitFor(250);
  }
  assert.ok(worker, 'active_service_worker_execution_context_missing');
  console.log('WEBPUSH_CLICK_WORKER_FOUND script_url=' + scriptUrl);
  const evaluation = worker.evaluate(async ({ notificationId }) => {
    const registration = self.registration;
    const tag = 'aria-meditation-' + notificationId;
    const notifications = await registration.getNotifications({ tag });
    if (notifications.length !== 1) {
      throw new Error('native_notification_not_unique_before_click:' + notifications.length);
    }
    const notification = notifications[0];
    const target = String(notification.data?.url || '');
    const expectedTarget = '/pwa/#notification=' + encodeURIComponent(notificationId);
    if (target !== expectedTarget) throw new Error('native_notification_target_mismatch:' + target);
    // Preserve the browser's native ExtendableEvent.waitUntil lifecycle. Do not
    // await client.navigate() inside this evaluation: that navigation is the action
    // under test and can outlive the service-worker evaluation context.
    const event = new ExtendableEvent('notificationclick');
    Object.defineProperty(event, 'notification', { value: notification });
    self.dispatchEvent(event);
    return {
      notification_id: notificationId,
      target,
      click_handler_dispatched: true
    };
  }, { notificationId });
  return withTimeout(evaluation, 12000, 'notification_click_worker_dispatch');
}

async function expectApi(page, apiPath, token) {
  const result = await page.evaluate(async ({ apiPath, token }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch('/api' + apiPath, {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      });
      const body = await r.json().catch(() => null);
      return { status: r.status, body, error: null };
    } catch (error) {
      return { status: 0, body: null, error: String(error?.name || error?.message || error) };
    } finally {
      clearTimeout(timer);
    }
  }, { apiPath, token });
  if (result.error) throw new Error('api_request_failed:' + apiPath + ':' + result.error);
  return result;
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
  const report = { status:'partial_or_failed', auth_verified:false, reload_auth_verified:false, meditation_surface_verified:false, background_push_verified:false, notification_click_through_verified:false, notification_detail_verified:false, notification_detail_mission_id:null, notification_detail_title:null, api_health_verified:false, idea_analyzer_verified:false, governed_proposal_verified:false, mission_conversion_verified:false, mission_persistence_verified:false, notifications_route_verified:false, cleaned_up:false, mission_id:null, proposal_id:null, page_errors:0, console_errors:0, failed_responses:0, failure:null };
  try {
    await page.goto(base + '#projects', { waitUntil:'domcontentloaded', timeout:30000 });
    await page.waitForTimeout(1200);
    const loginResult = await login(page);
    assert.equal(loginResult.status, 'authenticated');
    console.log('WEBPUSH_E2E_AUTH_OK');
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
    const backgroundPushEnabled = /^(1|true|yes)$/i.test(String(process.env.RWHT_BACKGROUND_PUSH_E2E || 'false'));
    if (backgroundPushEnabled) {
      await verifyWebPushConfig(page, session.accessToken);
      console.log('WEBPUSH_E2E_CONFIG_OK');

      // Use an actual persisted, verified mission notification instead of an invented ID.
      const notificationSource = await expectApi(page, '/meditation/notifications?limit=50', session.accessToken);
      assert.equal(notificationSource.status, 200, 'notification_source_api_http_' + notificationSource.status);
      const sourceNotifications = Array.isArray(notificationSource.body?.notifications) ? notificationSource.body.notifications : [];
      const sourceNotification = sourceNotifications
        .filter(item => item?.kind === 'mission_completed_verified' && item?.notification_id && item?.mission_id)
        .sort((a, b) => Date.parse(String(b?.created_at || '')) - Date.parse(String(a?.created_at || '')))[0];
      assert.ok(sourceNotification, 'verified_notification_for_clickthrough_not_found');
      const pushProbeNotificationId = String(sourceNotification.notification_id);
      const pushProbeMissionId = String(sourceNotification.mission_id);
      const sourceMissionResult = await expectApi(page, '/missions/' + encodeURIComponent(pushProbeMissionId), session.accessToken);
      assert.equal(sourceMissionResult.status, 200, 'notification_mission_api_http_' + sourceMissionResult.status);
      const sourceMission = sourceMissionResult.body?.mission;
      assert.equal(String(sourceMission?.status || ''), 'succeeded', 'notification_mission_is_not_succeeded');
      const sourceEventsResult = await expectApi(page, '/missions/' + encodeURIComponent(pushProbeMissionId) + '/events', session.accessToken);
      assert.equal(sourceEventsResult.status, 200, 'notification_mission_events_api_http_' + sourceEventsResult.status);
      const sourceEvents = Array.isArray(sourceEventsResult.body?.events) ? sourceEventsResult.body.events : [];
      assert.ok(sourceEvents.some(event => String(event?.event_type || '') === 'mission_verified' &&
        (event?.payload?.verified === true || String(event?.payload?.verified || '') === 'true')),
        'notification_mission_verified_evidence_missing');
      report.notification_detail_mission_id = pushProbeMissionId;
      console.log('WEBPUSH_E2E_REAL_NOTIFICATION_OK id=' + pushProbeNotificationId + ' mission=' + pushProbeMissionId);

      // Close the PWA page before the notification is delivered.
      await page.close();

      // The CDP ServiceWorker domain must be attached to the PWA origin so
      // Chrome resolves the active registration rather than an about:blank target.
      const controllerPage = await context.newPage();
      // The production HTML registers its versioned SW from the window "load"
      // handler. Wait for that lifecycle point; domcontentloaded is too early.
      await controllerPage.goto(base + '#meditation', { waitUntil:'load', timeout:30000 });
      const activeServiceWorkerUrl = await withTimeout(
        controllerPage.evaluate(async () => {
          if (!('serviceWorker' in navigator)) throw new Error('service_worker_api_unavailable');
          let registration = await navigator.serviceWorker.getRegistration('/pwa/');
          if (!registration) {
            const versionResponse = await fetch('/pwa/version.json', { cache:'no-store' });
            if (!versionResponse.ok) throw new Error('pwa_version_unavailable_' + versionResponse.status);
            const version = await versionResponse.json();
            const build = String(version?.build || '').trim();
            if (!build) throw new Error('pwa_version_build_missing');
            registration = await navigator.serviceWorker.register('/pwa/sw-' + build + '.js', { scope:'/pwa/' });
          }
          await registration.update().catch(() => undefined);
          const ready = await navigator.serviceWorker.ready;
          const active = registration.active || ready.active;
          if (!active) throw new Error('pwa_service_worker_not_active');
          return active.scriptURL;
        }),
        20000,
        'pwa_service_worker_ready_for_push_probe'
      );
      console.log('WEBPUSH_E2E_ACTIVE_SERVICE_WORKER=' + activeServiceWorkerUrl);
      const origin = String(new URL(base).origin);
      const pushDelivery = await deliverBackgroundPushViaCdp(
        controllerPage,
        origin,
        pushProbeNotificationId,
        pushProbeMissionId
      );
      report.push_delivery_registration = pushDelivery;
      await controllerPage.close();
      console.log('WEBPUSH_E2E_CONTROL_PAGE_CLOSED_BEFORE_RECEIPT');

      const probePage = await context.newPage();
      probePage.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      probePage.on('pageerror', e => pageErrors.push(String(e?.message || e)));
      probePage.on('response', response => { if (response.status() >= 500) failedResponses.push({ status: response.status(), url: response.url() }); });
      await probePage.goto(base + '#meditation', { waitUntil:'domcontentloaded', timeout:30000 });

      let pushReceipt = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await probePage.waitForTimeout(1000);
        pushReceipt = await readPushReceipt(probePage).catch(() => null);
        if (pushReceipt?.receipt?.notification_id === pushProbeNotificationId) break;
      }

      assert.equal(
        pushReceipt?.receipt?.notification_id,
        pushProbeNotificationId,
        'Service Worker did not persist the injected push receipt after the primary PWA page closed'
      );
      assert.equal(
        pushReceipt?.shown_notifications,
        1,
        'Service Worker did not expose the delivered native notification'
      );
      assert.equal(
        pushReceipt?.permission,
        'granted',
        'notification permission was not granted'
      );

      // Exercise the real Service Worker notificationclick handler against the actual
      // native notification, then prove the deep link opens the persisted mission detail.
      console.log('WEBPUSH_E2E_CLICK_DISPATCH_BEGIN id=' + pushProbeNotificationId);
      const clickResult = await dispatchNotificationClickViaServiceWorker(context, probePage, pushProbeNotificationId);
      console.log('WEBPUSH_E2E_CLICK_DISPATCH_RETURNED id=' + pushProbeNotificationId);
      assert.equal(clickResult.notification_id, pushProbeNotificationId, 'notification_click_id_mismatch');
      assert.equal(clickResult.click_handler_dispatched, true, 'notification_click_handler_not_dispatched');
      report.notification_click_target = clickResult.target;
      // A native notification click is expected to open the mission detail directly.
      // The notification panel must close first; stacked backdrops used to intercept the
      // "Abrir misión completa" button even though the mission detail was already open.
      const detailHeading = probePage.locator('.detailModal .detailTop .eyebrow');
      await detailHeading.filter({ hasText:'RESUMEN DE MISIÓN' }).waitFor({ state:'visible', timeout:30000 });
      await probePage.locator('.notificationBackdrop').waitFor({ state:'detached', timeout:15000 });
      const notificationLedger = await expectApi(probePage, '/meditation/notifications?limit=20', session.accessToken);
      assert.equal(notificationLedger.status, 200, 'notification_readback_http_' + notificationLedger.status);
      const notificationReadback = (notificationLedger.body?.notifications || []).find(item =>
        String(item?.notification_id || '') === pushProbeNotificationId
      );
      assert.ok(notificationReadback?.read_at, 'notification_click_did_not_mark_read_in_server_ledger');
      report.notification_server_read_at = notificationReadback.read_at;
      console.log('WEBPUSH_E2E_NOTIFICATION_READ_CONFIRMED id=' + pushProbeNotificationId);
      const detailTitle = (await probePage.locator('.detailModal .detailTop h2').first().innerText()).trim();
      const missionGoal = String(sourceMission?.goal || '').trim();
      const expectedGoalPreview = missionGoal.length > 110
        ? missionGoal.slice(0, 109).trimEnd() + '…'
        : missionGoal;
      const visibleGoalPreview = (await probePage.locator('.detailModal .detailTop .muted').first().innerText()).trim();
      if (!expectedGoalPreview || visibleGoalPreview !== expectedGoalPreview) {
        throw new Error('notification_clicked_wrong_mission_detail:' + JSON.stringify({
          title: detailTitle,
          visible_goal: visibleGoalPreview,
          expected_goal: expectedGoalPreview
        }));
      }
      report.notification_click_through_verified = true;
      console.log('WEBPUSH_E2E_MISSION_DETAIL_VERIFIED id=' + pushProbeMissionId + ' title=' + detailTitle);
      report.notification_detail_verified = true;
      report.notification_detail_title = detailTitle;
      report.background_push_verified = true;
      console.log('WEBPUSH_E2E_PUSH_RECEIPT_OK id=' + pushProbeNotificationId);
      report.background_push_registration_scope = pushDelivery.scope || null;

      await probePage.close();
      if (envBool('RWHT_BACKGROUND_PUSH_ONLY', false)) {
        report.status = 'verified';
        report.cleaned_up = true;
        return;
      }
      await controllerPage.close();

      // This workflow is dedicated to the closed-PWA notification path. Once the
      // Service Worker receipt and native notification are verified, stop here so
      // unrelated Meditation IA regression checks cannot mask the Web Push result.
      report.status = 'verified';
      return;
    }

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
