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
  throw new Error('settings_rwht_requires_email_password_for_logout_relogin_gate');
}


const responseDiagnostics = [];
const authRequestDiagnostics = [];
const authProxyResponseDiagnostics = [];
const authRequestByObject = new WeakMap();


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
  // Use only the active Auth form. Document-wide selectors can resolve a stale
  // or hidden field and can race React's form transition after logout.
  const authenticatedSurface = page.locator('.dashboardScreen:visible, .projectShell:visible, .settingsViewport:visible').first();
  const authForm = page.locator('.authScreen:visible form.authCard').first();
  const authEmail = authForm.locator('input[aria-label="Correo"]');
  const passwordInput = authForm.locator('input[aria-label="Contraseña"]');
  const submitButton = authForm.locator('button.primary.wide');

  const authenticatedAndPersisted = async () => {
    const visibleSurface = await authenticatedSurface.isVisible().catch(() => false);
    const sessionPresent = await page.evaluate(() => Boolean(localStorage.getItem('aria_session_v2'))).catch(() => false);
    return visibleSurface && sessionPresent;
  };

  await Promise.race([
    authEmail.waitFor({ state: 'visible', timeout: 60000 }),
    authenticatedSurface.waitFor({ state: 'visible', timeout: 60000 })
  ]).catch(() => {});

  if (await authenticatedAndPersisted()) return;

  let lastFailure = 'auth_form_not_ready';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      // Resolve and wait again on every attempt; the form may be re-mounted
      // between logout, hash routing, hydration and a retry reload.
      await authForm.waitFor({ state: 'visible', timeout: 30000 });
      await authEmail.waitFor({ state: 'visible', timeout: 15000 });
      await passwordInput.waitFor({ state: 'visible', timeout: 15000 });
      await submitButton.waitFor({ state: 'visible', timeout: 15000 });

      await authEmail.fill(email, { timeout: 15000 });
      await passwordInput.fill(password, { timeout: 15000 });
      const submittedEmail = await authEmail.inputValue();
      const submittedPassword = await passwordInput.inputValue();
      if (submittedEmail.trim() !== email.trim() || submittedPassword !== password) {
        throw new Error('settings_auth_submit_input_mismatch:' + JSON.stringify({
          attempt,
          email_present: Boolean(submittedEmail.trim()),
          email_matches_config: submittedEmail.trim() === email.trim(),
          password_present: Boolean(submittedPassword),
          password_matches_config: submittedPassword === password
        }));
      }

      // Verify controlled input state in the active form before submitting.
      await page.waitForFunction(() => {
        const form = document.querySelector('.authScreen form.authCard');
        const emailField = form?.querySelector('input[aria-label="Correo"]');
        const passwordField = form?.querySelector('input[aria-label="Contraseña"]');
        const visible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        return visible(form) && visible(emailField) && visible(passwordField) &&
          Boolean(emailField.value?.trim()) && Boolean(passwordField.value);
      }, null, { timeout: 5000 });

      await submitButton.click({ timeout: 15000 });
      await page.waitForFunction(() => {
        const visible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const authenticated = visible(document.querySelector('.dashboardScreen')) ||
          visible(document.querySelector('.projectShell'));
        const authError = visible(document.querySelector('.authScreen .errorBox'));
        const session = Boolean(localStorage.getItem('aria_session_v2'));
        return (authenticated && session) || authError;
      }, null, { timeout: 30000 });

      const authError = await page.locator('.authScreen:visible .errorBox').innerText().catch(() => '');
      if (authError) throw new Error('settings_auth_ui_error:' + authError.slice(0, 300));
      if (await authenticatedAndPersisted()) return;
      throw new Error('settings_login_did_not_establish_persisted_session');
    } catch (error) {
      const message = String(error?.message || error);
      lastFailure = message.startsWith('settings_auth_submit_input_mismatch') ? 'input_mismatch' :
        message.startsWith('settings_auth_ui_error') ? 'auth_ui_error' :
        /Timeout|timeout/i.test(message) ? 'locator_or_transition_timeout' :
        message.startsWith('settings_login_did_not_establish') ? 'session_not_established' : 'login_attempt_error';

      if (await authenticatedAndPersisted()) return;
      if (attempt === 3) {
        const authError = await page.locator('.authScreen:visible .errorBox').innerText().catch(() => '');
        const bootState = await readPwaBootState(page).catch(() => null);
        throw new Error('settings_authenticated_login_failed_after_3_attempts:' + JSON.stringify({
          last_failure: lastFailure,
          visible_error_present: Boolean(authError),
          session_present: Boolean(bootState?.session_present),
          auth_surface_visible: Boolean(bootState?.auth_surface_visible),
          auth_responses: responseDiagnostics.slice(-6)
        }));
      }

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await waitForPwaBoot(page, 'login_retry_' + attempt).catch(() => {});
      if (await authenticatedAndPersisted()) return;
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
    const diagnostic = {
      method: request.method(),
      url: target,
      observed_at: Date.now(),
      grant_type: grantType,
      has_email: typeof body.email === 'string' && Boolean(body.email.trim()),
      has_phone: typeof body.phone === 'string' && Boolean(body.phone.trim()),
      has_password: typeof body.password === 'string' && Boolean(body.password),
      has_refresh_token: typeof body.refresh_token === 'string' && Boolean(body.refresh_token)
    };
    authRequestDiagnostics.push(diagnostic);
    authRequestByObject.set(request, diagnostic);
  });
  page.on('response', async response => {
    const target = response.url();
    const authRequest = authRequestByObject.get(response.request());
    if (authRequest && /\/auth\/token|\/auth\/v1\/token/i.test(target)) {
      const headers = response.headers();
      let route = 'unknown';
      try {
        const parsed = new URL(target);
        if (parsed.pathname === '/auth/token') route = 'worker_proxy';
        else if (parsed.pathname === '/auth/v1/token') route = 'supabase_direct';
      } catch {}
      authProxyResponseDiagnostics.push({
        status: response.status(),
        route,
        grant_type: authRequest.grant_type,
        method: authRequest.method,
        has_email: authRequest.has_email,
        has_phone: authRequest.has_phone,
        has_password: authRequest.has_password,
        retry_count: Number(headers['x-aria-auth-retry-count'] || 0) || 0
      });
    }
    if (response.status() >= 400) {
      const diagnostic = { status: response.status(), url: target, observed_at: Date.now() };
      if (authRequest) {
        diagnostic.auth_request = {
          method: authRequest.method,
          grant_type: authRequest.grant_type,
          has_email: authRequest.has_email,
          has_phone: authRequest.has_phone,
          has_password: authRequest.has_password,
          has_refresh_token: authRequest.has_refresh_token
        };
      }
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
    const auth400Responses = responseDiagnostics.filter(item =>
      item.status === 400 &&
      /\/(?:auth\/token|auth\/v1\/token)(?:\?|$)/i.test(item.url)
    );
    let correlatedAuth400s = 0;
    let missingIdentityAuthSubmissions = 0;
    let unclassifiedConsoleEvents = 0;
    for (const consoleError of pendingGenericResource400) {
      const matchIndex = auth400Responses.findIndex(response =>
        Math.abs(consoleError.observed_at - response.observed_at) <= 5000
      );
      if (matchIndex < 0) {
        unclassifiedConsoleEvents += 1;
        runtimeErrors.push('console: ' + consoleError.message);
        continue;
      }

      const [response] = auth400Responses.splice(matchIndex, 1);
      correlatedAuth400s += 1;
      const request = response.auth_request;
      if (
        request &&
        request.method === 'POST' &&
        request.grant_type === 'password' &&
        (!request.has_email && !request.has_phone)
      ) {
        missingIdentityAuthSubmissions += 1;
        runtimeErrors.push('auth: password-grant submitted without required email or phone');
      } else {
        // Correlation explains the generic Chromium console line; it does not
        // turn an HTTP 400 into success or suppress an unexpected error.
        runtimeErrors.push('console: HTTP 400 from Auth endpoint');
      }
    }
    evidence.checks.auth_console_400_correlation = {
      generic_400_console_events: pendingGenericResource400.length,
      correlated_auth_400_responses: correlatedAuth400s,
      missing_identity_auth_submissions: missingIdentityAuthSubmissions,
      unclassified_console_events: unclassifiedConsoleEvents
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
    evidence.checks.auth_proxy_response_diagnostics = authProxyResponseDiagnostics.slice(-30);
    flushConsoleDiagnostics();

    const auth400Responses = responseDiagnostics.filter(x =>
      x.status === 400 && /\/(?:auth\/token|auth\/v1\/token)(?:\?|$)/i.test(x.url)
    );
    if (auth400Responses.length) {
      throw new Error('unexpected_auth_http_400:' + JSON.stringify(auth400Responses));
    }
    const unexpectedResponses = responseDiagnostics.filter(x => x.status >= 500);
    if (unexpectedResponses.length) throw new Error('unexpected_server_errors:' + JSON.stringify(unexpectedResponses));
    if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
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
