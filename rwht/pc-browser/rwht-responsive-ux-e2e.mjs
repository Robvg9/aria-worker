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

const VIEWPORTS = [
  { name: 'desktop-max', width: 1366, height: 768 },
  { name: 'desktop-reduced', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile-wide', width: 560, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'mobile-narrow', width: 320, height: 700 }
];

const ROUTES = [
  { hash: '#home', id: 'dashboard', ready: '.dashboardScreen' },
  { hash: '#chat', id: 'chat', ready: '.chatScreen' },
  { hash: '#projects', id: 'projects', ready: '.projectShell' },
  { hash: '#meditation', id: 'meditation', ready: '.meditationViewport' },
  { hash: '#capabilities', id: 'capabilities', ready: '.capGrid,.capHero' },
  { hash: '#settings', id: 'settings', ready: 'h1' }
];

const evidence = {
  version: 'aria-responsive-ux-rwht-e2e-v1.0.0',
  url,
  started_at: new Date().toISOString(),
  status: 'running',
  viewport_checks: [],
  navigation_checks: {},
  modal_check: {},
  keyboard_focus: {},
  errors: []
};

const responseDiagnostics = [];
const runtimeErrors = [];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function login(page) {
  const authForm = page.locator('input[aria-label="Correo"],input[type="email"],input[autocomplete="username"]').first();
  const authenticatedSurface = page.locator('.dashboardScreen,.projectShell').first();

  await Promise.race([
    authForm.waitFor({ state: 'visible', timeout: 60000 }),
    authenticatedSurface.waitFor({ state: 'visible', timeout: 60000 })
  ]).catch(() => {});

  if (await authenticatedSurface.isVisible().catch(() => false)) return;

  if (!email || !password) {
    throw new Error('responsive_ux_auth_required_but_credentials_unavailable');
  }
  if (!(await authForm.isVisible().catch(() => false))) {
    throw new Error('responsive_ux_auth_surface_not_visible');
  }

  const passwordInput = page.locator('input[aria-label="Contraseña"],input[type="password"],input[autocomplete="current-password"]').first();
  await passwordInput.waitFor({ state: 'visible', timeout: 30000 });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await authForm.fill(email);
    await passwordInput.fill(password);
    await page.getByRole('button', { name: 'ENTRAR EN ARIA' }).click();

    try {
      await Promise.race([
        authenticatedSurface.waitFor({ state: 'visible', timeout: 30000 }),
        page.locator('.errorBox').waitFor({ state: 'visible', timeout: 30000 })
      ]).catch(() => {});

      const authError = await page.locator('.errorBox').innerText().catch(() => '');
      if (authError) throw new Error('responsive_ux_auth_ui_error:' + authError.slice(0, 300));

      if (await authenticatedSurface.isVisible().catch(() => false)) return;
      throw new Error('authenticated_surface_not_visible_after_login');
        } catch (error) {
      if (attempt === 3) {
        const authError = await page.locator('.errorBox').innerText().catch(() => '');
        throw new Error('responsive_ux_authenticated_login_failed_after_3_attempts:' + JSON.stringify({
          visible_error: authError.slice(0, 300),
          auth_responses: responseDiagnostics.slice(-8)
        }));
      }
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await sleep(1500 * attempt);
      await Promise.race([
        authForm.waitFor({ state: 'visible', timeout: 30000 }),
        authenticatedSurface.waitFor({ state: 'visible', timeout: 30000 })
      ]).catch(() => {});
      if (await authenticatedSurface.isVisible().catch(() => false)) return;
      await passwordInput.waitFor({ state: 'visible', timeout: 30000 });
    }
  }
}

async function waitRouteReady(page, route) {
  if (route.id === 'capabilities') {
    await page.locator('.capGrid,.capHero,h1').first().waitFor({ timeout: 30000 });
  } else if (route.id === 'settings') {
    await page.getByRole('heading', { name: 'Configuración' }).waitFor({ timeout: 30000 });
  } else {
    await page.locator(route.ready).first().waitFor({ timeout: 45000 });
  }
  await page.waitForTimeout(350);
}

async function collectLayoutAudit(page) {
  return await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const visible = (el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0 && r.width > 0 && r.height > 0;
    };

    const excludedHorizontalOverflow = (el) =>
      el.closest('.chatWindow,.pageBodyViewport,.projectBodyViewport,.canvasWrap,.testCategoryBar,.executionStepRail,.detailModal,.notificationPanel,.detailTimeline,.screenTrack,.screenViewport') !== null;

    const horizontalOverflow = [];
    const clipping = [];
    const truncations = [];

    for (const el of document.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);

      if (!excludedHorizontalOverflow(el) && (el.scrollWidth > el.clientWidth + 2)) {
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
        const allowedEllipsis = s.textOverflow === 'ellipsis' && s.overflowX === 'hidden';
        if (!allowedEllipsis) {
          horizontalOverflow.push({
            tag: el.tagName,
            className: String(el.className || '').slice(0, 100),
            width: Math.round(el.clientWidth),
            scrollWidth: Math.round(el.scrollWidth),
            text
          });
        } else {
          truncations.push({ tag: el.tagName, className: String(el.className || '').slice(0, 100), text });
        }
      }

      const insideScreenTrack = !!el.closest('.screenTrack');
      if (!insideScreenTrack && (r.left < -2 || r.right > vw + 2)) {
        clipping.push({
          tag: el.tagName,
          className: String(el.className || '').slice(0, 100),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width)
        });
      }
    }

    const docWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
    const visibleButtons = [...document.querySelectorAll('button')].filter(visible).map(el => {
      const r = el.getBoundingClientRect();
      return {
        text: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90),
        width: Math.round(r.width),
        height: Math.round(r.height),
        left: Math.round(r.left),
        right: Math.round(r.right),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom)
      };
    });
    const smallTargets = visibleButtons.filter(b => b.width < 32 || b.height < 32);
    const clippedTargets = visibleButtons.filter(b => {
      const el = [...document.querySelectorAll('button')].find(candidate => {
        const r = candidate.getBoundingClientRect();
        return Math.round(r.left) === b.left && Math.round(r.right) === b.right && Math.round(r.top) === b.top && Math.round(r.bottom) === b.bottom &&
          ((candidate.getAttribute('aria-label') || candidate.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90)) === b.text;
      });
      const intentionalOffscreen = !!el?.closest('.screenTrack');
      const insideVerticalScroll = !!el?.closest('.pageBodyViewport,.chatWindow,.projectBodyViewport,.detailModal,.notificationPanel,.detailTimeline');
      const horizontalClipping = b.left < -1 || b.right > vw + 1;
      const verticalClipping = b.top < -1 || b.bottom > vh + 2;
      return !intentionalOffscreen && (horizontalClipping || (verticalClipping && !insideVerticalScroll));
    });
    const scrollContainers = [...document.querySelectorAll('.pageBodyViewport,.chatWindow,.projectBodyViewport,.detailModal,.notificationPanel,.detailTimeline')].filter(visible);
    const scrollableContainers = scrollContainers.filter(el => {
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4;
    }).map(el => ({
      className: String(el.className || ''),
      scrollHeight: Math.round(el.scrollHeight),
      clientHeight: Math.round(el.clientHeight)
    }));

    const desktopOnlyVisible = [...document.querySelectorAll('.desktopOnly')].filter(visible).length;
    const bottomNav = document.querySelector('.bottomNav');
    const bottomNavVisible = !!bottomNav && visible(bottomNav);
    const bottomNavButtons = bottomNav ? [...bottomNav.querySelectorAll('button')].filter(visible) : [];

    return {
      viewport: { width: vw, height: vh },
      document_width: docWidth,
      document_horizontal_overflow: docWidth > vw + 2,
      horizontal_overflow: horizontalOverflow.slice(0, 20),
      clipping: clipping.slice(0, 20),
      intentional_truncations: truncations.slice(0, 20),
      visible_buttons: visibleButtons.length,
      small_targets: smallTargets,
      clipped_targets: clippedTargets,
      scrollable_containers: scrollableContainers,
      scroll_available: scrollableContainers.length > 0,
      desktop_only_visible: desktopOnlyVisible,
      bottom_nav_visible: bottomNavVisible,
      bottom_nav_buttons: bottomNavButtons.map(b => ({
        label: b.getAttribute('aria-label'),
        width: Math.round(b.getBoundingClientRect().width),
        height: Math.round(b.getBoundingClientRect().height)
      }))
    };
  });
}

async function verifyRealScroll(page) {
  const result = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('.pageBodyViewport,.chatWindow,.projectBodyViewport,.detailModal,.notificationPanel,.detailTimeline')]
      .filter(el => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 20;
      });
    const el = candidates[0];
    if (!el) return { available: false, changed: false };
    const before = el.scrollTop;
    const max = el.scrollHeight - el.clientHeight;
    el.scrollTop = Math.min(max, Math.max(40, Math.round(max * 0.35)));
    const after = el.scrollTop;
    el.scrollTop = before;
    return {
      available: true,
      changed: after !== before,
      className: String(el.className || ''),
      before: Math.round(before),
      after: Math.round(after),
      scrollHeight: Math.round(el.scrollHeight),
      clientHeight: Math.round(el.clientHeight)
    };
  });
  if (result.available && !result.changed) {
    throw new Error('real_scroll_did_not_move:' + JSON.stringify(result));
  }
  return result;
}

async function verifyKeyboardFocus(page, viewportName) {
  const candidates = page.locator('button,input,textarea,select,[tabindex]:not([tabindex="-1"])');
  const count = await candidates.count();
  const samples = [];
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));

  for (let i = 0; i < Math.min(count, 24) && samples.length < 8; i += 1) {
    const locator = candidates.nth(i);
    const eligible = await locator.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return !el.closest('.screenTrack') &&
        s.display !== 'none' &&
        s.visibility !== 'hidden' &&
        Number(s.opacity) > 0 &&
        r.width > 0 && r.height > 0 &&
        r.left >= -1 && r.right <= window.innerWidth + 1 &&
        r.top >= -1 && r.bottom <= window.innerHeight + 2;
    }).catch(() => false);

    if (!eligible) continue;
    await locator.focus().catch(() => {});

    const state = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height)
      };
    });
    samples.push(state);
  }

  const keyboardReachable = samples.filter(Boolean).every(s =>
    s.width > 0 &&
    s.height > 0 &&
    s.x >= -1 &&
    s.x + s.width <= viewport.width + 1 &&
    s.y < viewport.height + 2
  );

  if (!keyboardReachable || samples.length === 0) {
    throw new Error('keyboard_focus_failed:' + JSON.stringify({ viewport: viewportName, samples }));
  }

  return { samples, checked: samples.length };
}

async function verifyTouchSwipe(page) {
  await page.goto(url + '#home', { waitUntil: 'domcontentloaded' });
  await waitRouteReady(page, ROUTES[0]);

  const swipe = async (fromX, toX) => {
    await page.evaluate(({ fromX, toX }) => {
      const y = Math.round(window.innerHeight * 0.45);
      const target = document.querySelector('.screenViewport') || document.body;
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', clientX: fromX, clientY: y }));
      target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'touch', clientX: toX, clientY: y }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', clientX: toX, clientY: y }));
    }, { fromX, toX });
    await page.waitForTimeout(500);
    return page.evaluate(() => location.hash);
  };

  const leftHash = await swipe(280, 90);
  if (leftHash !== '#chat') throw new Error('touch_swipe_left_navigation_failed:' + leftHash);

  const rightHash = await swipe(90, 280);
  if (rightHash !== '#home') throw new Error('touch_swipe_right_navigation_failed:' + rightHash);

  return { left_to_chat: true, right_to_home: true };
}

async function verifyMobileNavigation(page) {
  await page.goto(url + '#home', { waitUntil: 'domcontentloaded' });
  await waitRouteReady(page, ROUTES[0]);
  const nav = page.locator('.bottomNav');
  await nav.waitFor({ state: 'visible', timeout: 15000 });

  const labels = await nav.locator('button').evaluateAll(buttons =>
    buttons.map(b => b.getAttribute('aria-label')).filter(Boolean)
  );
  const expected = ['Inicio', 'Chat', 'Nueva misión', 'Proyectos', 'Meditación IA', 'Capacidades', 'Configuración'];
  if (JSON.stringify(labels) !== JSON.stringify(expected)) {
    throw new Error('bottom_navigation_contract_mismatch:' + JSON.stringify(labels));
  }

  for (const item of expected.slice(1)) {
    await nav.getByRole('button', { name: item }).click();
    await page.waitForTimeout(250);
  }

  return { labels, seven_items: labels.length === 7, traversal_verified: true };
}

async function verifyModal(page) {
  await page.goto(url + '#home', { waitUntil: 'domcontentloaded' });
  await waitRouteReady(page, ROUTES[0]);

  const open = page.getByRole('button', { name: 'Nueva misión' }).last();
  await open.click();
  const modal = page.locator('.modalBackdrop').last();
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  const rect = await modal.locator('.detailModal').first().evaluate(el => {
    const r = el.getBoundingClientRect();
    return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height };
  });
  const vw = await page.evaluate(() => innerWidth);
  const vh = await page.evaluate(() => innerHeight);
  if (rect.left < -1 || rect.right > vw + 1 || rect.top < -1 || rect.bottom > vh + 1) {
    throw new Error('modal_clipped:' + JSON.stringify({ rect, vw, vh }));
  }
  const cancel = modal.getByRole('button', { name: 'Cancelar' });
  await cancel.click();
  await modal.waitFor({ state: 'hidden', timeout: 5000 });
  return { opened: true, within_viewport: true, closed: true, rect };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const contextOptions = storageState ? { storageState } : {};
  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();
  page.on('pageerror', e => runtimeErrors.push('pageerror: ' + e.message));
  page.on('console', msg => {
    if (msg.type() === 'error') runtimeErrors.push('console: ' + msg.text());
  });
  page.on('response', response => {
    if (response.status() >= 400) responseDiagnostics.push({ status: response.status(), url: response.url() });
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await login(page);
    evidence.auth_verified = true;

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const row = { viewport: viewport.name, width: viewport.width, height: viewport.height, routes: [] };

      for (const route of ROUTES) {
        await page.goto(url + route.hash, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await waitRouteReady(page, route);

        const audit = await collectLayoutAudit(page);
        const scrollCheck = await verifyRealScroll(page);
        const keyboardCheck = await verifyKeyboardFocus(page, viewport.name + ':' + route.id);
        const globalPass = !audit.document_horizontal_overflow &&
          audit.horizontal_overflow.length === 0 &&
          audit.clipping.length === 0 &&
          audit.small_targets.length === 0 &&
          audit.clipped_targets.length === 0;

        if (!globalPass) {
          throw new Error('responsive_layout_failure:' + JSON.stringify({
            viewport,
            route: route.id,
            audit
          }));
        }

        if (viewport.width <= 700) {
          if (!audit.bottom_nav_visible || audit.bottom_nav_buttons.length !== 7 || audit.desktop_only_visible !== 0) {
            throw new Error('mobile_navigation_visibility_failure:' + JSON.stringify({ viewport, route: route.id, audit }));
          }
          for (const button of audit.bottom_nav_buttons) {
            if (button.width < 40 || button.height < 44) {
              throw new Error('mobile_navigation_target_too_small:' + JSON.stringify({ viewport, route: route.id, button }));
            }
          }
        } else if (audit.bottom_nav_visible) {
          throw new Error('desktop_bottom_nav_should_be_hidden:' + JSON.stringify({ viewport, route: route.id }));
        }

        row.routes.push({
          route: route.id,
          pass: true,
          scroll_available: audit.scroll_available,
          visible_buttons: audit.visible_buttons,
          intentional_truncations: audit.intentional_truncations.length,
          scroll_check: scrollCheck,
          keyboard_check: keyboardCheck
        });

        if (route.id === 'dashboard' || route.id === 'settings') {
          await page.screenshot({
            path: path.join(ARTIFACT_DIR, viewport.name + '-' + route.id + '.png'),
            fullPage: false
          });
        }
      }

      evidence.viewport_checks.push(row);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    evidence.navigation_checks.touch_swipe = await verifyTouchSwipe(page);
    evidence.navigation_checks.bottom_navigation = await verifyMobileNavigation(page);
    evidence.modal_check = await verifyModal(page);

    const unexpectedRuntime = runtimeErrors.filter(message =>
      !/Failed to load resource: the server responded with a status of 400 \(\)/.test(message)
    );
    if (unexpectedRuntime.length) throw new Error('unexpected_runtime_errors:' + JSON.stringify(unexpectedRuntime));

    evidence.keyboard_focus = { all_viewports_verified: true, routes_per_viewport: ROUTES.length };
    evidence.response_diagnostics = responseDiagnostics.slice(-40);
    evidence.runtime_errors = unexpectedRuntime;
    evidence.status = 'verified';
    evidence.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'responsive-ux-evidence.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    evidence.status = 'failed';
    evidence.failure = error instanceof Error ? error.message : String(error);
    evidence.response_diagnostics = responseDiagnostics.slice(-40);
    evidence.runtime_errors = runtimeErrors;
    evidence.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'responsive-ux-evidence.json'), JSON.stringify(evidence, null, 2));
    console.error(JSON.stringify(evidence, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
