'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ARTIFACT_DIR = path.join(__dirname, 'rwht-artifacts');
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const url = process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/';
const email = process.env.RWHT_EMAIL || '';
const password = process.env.RWHT_PASSWORD || '';
const storageState = process.env.RWHT_STORAGE_STATE || '';

if (!email || !password) {
  throw new Error('Authenticated settings RWHT requires RWHT_EMAIL + RWHT_PASSWORD for the logout/re-login gate.');
}


const responseDiagnostics = [];
const authRequestDiagnostics = [];


const evidence = {
  version: 'aria-settings-rwht-e2e-v1.0.0',
  url,
  started_at: new Date().toISOString(),
  status: 'running',
  checks: {},
  errors: []
};
async function readPwaBootState(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    return {
      href: location.href,
      hash: location.hash,
      mounted: document.documentElement.dataset.ariaMounted === 'true',
      boot_error: document.querySelector('#aria-boot[data-state="error"]')?.textContent?.trim().slice(0, 500) || '',
      session_present: Boolean(localStorage.getItem('aria_session_v2')),
      auth_surface_visible: visible(document.querySelector('.authScreen')),
      settings_surface_visible: visible(document.querySelector('.settingsViewport')),
      dashboard_visible: visible(document.querySelector('.dashboardScreen')),
      project_visible: visible(document.querySelector('.projectShell')),
      headings: [...document.querySelectorAll('h1')].filter(visible).map(el => (el.textContent || '').trim().slice(0, 100))
    };
  });
}

async function waitForPwaBoot(page, stage) {
  try {
    await page.waitForFunction(() =>
      document.documentElement.dataset.ariaMounted === 'true' ||
      Boolean(document.querySelector('#aria-boot[data-state="error"]')),
    null, { timeout: 30000 });
  } catch (error) {
    const state = await readPwaBootState(page).catch(() => null);
    throw new Error('settings_pwa_boot_not_ready:' + stage + ':' + JSON.stringify({
      state,
      error: String(error?.message || error).slice(0, 500)
    }));
  }
  const state = await readPwaBootState(page);
  if (state.boot_error && !state.mounted) {
    throw new Error('settings_pwa_boot_error:' + stage + ':' + JSON.stringify(state));
  }
  if (!state.mounted) {
    throw new Error('settings_pwa_boot_not_mounted:' + stage + ':' + JSON.stringify(state));
  }
  return state;
}


async function login(page) {
  const authForm = page.locator('input[aria-label="Correo"],input[type="email"],input[autocomplete="username"]').first();
  const authenticatedSurface = page.locator('.dashboardScreen:visible,.projectShell:visible,.settingsViewport:visible').first();
  await Promise.race([
    authForm.waitFor({ state: 'visible', timeout: 60000 }),
    authenticatedSurface.waitFor({ state: 'visible', timeout: 60000 })
  ]).catch(() => {});

  if (await authenticatedSurface.isVisible().catch(() => false)) return;

  if (!(await authForm.isVisible().catch(() => false))) {
    throw new Error('settings_auth_surface_not_visible');
  }

  const passwordInput = page.locator('input[aria-label="Contraseña"],input[type="password"],input[autocomplete="current-password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 30000 });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await authForm.fill(email);
    await passwordInput.fill(password);
    await page.getByRole('button', { name: 'ENTRAR EN ARIA' }).click();
    try {
      await page.waitForFunction(() => {
        const pwd = [...document.querySelectorAll('input[type="password"]')].some(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const authenticatedSurface = [...document.querySelectorAll('.dashboardScreen,.projectShell,.settingsViewport')].some(el => {
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        return authenticatedSurface || !!document.querySelector('.errorBox') || !pwd;
      }, null, { timeout: 30000 });
      const authError = await page.locator('.errorBox').innerText().catch(() => '');
      if (authError) {
        throw new Error('settings_auth_ui_error:' + authError.slice(0, 300) + ':' + JSON.stringify(responseDiagnostics.slice(-6)));
      }
      return;
    } catch (error) {
      if (attempt === 3) {
        const authError = await page.locator('.errorBox').innerText().catch(() => '');
        const sessionPresent = await page.evaluate(() => Boolean(localStorage.getItem('aria_session_v2')));
        throw new Error('settings_authenticated_login_failed_after_3_attempts:' + JSON.stringify({
          visible_error: authError.slice(0, 300),
          session_present: sessionPresent,
          auth_responses: responseDiagnostics.slice(-6)
        }));
      }
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      await Promise.race([
        authForm.waitFor({ state: 'visible', timeout: 30000 }),
        authenticatedSurface.waitFor({ state: 'visible', timeout: 30000 })
      ]).catch(() => {});
      if (await authenticatedSurface.isVisible().catch(() => false)) return;
      await passwordInput.waitFor({ state: 'visible', timeout: 30000 });
    }
  }
}

async function openSettings(page) {
  await page.goto(url + '#settings', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForPwaBoot(page, 'direct_settings_navigation');
  try {
    await page.locator('.settingsViewport').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('heading', { name: 'Configuración' }).waitFor({ timeout: 10000 });
  } catch (error) {
    const state = await readPwaBootState(page).catch(() => null);
    throw new Error('settings_route_not_rendered:' + JSON.stringify({
      state,
      error: String(error?.message || error).slice(0, 700)
    }));
  }
}

function panel(page, text) {
  return page.locator('.panel').filter({ hasText: text }).first();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(storageState ? { storageState } : {});
  await context.grantPermissions(['notifications'], { origin: new URL(url).origin });
  const page = await context.newPage();

  const runtimeErrors = [];
  const pendingGenericResource400 = [];
  let consoleDiagnosticsFlushed = false;
  page.on('pageerror', e => runtimeErrors.push('pageerror: ' + e.message));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const message = msg.text();
    if (/^Failed to load resource: the server responded with a status of 400 \(\)$/.test(message)) {
      // Chromium often reports the document URL here, not the failed request URL.
      // Defer classification until matching request/response evidence is available.
      const location = msg.location();
      pendingGenericResource400.push({
        message,
        source_url: String(location?.url || page.url()),
        observed_at: Date.now()
      });
      return;
    }
    runtimeErrors.push('console: ' + message);
  });
  page.on('request', request => {
    const target = request.url();
    if (!/\/auth\/token|\/auth\/v1\/token/i.test(target)) return;
    let body = {};
    try { body = request.postDataJSON() || {}; } catch {}
    let grantType = null;
    try { grantType = new URL(target).searchParams.get('grant_type'); } catch {}
    authRequestDiagnostics.push({
      method: request.method(),
      url: target,
      observed_at: Date.now(),
      grant_type: grantType,
      has_email: typeof body.email === 'string' && Boolean(body.email.trim()),
      has_phone: typeof body.phone === 'string' && Boolean(body.phone.trim()),
      has_password: typeof body.password === 'string' && Boolean(body.password),
      has_refresh_token: typeof body.refresh_token === 'string' && Boolean(body.refresh_token)
    });
  });
  page.on('response', async response => {
    if (response.status() >= 400) {
      const target = response.url();
      const diagnostic = { status: response.status(), url: target, observed_at: Date.now() };
      if (/auth\/token/i.test(target)) {
        try {
          const body = await response.json();
          diagnostic.auth_error = body?.error || body?.error_description || body?.msg || body?.code || null;
        } catch {}
      }
      responseDiagnostics.push(diagnostic);
    }
  });


  function flushConsoleDiagnostics() {
    if (consoleDiagnosticsFlushed) return;
    consoleDiagnosticsFlushed = true;
    const expectedAuth400s = responseDiagnostics.filter(item =>
      item.status === 400 &&
      /\/(?:auth\/token|auth\/v1\/token)(?:\?|$)/i.test(item.url) &&
      /missing email or phone/i.test(String(item.auth_error || ''))
    );
    const emptyPasswordProbes = authRequestDiagnostics.filter(item =>
      item.method === 'POST' &&
      item.grant_type === 'password' &&
      item.has_password &&
      !item.has_email &&
      !item.has_phone
    );
    let matchedExpected = 0;
    for (const consoleError of pendingGenericResource400) {
      const matchIndex = expectedAuth400s.findIndex(response => {
        if (Math.abs(consoleError.observed_at - response.observed_at) > 5000) return false;
        const requestIndex = emptyPasswordProbes.findIndex(request =>
          request.observed_at <= response.observed_at + 1000 &&
          response.observed_at - request.observed_at <= 10000
        );
        if (requestIndex < 0) return false;
        emptyPasswordProbes.splice(requestIndex, 1);
        return true;
      });
      if (matchIndex >= 0) {
        expectedAuth400s.splice(matchIndex, 1);
        matchedExpected += 1;
      } else {
        runtimeErrors.push('console: ' + consoleError.message);
      }
    }
    evidence.checks.expected_auth_console_400_classification = {
      generic_400_console_events: pendingGenericResource400.length,
      matched_expected_empty_auth_probes: matchedExpected,
      unclassified_console_events: pendingGenericResource400.length - matchedExpected
    };
  }

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForPwaBoot(page, 'initial_navigation');
    await login(page);
    evidence.checks.auth_verified = true;

    await openSettings(page);
    for (const title of ['APLICACIÓN', 'INTERFAZ', 'AVISOS', 'DATOS LOCALES', 'SESIÓN']) {
      if (!(await page.locator('.panel').filter({ hasText: title }).count())) {
        throw new Error('Missing settings section: ' + title);
      }
    }
    evidence.checks.settings_surface_verified = true;

    const update = page.getByRole('button', { name: 'Actualizar app' });
    await update.click();
    await page.getByText(/ARIA ya está en la versión LIVE actual\.|Actualización encontrada\. Recargando…/).waitFor({ timeout: 10000 });
    evidence.checks.update_app_verified = true;

    const animationPanel = panel(page, 'Animaciones');
    const animationButton = animationPanel.getByRole('button').first();
    const originalAnimations = await animationButton.getAttribute('aria-pressed');
    const originalOff = await page.locator('.globalPageFrame').evaluate(el => el.classList.contains('animationsOff'));

    await animationButton.click();
    await page.waitForTimeout(100);
    const toggledAnimations = await animationButton.getAttribute('aria-pressed');
    const toggledOff = await page.locator('.globalPageFrame').evaluate(el => el.classList.contains('animationsOff'));
    const storedPrefs = await page.evaluate(() => JSON.parse(localStorage.getItem('aria_ui_preferences_v1') || 'null'));
    if (toggledAnimations === originalAnimations || toggledOff === originalOff || typeof storedPrefs?.animations !== 'boolean') {
      throw new Error('Animation setting did not change and persist in the live UI.');
    }
    evidence.checks.animations_toggle_persisted = true;

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForPwaBoot(page, 'settings_preferences_reload');
    await page.locator('.settingsViewport').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('heading', { name: 'Configuración' }).waitFor({ timeout: 10000 });
    const persistedAnimationButton = panel(page, 'Animaciones').getByRole('button').first();
    if (await persistedAnimationButton.getAttribute('aria-pressed') !== toggledAnimations) {
      throw new Error('Animation setting was lost after reload.');
    }
    if ((await page.locator('.globalPageFrame').evaluate(el => el.classList.contains('animationsOff'))) !== toggledOff) {
      throw new Error('Animation CSS state was lost after reload.');
    }
    evidence.checks.animations_reload_verified = true;

    if (await persistedAnimationButton.getAttribute('aria-pressed') !== originalAnimations) {
      await persistedAnimationButton.click();
      await page.waitForTimeout(100);
    }

    const notificationPanel = panel(page, 'Notificaciones de ARIA');
    let permission = await page.evaluate(() => ('Notification' in window ? Notification.permission : 'unsupported'));
    if (permission === 'default') {
      const activate = notificationPanel.getByRole('button', { name: 'Activar avisos' });
      if (await activate.isEnabled().catch(() => false)) {
        await activate.click();
        await page.waitForTimeout(300);
        permission = await page.evaluate(() => ('Notification' in window ? Notification.permission : 'unsupported'));
      }
    }
    const notificationText = await notificationPanel.innerText();
    const notificationStateValid =
      (permission === 'granted' && /Los avisos están permitidos\.|Activadas/.test(notificationText)) ||
      (permission === 'denied' && /Activa los avisos para recibir cambios de misiones\.|Activar avisos/.test(notificationText)) ||
      (permission === 'unsupported' && /Este dispositivo no expone notificaciones web\./.test(notificationText));
    if (!notificationStateValid) {
      throw new Error('Notification permission/state mismatch: ' + JSON.stringify({ permission, text: notificationText }));
    }
    evidence.checks.notifications_state_verified = true;
    evidence.checks.notifications_permission = permission;

    const userId = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('aria_session_v2') || 'null')?.userId || null; }
      catch { return null; }
    });
    if (!userId) throw new Error('No authenticated session persisted before cache test.');

    const probeKey = 'aria-runtime-cache-v3:' + userId + ':settings-rwht-probe';
    await page.evaluate((key) => {
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: 'probe' }));
    }, probeKey);

    const cacheReloadNavigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('button', { name: 'Borrar caché y recargar' }).click();
    await cacheReloadNavigation;
    await waitForPwaBoot(page, 'cache_clear_reload');
    await page.locator('.settingsViewport').waitFor({ state: 'visible', timeout: 30000 });
    await page.getByRole('heading', { name: 'Configuración' }).waitFor({ timeout: 10000 });
    const cacheProbe = await page.evaluate((key) => localStorage.getItem(key), probeKey);
    const sessionAfterCache = await page.evaluate(() => Boolean(localStorage.getItem('aria_session_v2')));
    if (cacheProbe !== null || !sessionAfterCache) {
      throw new Error('Cache clear did not clear runtime cache while preserving the session.');
    }
    evidence.checks.cache_clear_reload_verified = true;

    await openSettings(page);
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page.getByRole('button', { name: 'ENTRAR EN ARIA' }).waitFor({ timeout: 10000 });
    const sessionAfterLogout = await page.evaluate(() => localStorage.getItem('aria_session_v2'));
    if (sessionAfterLogout !== null) throw new Error('Session key remains after logout.');
    evidence.checks.logout_verified = true;

    await page.waitForTimeout(3000);
    await login(page);
    const sessionAfterRelogin = await page.evaluate(() => Boolean(localStorage.getItem('aria_session_v2')));
    if (!sessionAfterRelogin) throw new Error('Session was not persisted after re-login.');
    await openSettings(page);
    evidence.checks.relogin_verified = true;
    evidence.checks.error_responses_observed = responseDiagnostics.filter(x => x.status >= 400);
    evidence.checks.auth_request_diagnostics = authRequestDiagnostics.slice(-30);
    flushConsoleDiagnostics();

    const unexpectedResponses = responseDiagnostics.filter(x => x.status >= 500);
    if (unexpectedResponses.length) throw new Error('unexpected_server_errors:' + JSON.stringify(unexpectedResponses));
    if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
    evidence.checks.expected_auth_fallback_observed =
      responseDiagnostics.some(x =>
        x.status === 400 &&
        /\/(?:auth\/token|auth\/v1\/token)(?:\?|$)/i.test(x.url) &&
        /missing email or phone/i.test(String(x.auth_error || ''))
      );
    evidence.status = 'verified';
    evidence.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'settings-rwht-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    flushConsoleDiagnostics();
    evidence.status = 'failed';
    evidence.failure = error instanceof Error ? error.message : String(error);
    evidence.errors = runtimeErrors;
    evidence.checks.response_diagnostics = responseDiagnostics.slice(-40);
    evidence.checks.auth_request_diagnostics = authRequestDiagnostics.slice(-30);
    evidence.checks.final_browser_state = await readPwaBootState(page).catch(error => ({
      diagnostic_error: String(error?.message || error).slice(0, 300)
    }));
    evidence.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'settings-rwht-evidence.json'), JSON.stringify(evidence, null, 2));
    console.error(JSON.stringify(evidence, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
