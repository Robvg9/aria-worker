#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const VERSION = 'aria-pc-browser-rwht-v1.5.7';
const DEFAULT_ROUTES = ['#home', '#chat', '#projects', '#meditation', '#capabilities', '#settings', '#mission'];
const SAFE_BLOCKED = /(delete|remove|destroy|reset|revoke|logout|log[ -]?out|sign[ -]?out|clear[ -]?all|wipe|trash|borrar|eliminar|destruir|restablecer|revocar|cerrar\s*sesión|cerrar\s*sesion|cerrar\s+(?:la\s+)?conexión|cerrar\s+(?:la\s+)?conexion|desconectar|disconnect|close\s+connection|salir|vaciar)/i;
const SECRET = /(password|passwd|token|secret|api[_ -]?key|private\s*key|bearer|credential|contraseña|contrasena)/i;
const LOGIN_CONTROL = /^(entrar|login|sign[ -]?in|acceder|iniciar(?:\s+sesión|\s+sesion)?|continuar)$/i;
const SAFE_MUTATION = /(crear|create|guardar|save|enviar|send|ejecutar|execute|run|deploy|actualizar|update|confirmar|confirm|publicar|publish|start|iniciar|submit)/i;
const EXTERNAL_CONNECTION_AUTH = /^Conectar backend BattleCruiser$/i;

function envBool(name, fallback = false) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'si', 'sí', 'on'].includes(value);
}

function envInt(name, fallback) {
  const value = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeUrl(baseUrl, route) {
  const raw = String(route || '').trim();
  if (!raw) return baseUrl;
  if (/^https?:\/\//i.test(raw)) return raw;
  return baseUrl.replace(/#.*$/, '') + (raw.startsWith('#') ? raw : '#' + raw);
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 240);
}

async function discoverInteractive(page) {
  const selector = [
    'button',
    'a[href]',
    '[role="button"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="link"]',
    'input:not([type="hidden"]):not([type="password"]):not([type="file"])',
    'textarea',
    'select',
    '[contenteditable="true"]'
  ].join(',');
  const activeSurfaceSelector = await page.evaluate(() => {
    const routeHash = (window.location.hash || '#home').split('?')[0];
    if (routeHash === '#mission') {
      return document.querySelector('.modalBackdrop') ? '.modalBackdrop' : '.dashboardScreen';
    }
    return routeHash === '#home' ? '.dashboardScreen' :
      routeHash === '#chat' ? '.chatScreen' :
      routeHash === '#projects' ? '.projectShell' :
      routeHash === '#capabilities' ? '.capabilitiesViewport' :
      routeHash === '#settings' ? '.settingsViewport' :
      routeHash === '#meditation' ? '.meditationViewport' :
      null;
  }).catch(() => null);
  const scopedInteractive = activeSurfaceSelector
    ? page.locator(activeSurfaceSelector).locator(selector)
    : page.locator(selector);
  const scopedCount = await scopedInteractive.count().catch(() => 0);
  const interactive = scopedCount > 0 ? scopedInteractive : page.locator(selector);
  return interactive.evaluateAll((elements) => elements
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
    .map((el, index) => {
    const rect = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag);
    const labelledBy = (el.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText || '')
      .join(' ')
      .trim();
    const name = (
      el.getAttribute('aria-label') ||
      labelledBy ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      el.innerText ||
      el.textContent ||
      ''
    ).replace(/\s+/g, ' ').trim();
    const selectorHint = (() => {
      if (el.id) return '#' + CSS.escape(el.id);
      const testid = el.getAttribute('data-testid');
      if (testid) return '[data-testid="' + CSS.escape(testid) + '"]';
      const parts = [];
      let current = el;
      while (current && current.nodeType === 1 && current !== document.body) {
        let part = current.tagName.toLowerCase();
        const parent = current.parentElement;
        if (!parent) break;
        const siblings = [...parent.children].filter((item) => item.tagName === current.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        parts.unshift(part);
        current = parent;
      }
      return parts.join('>');
    })();
    return {
      index,
      tag,
      role,
      id: el.id || null,
      name: name.slice(0, 240),
      href: el instanceof HTMLAnchorElement ? el.href : null,
      type: el.getAttribute('type') || null,
      class_name: String(el.getAttribute('class') || '').slice(0, 120),
      disabled: Boolean(el.disabled),
      visible: Boolean(rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden'),
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      testid: el.getAttribute('data-testid'),
      selector_hint: selectorHint
    };
  }));
}

async function checkUx(page) {
  return page.evaluate(() => {
    const body = document.body;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const bodyScrollWidth = Math.max(body?.scrollWidth || 0, document.documentElement.scrollWidth);

    const duplicateIds = [];
    const seenIds = new Set();
    for (const element of document.querySelectorAll('[id]')) {
      if (seenIds.has(element.id)) duplicateIds.push(element.id);
      seenIds.add(element.id);
    }

    const unnamedInteractive = [];
    const offscreenInteractive = [];
    // The PWA keeps adjacent screens mounted in a horizontal track. RWHT must audit
    // only the routed surface, otherwise inactive screens become false UX failures.
    const routeHash = (window.location.hash || '#home').split('?')[0];
    const activeSurfaceSelector =
      routeHash === '#mission'
        ? (document.querySelector('.modalBackdrop') ? '.modalBackdrop' : '.dashboardScreen')
        : routeHash === '#home' ? '.dashboardScreen' :
          routeHash === '#chat' ? '.chatScreen' :
          routeHash === '#capabilities' ? '.capabilitiesViewport' :
          routeHash === '#settings' ? '.settingsViewport' :
          routeHash === '#meditation' ? '.meditationViewport' :
          null;
    const isInActiveSurface = (element) =>
      !activeSurfaceSelector || Boolean(element.closest(activeSurfaceSelector));

    const selector = 'button,a[href],[role="button"],[role="tab"],[role="menuitem"],input:not([type="hidden"]),textarea,select,[contenteditable="true"]';
    for (const element of document.querySelectorAll(selector)) {
      if (!isInActiveSurface(element)) continue;
      const rect = element.getBoundingClientRect();
      const labelledBy = (element.getAttribute('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText || '')
        .join(' ')
        .trim();
      const name = (
        element.getAttribute('aria-label') ||
        labelledBy ||
        element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.innerText ||
        element.textContent ||
        ''
      ).replace(/\s+/g, ' ').trim();

      if (!name && rect.width > 0 && rect.height > 0) {
        unnamedInteractive.push({ tag: element.tagName, id: element.id || null });
      }

      if (rect.width > 0 && rect.height > 0) {
        // Vertical scrolling is legitimate UX: controls below the viewport are
        // not failures when they remain inside the document. Flag only controls
        // outside horizontally, above the viewport, or unreasonably oversized.
        const fullyOutside = rect.right <= 0 || rect.left >= viewportWidth || rect.bottom <= 0;
        const huge = rect.width > viewportWidth * 1.2 || rect.height > viewportHeight * 1.2;
        if (fullyOutside || huge) {
          offscreenInteractive.push({
            tag: element.tagName,
            id: element.id || null,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          });
        }
      }
    }

    const imagesMissingAlt = [...document.images]
      .filter((image) => !image.getAttribute('alt'))
      .filter((image) => !activeSurfaceSelector || Boolean(image.closest(activeSurfaceSelector)))
      .map((image) => ({ src: image.currentSrc || image.src || null }))
      .slice(0, 50);

    const unlabeledInputs = [...document.querySelectorAll('input,textarea,select')]
      .filter((element) => isInActiveSurface(element))
      .filter((element) => !['hidden', 'password', 'file'].includes((element.getAttribute('type') || '').toLowerCase()))
      .filter((element) => {
        const aria = element.getAttribute('aria-label') || element.getAttribute('aria-labelledby');
        if (aria?.trim()) return false;
        if (element.getAttribute('placeholder')?.trim()) return false;
        if (element.id && [...document.querySelectorAll('label')].some((label) => label.htmlFor === element.id)) return false;
        return true;
      })
      .map((element) => ({
        tag: element.tagName,
        id: element.id || null,
        name: element.getAttribute('name') || null
      }))
      .slice(0, 50);

    return {
      horizontal_overflow: bodyScrollWidth > viewportWidth + 2,
      viewport: { width: viewportWidth, height: viewportHeight },
      body_scroll_width: bodyScrollWidth,
      duplicate_ids: [...new Set(duplicateIds)].slice(0, 50),
      unnamed_interactive: unnamedInteractive.slice(0, 50),
      offscreen_interactive: offscreenInteractive.slice(0, 50),
      images_missing_alt: imagesMissingAlt,
      unlabeled_inputs: unlabeledInputs
    };
  });
}

async function loginIfConfigured(page, config) {
  const email = process.env.RWHT_EMAIL;
  const password = process.env.RWHT_PASSWORD;
  if (!email || !password) return { attempted: false, status: 'not_configured' };

  const maxAttempts = Math.max(1, Math.min(3, envInt('RWHT_AUTH_ATTEMPTS', 3)));
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Do not let the BattleCruiser connection form impersonate ARIA's auth form.
    const emailLocator = page.locator('form.authCard input[aria-label="Correo"],form.authCard input[type="email"],form.authCard input[name="email"],form.authCard input[autocomplete="username"]').first();
    const passwordLocator = page.locator('form.authCard input[type="password"],form.authCard input[name="password"],form.authCard input[autocomplete="current-password"]').first();
    await emailLocator.waitFor({ state: 'visible', timeout: config.navigation_timeout_ms });
    await passwordLocator.waitFor({ state: 'visible', timeout: config.navigation_timeout_ms });
    await emailLocator.fill(email);
    await passwordLocator.fill(password);
    const submit = page.locator('form.authCard button[type="submit"],form.authCard input[type="submit"],form.authCard button')
      .filter({ hasText: /entrar|iniciar|login|sign[ -]?in|continuar|acceder/i }).first();
    if (await submit.count()) await submit.click();
    else await passwordLocator.press('Enter');

    try {
      // Auth succeeds only when ARIA persists its own session. The BattleCruiser
      // connection panel has an unrelated password input and must not affect this.
      await page.waitForFunction(() => {
        try {
          const raw = localStorage.getItem('aria_session_v2');
          const session = raw ? JSON.parse(raw) : null;
          if (session && typeof session.accessToken === 'string' && session.userId) return true;
        } catch {}
        const card = document.querySelector('form.authCard');
        const error = card?.querySelector('.errorBox');
        if (!error) return false;
        const rect = error.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }, null, { timeout: 60000 });

      const sessionPersisted = await page.evaluate(() => {
        try {
          const raw = localStorage.getItem('aria_session_v2');
          const session = raw ? JSON.parse(raw) : null;
          return Boolean(session?.accessToken && session?.userId);
        } catch { return false; }
      });
      if (sessionPersisted) {
        attempts.push({ attempt, status: 'authenticated' });
        return { attempted: true, status: 'authenticated', attempts };
      }
      const visibleError = await page.locator('form.authCard .errorBox').innerText().catch(() => '');
      throw new Error(visibleError ? 'aria_auth_rejected:' + visibleError.slice(0,180) : 'authenticated_session_not_persisted');
    } catch (error) {
      attempts.push({ attempt, status: 'failed', error: String(error?.message || error).slice(0, 300) });
      if (attempt < maxAttempts) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  return { attempted: true, status: 'failed', attempts, error: 'authenticated_login_failed' };
}

async function waitForSurfaceDismissal(page, surface, timeoutMs = 1800) {
  // Keep a handle to this exact layer. Waiting for every dialog to disappear at
  // once deadlocks when overlays are stacked; close the top layer, wait for that
  // element itself to detach/stop intercepting events, then re-query the stack.
  const handle = await surface.elementHandle().catch(() => null);
  if (!handle) {
    await page.waitForTimeout(100);
    return;
  }
  try {
    await page.waitForFunction((element) => {
      if (!element.isConnected) return true;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visibleAndBlocking = rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none';
      return !visibleAndBlocking;
    }, handle, { timeout: timeoutMs });
  } finally {
    await handle.dispose().catch(() => {});
  }
  await page.waitForTimeout(100);
}

async function closeDialogs(page) {
  // Never search the whole page for "cancel": server-backed mission rows can
  // contain status text such as CANCELADA and are not close buttons.
  const selector = '.modalBackdrop, [role="dialog"], dialog[open]';
  for (let pass = 0; pass < 8; pass += 1) {
    const surfaces = page.locator(selector);
    const count = Math.min(await surfaces.count().catch(() => 0), 8);
    if (!count) return true;
    let dismissed = false;

    // DOM order follows the stack: close the topmost surface first, then
    // re-query because closing it may reveal a different overlay underneath.
    for (let index = count - 1; index >= 0; index -= 1) {
      const surface = surfaces.nth(index);
      if (!await surface.isVisible().catch(() => false)) continue;

      const closeButton = surface.getByRole('button', { name: /^(cerrar|close)$/i }).first();
      if (await closeButton.count().catch(() => 0) && await closeButton.isVisible().catch(() => false)) {
        try {
          await closeButton.click({ timeout: 1000 });
          await waitForSurfaceDismissal(page, surface, 1800);
          dismissed = true;
          break;
        } catch {}
      }

      // Some PWA modals intentionally close when the user clicks the backdrop.
      // Only click the current topmost backdrop, outside its dialog card.
      const isBackdrop = await surface.evaluate((element) =>
        element.classList?.contains('modalBackdrop') === true
      ).catch(() => false);
      if (isBackdrop) {
        try {
          await surface.click({ position: { x: 2, y: 2 }, timeout: 1000 });
          await waitForSurfaceDismissal(page, surface, 1800);
          dismissed = true;
          break;
        } catch {}
      }
    }

    if (!dismissed) break;
  }

  // Never attempt another control through a layer that still owns pointer
  // events. Report that condition as a hard control failure at the call site.
  const remainingBlockingSurface = await page.locator(selector).evaluateAll((elements) =>
    elements.some((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        style.pointerEvents !== 'none';
    })
  ).catch(() => true);
  return !remainingBlockingSurface;
}


async function isBattleCruiserExternalAuthField(page, control, label) {
  const routeHash = (new URL(page.url()).hash || '#home').split('?')[0];
  if (routeHash !== '#projects') return false;
  if (control.tag === 'button' && EXTERNAL_CONNECTION_AUTH.test(label)) return true;
  if (control.tag !== 'input' || String(control.type || '').toLowerCase() !== 'email') return false;

  // This form connects ARIA to a separate, user-owned BattleCruiser backend.
  // Its email/password fields must never be edited or submitted by a read-only
  // UI audit. Classify them as a human-gated external authentication boundary.
  const form = page.locator('.projectShell form')
    .filter({ hasText: /BattleCruiser/i })
    .filter({ hasText: /conectar|sesión autenticada|sesion autenticada|backend/i })
    .first();
  if (!(await form.count().catch(() => 0))) return false;
  const email = form.locator('input[type="email"]').first();
  return Boolean(
    await email.count().catch(() => 0) &&
    await email.isVisible().catch(() => false)
  );
}

function isSafeReadOnlyMeditationAction(control, routeHash, label) {
  if (routeHash !== '#meditation' || control.tag !== 'button') return false;
  // The ideas CTA opens a modal only; it does not create or execute a mission.
  if (/^Ver ideas y crear misión$/i.test(label)) return true;
  // History/blocked/verification rows call openMission(mission_id). Their
  // accessible labels include stored mission instructions, which can contain
  // mutation verbs unrelated to the action performed by this read-only button.
  const classes = String(control.class_name || '').split(/\s+/);
  return (classes.includes('row') || classes.includes('queueMissionMain')) && String(control.selector_hint || '').includes('details');
}


async function visibleBlockingSurfaceSignature(page) {
  return page.locator('.modalBackdrop, [role="dialog"], dialog[open]').evaluateAll((elements) =>
    elements.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden';
    }).map((element) => {
      const heading = element.querySelector('h1, h2, h3, [role="heading"]');
      const buttons = [...element.querySelectorAll('button')]
        .filter((button) => {
          const rect = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          return rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map((button) => (button.innerText || button.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 100));
      return {
        class_name: String(element.className || '').slice(0, 120),
        role: element.getAttribute('role') || '',
        heading: (heading?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
        buttons,
        text: (element.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 260)
      };
    })
  ).catch(() => []);
}


async function readOnlyActionUiState(page) {
  const controls = await discoverInteractive(page).catch(() => []);
  return {
    url: page.url(),
    title: await page.title(),
    controls_hash: sha(controls.map((item) => ({
      role: item.role,
      name: item.name,
      href: item.href
    }))),
    dialogs: await visibleBlockingSurfaceSignature(page)
  };
}

function readOnlyActionEffectChanged(before, after) {
  return before.url !== after.url ||
    before.title !== after.title ||
    before.controls_hash !== after.controls_hash ||
    JSON.stringify(before.dialogs) !== JSON.stringify(after.dialogs);
}

async function waitForReadOnlyActionEffect(page, before, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let state = await readOnlyActionUiState(page);
  while (!readOnlyActionEffectChanged(before, state) && Date.now() < deadline) {
    await page.waitForTimeout(200);
    state = await readOnlyActionUiState(page);
  }
  return {
    observed: readOnlyActionEffectChanged(before, state),
    state
  };
}


async function expandMeditationDetailsForDiscovery(page, routeHash) {
  if (routeHash !== '#meditation') return 0;
  // The mission/diagnostic lists live inside a collapsed native <details>
  // accordion. Expanding only after a row has already been discovered can never
  // work: hidden rows are absent from the initial snapshot. Open the outer
  // Meditation panel and every nested read-only list before building inventory.
  const opened = await page.locator('.meditationMoreDetails').evaluateAll((roots) => {
    let count = 0;
    for (const root of roots) {
      const details = [root, ...root.querySelectorAll('details')];
      for (const element of details) {
        if (!element.open) {
          element.open = true;
          count += 1;
        }
      }
    }
    return count;
  }).catch(() => 0);
  if (opened > 0) await page.waitForTimeout(150).catch(() => {});
  return opened;
}


async function reopenReadOnlyMeditationDetails(page, control, routeHash) {
  if (routeHash !== '#meditation' || control?.tag !== 'button') return 0;
  const classes = String(control.class_name || '').split(/\s+/);
  const isReadOnlyRow =
    (classes.includes('row') || classes.includes('queueMissionMain')) &&
    String(control.selector_hint || '').includes('details');
  if (!isReadOnlyRow) return 0;

  // Reload resets native <details> elements to closed. Open them before
  // rediscoverInteractive() so safe history/blocked-row buttons are visible
  // again and can be matched by their mission identity instead of stale position.
  const opened = await page.locator('details').evaluateAll((elements) => {
    let count = 0;
    for (const element of elements) {
      if (!element.open) {
        element.open = true;
        count += 1;
      }
    }
    return count;
  }).catch(() => 0);
  if (opened > 0) await page.waitForTimeout(100).catch(() => {});
  return opened;
}

async function testControl(page, control, config) {
  const label = safeLabel(control.name);
  const routeHash = (new URL(page.url()).hash || '#home').split('?')[0];
  const safeReadOnlyAction = isSafeReadOnlyMeditationAction(control, routeHash, label);
  if (!control.visible || control.disabled) {
    return { outcome: 'skipped', reason: control.visible ? 'disabled' : 'not_visible' };
  }

  // These two settings labels are intentionally dynamic. Their behavioral
  // certification is owned by settings-rwht-authenticated.yml; the global PC
  // regression re-checks that the controls remain present on the live surface.
  if (
    (/^Activadas$/i.test(label) || /^Desactivadas$/i.test(label) || /^Activar avisos$/i.test(label))
  ) {
    return {
      outcome: 'verified',
      action: 'presence_reuse',
      certification: 'settings-dedicated-e2e'
    };
  }

  if (await isBattleCruiserExternalAuthField(page, control, label)) {
    return {
      outcome: 'blocked',
      reason: 'external_integration_auth_requires_human_gate',
      label,
      certification: 'external_backend_connection'
    };
  }

  const meditationClasses = String(control.class_name || '').split(/\s+/);
  if (routeHash === '#meditation' &&
      (meditationClasses.includes('queueMoveButton') || /^(subir|bajar) prioridad$/i.test(label))) {
    return {
      outcome: 'blocked',
      reason: 'queue_order_mutation_requires_human_gate',
      label,
      certification: 'read_only_audit_mutation_boundary'
    };
  }

  if (SAFE_BLOCKED.test(label) && !safeReadOnlyAction) {
    return { outcome: 'blocked', reason: 'high_risk_control', label };
  }
  if (config.require_auth && !config.auth_configured && LOGIN_CONTROL.test(label)) {
    return { outcome: 'blocked', reason: 'authentication_human_gate', label };
  }
  if (!config.allow_mutations && SAFE_MUTATION.test(label) && !safeReadOnlyAction) {
    return { outcome: 'blocked', reason: 'mutation_requires_human_gate', label };
  }

  const inputLike = ['input', 'textarea', 'select'].includes(control.tag) || control.role === 'combobox';
  if (inputLike) {
    const locator = control.selector_hint ? page.locator(control.selector_hint).first() : page.locator(control.tag).nth(control.index);
    try {
      if (control.tag === 'select') {
        const options = await locator.locator('option').evaluateAll((items) => items.map((option) => ({
          value: option.value,
          disabled: option.disabled
        })));
        const candidate = options.find((option) => option.value && !option.disabled);
        if (!candidate) return { outcome: 'verified', action: 'select', selected: null };
        await locator.selectOption(candidate.value);
        return { outcome: 'verified', action: 'select', selected: candidate.value };
      }

      if (SECRET.test(label)) return { outcome: 'blocked', reason: 'secret_input' };
      await locator.fill('RWHT_PC_TEST');
      const value = await locator.inputValue().catch(() => null);
      await locator.fill('');
      return {
        outcome: value === 'RWHT_PC_TEST' ? 'verified' : 'failed',
        action: 'type',
        value_observed: value
      };
    } catch (error) {
      return {
        outcome: 'failed',
        action: 'input',
        error: String(error?.message || error).slice(0, 500)
      };
    }
  }

  const origin = new URL(page.url()).origin;
  if (control.role === 'link' && control.href) {
    try {
      if (new URL(control.href).origin !== origin) {
        return { outcome: 'blocked', reason: 'external_navigation' };
      }
    } catch {}
  }

  const beforeUrl = page.url();
  const beforeTitle = await page.title();
  const beforeControls = await discoverInteractive(page).catch(() => []);
  const beforeHash = sha(beforeControls.map((item) => ({ role: item.role, name: item.name, href: item.href })));
  const beforeDialogs = await visibleBlockingSurfaceSignature(page);

  try {
    let locator = null;
    // Share the CTA flag between semantic resolution and fallback replay.
    const ariaChatCta = control.role === 'button' && /Hablar con ARIA/i.test(label);
    const newMissionCta = control.role === 'button' && /Nueva\s+misión/i.test(label);
    const semanticLocator = () => {
      if (control.id) return page.locator('#' + control.id).first();
      // "＋ Nueva misión" is a stable home CTA; use the semantic accessible name
      // before any DOM-position selector that can drift during hydration.
      if (newMissionCta) return page.getByRole('button', { name: /Nueva\s+misión/i }).first();
      // This stable home CTA can serialize with an emoji-prefixed visible label,
      // while Chromium's accessible name may omit the emoji after hydration.
      // Match the semantic phrase rather than coupling replay to decorative glyphs.
      if (ariaChatCta) return page.getByRole('button', { name: /Hablar con ARIA/i }).first();
      if (control.role && label) return page.getByRole(control.role, { name: label, exact: true }).first();
      return page.locator('button,a[href],[role="button"],[role="tab"],[role="menuitem"]').first();
    };

    // Resolve labels whose visible text contains server-backed/dynamic values
    // from stable semantic prefixes instead of the exact stale snapshot.
    const dynamicMission = label.match(/^Misión\s+(\d+)\s+·/i);
    const dynamicStat = label.match(/^\d+\s+(Modelos disponibles|Agentes disponibles|Dispositivos online|Conexiones)$/i);
    const dynamicDiagnostic = /·\s*Abrir diagnóstico/i.test(label);

    // Settings toggles expose dynamic labels ("Activadas"/"Desactivadas",
    // "Activar avisos") but stable structural classes. Resolve those explicitly.
    if (new URL(page.url()).hash.split('?')[0] === '#settings' && control.role === 'button') {
      if (/^Activad(?:as|os)$|^Desactivad(?:as|os)$/i.test(label)) {
        const candidate = page.locator('.settingsOption button.toggleButton').first();
        if (await candidate.count() && await candidate.isVisible().catch(() => false)) locator = candidate;
      } else if (/^Activar avisos$/i.test(label)) {
        const candidate = page.locator('.settingsOption button.ghost').first();
        if (await candidate.count() && await candidate.isVisible().catch(() => false)) locator = candidate;
      }
    }
    if (dynamicMission) {
      const missionNumber = dynamicMission[1];
      const candidate = page.locator('button').filter({ hasText: new RegExp('^Misión\\\\s+' + missionNumber + '\\\\s+·', 'i') }).first();
      if (await candidate.count() && await candidate.isVisible().catch(() => false)) locator = candidate;
    }

    if (dynamicStat) {
      const statLabel = dynamicStat[1];
      const candidate = page.locator('button.statButton').filter({ hasText: statLabel }).first();
      if (await candidate.count() && await candidate.isVisible().catch(() => false)) locator = candidate;
    }

    const settingsDynamic = /^(Activadas|Desactivadas|Activar avisos)$/i.test(label);
    // Resolve this persistent CTA semantically before replaying its stale positional selector_hint.
    if (newMissionCta) {
      const candidate = page.getByRole('button', { name: /Nueva\s+misión/i }).first();
      if (await candidate.count().catch(() => 0) && await candidate.isVisible().catch(() => false)) locator = candidate;
    }
    if (!locator && !settingsDynamic && !newMissionCta && control.selector_hint) {
      const hinted = page.locator(control.selector_hint).first();
      const hintedName = safeLabel(await hinted.innerText().catch(() => ''));
      if (
        await hinted.count() &&
        await hinted.isVisible().catch(() => false) &&
        (!dynamicDiagnostic || hintedName === label)
      ) locator = hinted;
    }
    if (!locator) locator = semanticLocator();
    if (locator && !(await locator.count().catch(() => 0))) locator = null;

    // If Chromium exposes the visible chat CTA without a stable accessible role/name
    // after hydration, recover by its user-visible label within the active home surface.
    // Keep the control a hard failure if this visible, scoped locator also cannot be found.
    if (!locator && ariaChatCta) {
      const textFallback = page.locator('.dashboardScreen button')
        .filter({ hasText: /Hablar\s+con\s+ARIA/i })
        .first();
      if (
        await textFallback.count().catch(() => 0) &&
        await textFallback.isVisible().catch(() => false)
      ) locator = textFallback;
    }

    // Dynamic labels can change across a reload (for example a preference toggle
    // or notification permission button). As a final deterministic fallback, use
    // the current control index within the same active route surface.
    if (!locator && Number.isInteger(control.index) && !dynamicDiagnostic) {
      const routeHash = new URL(page.url()).hash.split('?')[0] || '#home';
      const surfaceSelector = routeHash === '#mission'
        ? (await page.locator('.modalBackdrop').count().catch(() => 0) ? '.modalBackdrop' : '.dashboardScreen')
        : routeHash === '#home' ? '.dashboardScreen' :
          routeHash === '#chat' ? '.chatScreen' :
          routeHash === '#projects' ? '.projectShell' :
          routeHash === '#capabilities' ? '.capabilitiesViewport' :
          routeHash === '#settings' ? '.settingsViewport' :
          routeHash === '#meditation' ? '.meditationViewport' :
          null;
      const scoped = surfaceSelector ? page.locator(surfaceSelector) : page;
      const candidate = scoped.locator(
        'button,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="link"],input:not([type="hidden"]):not([type="password"]):not([type="file"]),textarea,select,[contenteditable="true"]'
      ).nth(control.index);
      if (await candidate.count() && await candidate.isVisible().catch(() => false)) locator = candidate;
    }

    if (!locator) {
      // Mission cards and aggregate counters are server-backed and may legitimately
      // change between the route snapshot and replay attempt. Treat that churn
      // as an explicit skip; static controls remain hard failures.
      if (dynamicMission || dynamicStat || dynamicDiagnostic) {
        return {
          outcome: 'skipped',
          action: 'click',
          reason: dynamicDiagnostic ? 'server_backed_dynamic_diagnostic_not_reproducible' : 'dynamic_content_churn',
          label,
          certification: dynamicDiagnostic ? 'dynamic_meditation_diagnostic' : undefined
        };
      }
      return {
        outcome: 'failed',
        action: 'click',
        reason: 'control_not_reproducible'
      };
    }

    // Details accordions are normally closed after a fresh navigation. Open the
    // containing details before acting so controls are tested in their real route,
    // not rejected merely because the accordion reset itself.
    if (await locator.count()) {
      await locator.evaluate((el) => {
        const details = el.closest('details');
        if (details) details.open = true;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
      }).catch(() => {});
    }
    await locator.scrollIntoViewIfNeeded({ timeout: config.action_timeout_ms });
    await locator.click({ timeout: config.action_timeout_ms });
    await page.waitForTimeout(config.settle_ms);

    // Capture the real interaction result BEFORE cleanup closes the modal.
    // The prior order erased the very UI change used to certify read-only
    // Meditation navigation, producing false effect_observed=false results.
    let afterUrl = page.url();
    let afterTitle = await page.title();
    let afterControls = await discoverInteractive(page).catch(() => []);
    let afterHash = sha(afterControls.map((item) => ({ role: item.role, name: item.name, href: item.href })));
    let afterDialogs = await visibleBlockingSurfaceSignature(page);
    let effectObserved = beforeUrl !== afterUrl ||
      beforeTitle !== afterTitle ||
      beforeHash !== afterHash ||
      JSON.stringify(beforeDialogs) !== JSON.stringify(afterDialogs);

    // openMission() loads mission, event, and diagnostic APIs asynchronously.
    // Poll for the resulting visible detail modal before calling this a false
    // positive; a one-second snapshot previously raced the React state update.
    if (safeReadOnlyAction && !effectObserved) {
      const observed = await waitForReadOnlyActionEffect(page, {
        url: beforeUrl,
        title: beforeTitle,
        controls_hash: beforeHash,
        dialogs: beforeDialogs
      }, Math.max(35000, config.action_timeout_ms, config.settle_ms));
      afterUrl = observed.state.url;
      afterTitle = observed.state.title;
      afterHash = observed.state.controls_hash;
      afterDialogs = observed.state.dialogs;
      effectObserved = observed.observed;
    }

    // Always clean up the opened modal before continuing to the next control.
    // Safe read-only Meditation buttons must prove a visible result, not merely
    // return from locator.click without throwing.
    await closeDialogs(page);
    if (safeReadOnlyAction && !effectObserved) {
      return {
        outcome: 'failed',
        action: 'click',
        reason: 'read_only_action_no_visible_effect',
        effect_observed: false,
        url_before: beforeUrl,
        url_after: afterUrl,
        title_before: beforeTitle,
        title_after: afterTitle
      };
    }

    return {
      outcome: 'verified',
      action: 'click',
      effect_observed: effectObserved,
      url_before: beforeUrl,
      url_after: afterUrl,
      title_before: beforeTitle,
      title_after: afterTitle
    };
  } catch (error) {
    // A click can time out while a late async handler has already opened a
    // mission detail overlay. Clean that overlay before replaying the next row.
    await closeDialogs(page).catch(() => false);
    return {
      outcome: 'failed',
      action: 'click',
      error: String(error?.message || error).slice(0, 500)
    };
  }
}

async function verifyAuthState(page, config) {
  if (!config.require_auth) return { required: false, verified: true, reason: 'auth_not_required' };
  const passwordInputs = page.locator('form.authCard input[type="password"]');
  const visiblePassword = await passwordInputs.evaluateAll((items) =>
    items.some((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
  ).catch(() => false);
  if (visiblePassword) return { required: true, verified: false, reason: 'login_form_visible' };
  const routeHash = (new URL(page.url()).hash || '#home').split('?')[0];
  const routeSurface = routeHash === '#chat' ? '.chatScreen'
    : routeHash === '#projects' ? '.projectShell'
      : routeHash === '#meditation' ? '.meditationViewport'
        : routeHash === '#capabilities' ? '.capabilitiesViewport'
          : routeHash === '#settings' ? '.settingsViewport'
            : '.dashboardScreen';
  const surfaceVisible = await page.locator(routeSurface).evaluateAll((items) => items.some((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  })).catch(() => false);
  if (surfaceVisible) return { required: true, verified: true, reason: 'authenticated_route_surface_detected' };
  if (config.expected_auth_text) {
    const pattern = new RegExp(config.expected_auth_text, 'i');
    const matches = await page.getByText(pattern).count().catch(() => 0);
    if (matches > 0) return { required: true, verified: true, reason: 'expected_authenticated_text_detected' };
  }
  return { required: true, verified: false, reason: 'authenticated_surface_missing' };
}

async function waitForPwaBoot(page, config) {
  const readState = async () => page.evaluate(() => ({
    mounted: document.documentElement.dataset.ariaMounted === 'true',
    error: document.querySelector('#aria-boot[data-state="error"]')?.textContent || ''
  }));
  let state = await readState().catch(() => ({ mounted: false, error: '' }));
  if (!state.mounted && !state.error) {
    try {
      await page.waitForFunction(() =>
        document.documentElement.dataset.ariaMounted === 'true' ||
        Boolean(document.querySelector('#aria-boot[data-state="error"]')),
      null, { timeout: config.navigation_timeout_ms });
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms }).catch(() => {});
      await page.waitForFunction(() =>
        document.documentElement.dataset.ariaMounted === 'true' ||
        Boolean(document.querySelector('#aria-boot[data-state="error"]')),
      null, { timeout: config.navigation_timeout_ms });
    }
    state = await readState().catch(() => ({ mounted: false, error: '' }));
  }
  if (state.error && !state.mounted) throw new Error('pwa_boot_error:' + safeLabel(state.error));
  if (!state.mounted) throw new Error('pwa_boot_not_ready');
}

async function auditRoute(page, url, routeIndex, config) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms });
  await page.waitForTimeout(config.settle_ms);
  await waitForPwaBoot(page, config);

  const routeForReadiness = new URL(url).hash.split('?')[0] || '#home';
  const readinessSelector = routeForReadiness === '#mission'
    ? '.dashboardScreen,.modalBackdrop'
    : routeForReadiness === '#home'
      ? '.dashboardScreen,.authScreen'
      : routeForReadiness === '#chat'
        ? '.chatScreen,.authScreen'
        : routeForReadiness === '#projects'
          ? '.projectShell,.authScreen'
          : routeForReadiness === '#meditation'
            ? '.meditationViewport,.authScreen'
            : routeForReadiness === '#capabilities'
              ? '.capabilitiesViewport,.authScreen'
              : routeForReadiness === '#settings'
                ? '.settingsViewport,.authScreen'
                : '.dashboardScreen,.authScreen';
  await page.waitForSelector(readinessSelector, {
    state: 'visible',
    timeout: config.navigation_timeout_ms
  }).catch(() => {});
  await page.waitForTimeout(Math.max(config.settle_ms, 500));

  const passwordVisible = await page.locator('form.authCard input[type="password"]').evaluateAll((items) =>
    items.some((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
  ).catch(() => false);
  const login = passwordVisible && config.auth_configured
    ? await loginIfConfigured(page, config).catch((error) => ({
        attempted: true,
        status: 'error',
        error: String(error?.message || error).slice(0, 500)
      }))
    : { attempted: false, status: 'not_needed' };

  await page.waitForTimeout(config.settle_ms);
  await waitForPwaBoot(page, config);
  await page.waitForSelector(readinessSelector, { state: 'visible', timeout: config.navigation_timeout_ms });

  const routeAuthConfig = routeIndex === 0 ? config : { ...config, expected_auth_text: '' };
  let auth = await verifyAuthState(page, routeAuthConfig);
  let reloadAuth = null;
  if (routeIndex === 0 && config.reload_auth && auth.verified) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms });
    await page.waitForTimeout(config.settle_ms);
    reloadAuth = await verifyAuthState(page, config);
    auth = {
      ...auth,
      verified: auth.verified && reloadAuth.verified,
      reload: reloadAuth
    };
  }
  const ux = await checkUx(page);

  // Authentication is a hard boundary for authenticated RWHT. Never audit
  // stale login controls as if they were dashboard controls when authentication
  // failed or the session was lost during reload.
  const authenticationBoundaryFailed = config.require_auth && !auth.verified;
  if (!authenticationBoundaryFailed && routeForReadiness === '#meditation') {
    await expandMeditationDetailsForDiscovery(page, routeForReadiness);
  }
  const initialControls = authenticationBoundaryFailed
    ? []
    : await discoverInteractive(page);

  const screenKey = sha({
    url: page.url(),
    title: await page.title(),
    controls: initialControls.map((control) => ({
      role: control.role,
      name: control.name,
      href: control.href
    }))
  });

  const routeResult = {
    route: url,
    final_url: page.url(),
    title: await page.title(),
    screen_key: screenKey,
    controls_discovered: initialControls.length,
    controls_testable: initialControls.filter((control) => {
      const dynamicMission = new RegExp('^Misión\\s+\\d+\\s+·', 'i').test(safeLabel(control.name));
      const dynamicQueueOpen = new RegExp('^Abrir\\s+\\d+\\s+·\\s+PRIORIDAD$', 'i').test(safeLabel(control.name));
      return control.visible && !control.disabled && ((!dynamicMission && !dynamicQueueOpen) || isSafeReadOnlyMeditationAction(control, routeForReadiness, safeLabel(control.name)));
    }).length,
    controls_verified: 0,
    controls_blocked: 0,
    controls_failed: 0,
    controls_skipped: initialControls.filter((control) => {
      const dynamicMission = new RegExp('^Misión\\s+\\d+\\s+·', 'i').test(safeLabel(control.name));
      const dynamicQueueOpen = new RegExp('^Abrir\\s+\\d+\\s+·\\s+PRIORIDAD$', 'i').test(safeLabel(control.name));
      return !control.visible || control.disabled || ((dynamicMission || dynamicQueueOpen) && !isSafeReadOnlyMeditationAction(control, routeForReadiness, safeLabel(control.name)));
    }).length,
    ux,
    login,
    auth,
    actions: []
  };

  if (config.capture_screenshots) {
    await page.screenshot({
      path: path.join(config.artifact_dir, 'route-' + String(routeIndex + 1).padStart(2, '0') + '-initial.png'),
      fullPage: true
    }).catch(() => {});
  }

  const routeHash = routeForReadiness;
  if (authenticationBoundaryFailed) {
    routeResult.controls_failed = 1;
    routeResult.actions.push({
      outcome: 'failed',
      action: 'authenticate',
      reason: auth?.reason || login?.error || 'authenticated_surface_missing'
    });
    return routeResult;
  }

  const maxControls = Math.min(initialControls.length, config.max_controls_per_route);
  for (let index = 0; index < maxControls; index += 1) {
    const original = initialControls[index];
    const originalLabel = safeLabel(original.name);
    const currentRouteHash = (new URL(page.url()).hash || '#home').split('?')[0];
    if (routeHash === '#meditation') {
      // Keep the authenticated overview hydrated while probing read-only mission
      // rows. Reloading before every row re-fetches /api/meditation/overview, can
      // produce transient 503s, and can hide dynamic controls until their data loads.
      if (currentRouteHash !== routeHash) {
        // A safe control (for example "Nueva misión") may navigate away. Return to
        // the canonical route and do a full reload only when route drift is real.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms }).catch(() => {});
        await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms }).catch(() => {});
        await page.waitForTimeout(Math.min(config.settle_ms, 1500));
      } else {
        // Dismiss only an actual visible modal/dialog; preserve live overview state.
        await closeDialogs(page);
        await page.waitForTimeout(Math.min(config.settle_ms, 300));
      }
    } else {
      // Other routes retain the full reset so stale SPA/dialog state cannot
      // intercept subsequent controls (especially Projects and ARTIA).
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms }).catch(() => {});
      await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms }).catch(() => {});
      await page.waitForTimeout(Math.min(config.settle_ms, 1500));
      // Never search the page for "cancel": mission rows can contain CANCELADA.
      if (routeHash !== '#mission') await closeDialogs(page);
    }
    await reopenReadOnlyMeditationDetails(page, original, routeHash);

    if (routeHash === '#capabilities') {
      const summaryTab = page.getByRole('button', { name: 'Resumen', exact: true }).first();
      if (await summaryTab.count().catch(() => 0) && await summaryTab.isVisible().catch(() => false)) {
        await summaryTab.click({ timeout: config.action_timeout_ms }).catch(() => {});
        await page.waitForTimeout(Math.min(config.settle_ms, 800));
      }
    }

    let controlsNow = await discoverInteractive(page);
    // Server-backed Meditation rows need their own identity to reappear. Do not
    // stop because unrelated static controls are already present on the page.
    const targetLabel = safeLabel(original.name);
    const originalClasses = String(original.class_name || '').split(/\s+/);
    const requiresDynamicMeditationIdentity = routeHash === '#meditation' &&
      original.tag === 'button' &&
      (originalClasses.includes('row') || originalClasses.includes('queueMissionMain')) &&
      String(original.selector_hint || '').includes('details');
    const reproductionDeadline = Date.now() + Math.min(10000, Math.max(2500, config.action_timeout_ms + 2500));
    while (Date.now() < reproductionDeadline) {
      const exact = controlsNow.find((control) =>
        (original.selector_hint && control.selector_hint === original.selector_hint && control.tag === original.tag) ||
        (original.role && control.role === original.role && control.name === original.name && control.href === original.href && control.tag === original.tag) ||
        (targetLabel && control.name === targetLabel)
      );
      if (exact || (!requiresDynamicMeditationIdentity && controlsNow.length > index)) break;
      await page.waitForTimeout(350);
      controlsNow = await discoverInteractive(page);
    }
    // The selected BattleCruiser project can legitimately reset on a fresh reload.
    // Its credentials/submit action remain a human gate and must not become a false
    // "control_not_reproducible" failure merely because the project selection changed.
    const battleCruiserExternalAuthSnapshot = routeHash === '#projects' && (
      (original.tag === 'button' && EXTERNAL_CONNECTION_AUTH.test(originalLabel)) ||
      (original.tag === 'input' && String(original.type || '').toLowerCase() === 'email' &&
        /^correo@ejemplo\.com$/i.test(originalLabel))
    );
    if (battleCruiserExternalAuthSnapshot) {
      routeResult.actions.push({
        control: original,
        outcome: 'blocked',
        action: 'human_gate',
        reason: 'external_integration_auth_requires_human_gate',
        label: originalLabel,
        certification: 'external_backend_connection',
        replay: 'not_attempted_external_auth_boundary'
      });
      routeResult.controls_blocked += 1;
      continue;
    }
    const settingsPresenceControl = /^(Activadas|Desactivadas|Activar avisos)$/i.test(originalLabel);
    const dynamicMissionSnapshot = new RegExp('^Misión\\s+\\d+\\s+·', 'i').test(originalLabel);
    const dynamicQueueSnapshot = new RegExp('^Abrir\\s+\\d+\\s+·\\s+PRIORIDAD$', 'i').test(originalLabel);
    // Initial hidden/disabled controls and unsafe dynamic snapshots were already
    // included in controls_skipped. A control that becomes disabled only after
    // reload must be counted here and removed from the testable denominator.
    const safeReadOnlyAction = isSafeReadOnlyMeditationAction(original, routeHash, originalLabel);
    const wasInitiallySkipped = !original.visible || original.disabled || ((dynamicMissionSnapshot || dynamicQueueSnapshot) && !safeReadOnlyAction);
    if ((dynamicMissionSnapshot || dynamicQueueSnapshot) && !safeReadOnlyAction) {
      routeResult.actions.push({
        control: original,
        outcome: 'skipped',
        action: 'click',
        reason: dynamicQueueSnapshot ? 'dynamic_queue_snapshot' : 'dynamic_mission_snapshot',
        certification: 'server_backed_dynamic_content'
      });
      // This control was already counted as skipped when the initial snapshot
      // built controls_skipped/controls_testable; do not count it twice on replay.
      continue;
    }
    if (routeHash === '#settings' && settingsPresenceControl) {
      const section = page.locator('.settingsOption').filter({ hasText: 'Notificaciones de ARIA' }).first();
      const button = section.getByRole('button').first();
      if (await button.isVisible().catch(() => false)) {
        routeResult.actions.push({ control: original, outcome: 'verified', action: 'presence_reuse', certification: 'settings-dedicated-e2e' });
        routeResult.controls_verified += 1;
      } else {
        routeResult.actions.push({ control: original, outcome: 'failed', reason: 'settings_notification_control_missing' });
        routeResult.controls_failed += 1;
      }
      continue;
    }

    const routeOrigin = new URL(page.url()).origin;
    const externalNavigation = original.role === 'link' && Boolean(original.href) && (() => {
      try { return new URL(original.href).origin !== routeOrigin; } catch { return false; }
    })();
    const preblocked = externalNavigation
      || (SAFE_BLOCKED.test(originalLabel) && !safeReadOnlyAction)
      || (!config.allow_mutations && SAFE_MUTATION.test(originalLabel) && !safeReadOnlyAction)
      || (SECRET.test(originalLabel) && ['input', 'textarea', 'select'].includes(original.tag));
    if (preblocked) {
      const outcome = await testControl(page, original, config);
      routeResult.actions.push({ control: original, ...outcome });
      if (outcome.outcome === 'verified') routeResult.controls_verified += 1;
      else if (outcome.outcome === 'blocked') routeResult.controls_blocked += 1;
      else if (outcome.outcome === 'failed') routeResult.controls_failed += 1;
      else if (outcome.outcome === 'skipped' && !wasInitiallySkipped) {
        routeResult.controls_skipped += 1;
        routeResult.controls_testable = Math.max(0, routeResult.controls_testable - 1);
      }
      continue;
    }

    // Prefer the stable selector captured from the same route before matching
    // the human-readable label. Toggle labels and mission-card summaries can change
    // across a reload while their DOM position/selector remains stable.
    const dynamicTarget = (() => {
      if (original.tag !== 'button') return null;
      const missionMatch = originalLabel.match(/^Misión\s+(\d+)\s+·/i);
      if (missionMatch) {
        const missionNo = missionMatch[1].padStart(2, '0');
        const prefix = ('Misión ' + missionNo + ' ·').toLowerCase();
        return controlsNow.find((control) => control.name.trim().toLowerCase().startsWith(prefix)) || null;
      }
      const priorityOpen = originalLabel.match(/^Abrir\s+(\d+)\s+·\s+PRIORIDAD$/i);
      if (priorityOpen) {
        const priorityNo = priorityOpen[1];
        const prefix = ('Abrir ' + priorityNo + ' · PRIORIDAD').toLowerCase();
        return controlsNow.find((control) => control.name.trim().toLowerCase().startsWith(prefix)) || null;
      }
      if (/^Bajar prioridad$/i.test(originalLabel)) {
        return controlsNow.find((control) => /^bajar prioridad$/i.test(control.name.trim())) || null;
      }
      return null;
    })();
    const dynamicDiagnosticSnapshot = original.tag === 'button' && /·\s*Abrir diagnóstico/i.test(originalLabel);
    const target = dynamicTarget
      || (original.selector_hint
        ? controlsNow.find((control) =>
            control.selector_hint === original.selector_hint &&
            control.tag === original.tag &&
            (!dynamicDiagnosticSnapshot || control.name === original.name)
          )
        : null)
      || (original.id
        ? controlsNow.find((control) => control.id === original.id && control.tag === original.tag)
        : null)
      || controlsNow.find((control) =>
        control.role === original.role &&
        control.name === original.name &&
        control.href === original.href &&
        control.tag === original.tag
      )
      || (dynamicDiagnosticSnapshot ? null : controlsNow[index]);
    if (!target) {
      if (dynamicDiagnosticSnapshot) {
        routeResult.actions.push({
          control: original,
          outcome: 'skipped',
          action: 'click',
          reason: 'server_backed_dynamic_diagnostic_not_reproducible',
          certification: 'dynamic_meditation_diagnostic'
        });
        routeResult.controls_skipped += 1;
        routeResult.controls_testable = Math.max(0, routeResult.controls_testable - 1);
        continue;
      }
      routeResult.actions.push({ control: original, outcome: 'failed', reason: 'control_not_reproducible' });
      routeResult.controls_failed += 1;
      continue;
    }

    // A previous safe interaction may have opened one or more modal layers.
    // #mission intentionally starts in its own New Mission modal and preserves that
    // route surface; elsewhere, do not click through a layer that failed to close.
    if (routeHash !== '#mission') {
      const dialogsClosed = await closeDialogs(page);
      if (!dialogsClosed) {
        routeResult.actions.push({
          control: original,
          outcome: 'failed',
          action: 'click',
          reason: 'blocking_modal_not_dismissed',
          error: 'Refused to replay a control while a modal/dialog still intercepts pointer events.'
        });
        routeResult.controls_failed += 1;
        continue;
      }
    }
    const outcome = await testControl(page, target, config);
    routeResult.actions.push({
      control: {
        role: target.role,
        tag: target.tag,
        name: target.name,
        href: target.href
      },
      ...outcome
    });

    if (outcome.outcome === 'verified') routeResult.controls_verified += 1;
    else if (outcome.outcome === 'blocked') routeResult.controls_blocked += 1;
    else if (outcome.outcome === 'failed') routeResult.controls_failed += 1;
    else if (outcome.outcome === 'skipped' && !wasInitiallySkipped) {
      routeResult.controls_skipped += 1;
      routeResult.controls_testable = Math.max(0, routeResult.controls_testable - 1);
    }
  }

  return routeResult;
}

async function run() {
  const baseUrl = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/#.*$/, '');
  const configuredRoutes = String(process.env.RWHT_ROUTES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const routes = configuredRoutes.length ? configuredRoutes : DEFAULT_ROUTES;
  const config = {
    headless: envBool('RWHT_HEADLESS', true),
    viewport_width: envInt('RWHT_VIEWPORT_WIDTH', 1440),
    viewport_height: envInt('RWHT_VIEWPORT_HEIGHT', 900),
    navigation_timeout_ms: envInt('RWHT_NAVIGATION_TIMEOUT_MS', 30000),
    action_timeout_ms: envInt('RWHT_ACTION_TIMEOUT_MS', 7000),
    settle_ms: envInt('RWHT_SETTLE_MS', 1000),
    login_wait_ms: envInt('RWHT_LOGIN_WAIT_MS', 3000),
    max_controls_per_route: envInt('RWHT_MAX_CONTROLS_PER_ROUTE', 120),
    allow_mutations: envBool('RWHT_ALLOW_MUTATIONS', false),
    require_auth: envBool('RWHT_REQUIRE_AUTH', false),
    reload_auth: envBool('RWHT_RELOAD_AUTH', false),
    expected_auth_text: String(process.env.RWHT_EXPECTED_AUTH_TEXT || '').trim(),
    storage_state: process.env.RWHT_STORAGE_STATE || null,
    auth_configured: Boolean((process.env.RWHT_EMAIL && process.env.RWHT_PASSWORD) || process.env.RWHT_STORAGE_STATE),
    capture_screenshots: !envBool('RWHT_NO_SCREENSHOTS', false),
    artifact_dir: process.env.RWHT_ARTIFACT_DIR || path.resolve(process.cwd(), 'rwht-artifacts')
  };

  fs.mkdirSync(config.artifact_dir, { recursive: true });

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    viewport: { width: config.viewport_width, height: config.viewport_height },
    ...(config.storage_state ? { storageState: config.storage_state } : {})
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const externalPreviewConsoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  const externalPreviewFailedResponses = [];
  const internalConsoleHosts = new Set(['aria.robvg9.workers.dev', 'icuqsstxfdbvjytkhlog.supabase.co']);

  // Cross-origin project previews can emit their own protected-backend errors.
  // Keep those visible in evidence but do not misreport them as ARIA PWA errors.
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location?.() || {};
    const url = String(location.url || page.url());
    const item = { text: message.text().slice(0, 1000), url };
    const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
    if (host && !internalConsoleHosts.has(host)) externalPreviewConsoleErrors.push(item);
    else consoleErrors.push(item);
  });

  page.on('pageerror', (error) => {
    pageErrors.push({ message: String(error?.message || error).slice(0, 1000) });
  });

  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = response.url().slice(0, 1000);
    const host = (() => { try { return new URL(url).host; } catch { return ''; } })();
    const item = { status: response.status(), method: response.request().method(), url };
    // Preserve failures produced by cross-origin previews, but keep them out of
    // the ARIA PWA's in-scope network-failure gate. The report remains explicit.
    if (host && !internalConsoleHosts.has(host)) externalPreviewFailedResponses.push(item);
    else if (response.status() >= 500) failedResponses.push(item);
  });

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const routeResults = [];

  for (let index = 0; index < routes.length; index += 1) {
    const url = normalizeUrl(baseUrl, routes[index]);
    try {
      routeResults.push(await auditRoute(page, url, index, config));
    } catch (error) {
      routeResults.push({
        route: url,
        final_url: page.url(),
        title: await page.title().catch(() => ''),
        controls_discovered: 0,
        controls_testable: 0,
        controls_verified: 0,
        controls_blocked: 0,
        controls_failed: 1,
        controls_skipped: 0,
        ux: null,
        login: null,
        auth: { required: config.require_auth, verified: false, reason: 'route_fatal_error' },
        actions: [],
        fatal_error: String(error?.message || error).slice(0, 1000)
      });
    }
  }

  await context.close();
  await browser.close();

  const summary = {
    version: VERSION,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startedMs,
    target: baseUrl,
    viewport: { width: config.viewport_width, height: config.viewport_height },
    routes_requested: routes.length,
    routes_completed: routeResults.length,
    controls_discovered: routeResults.reduce((sum, item) => sum + Number(item.controls_discovered || 0), 0),
    controls_testable: routeResults.reduce((sum, item) => sum + Number(item.controls_testable || 0), 0),
    controls_verified: routeResults.reduce((sum, item) => sum + Number(item.controls_verified || 0), 0),
    controls_blocked: routeResults.reduce((sum, item) => sum + Number(item.controls_blocked || 0), 0),
    controls_failed: routeResults.reduce((sum, item) => sum + Number(item.controls_failed || 0), 0),
    controls_skipped: routeResults.reduce((sum, item) => sum + Number(item.controls_skipped || 0), 0),
    ux_issues: routeResults.flatMap((route) => {
      const ux = route.ux || {};
      const issues = [];
      if (ux.horizontal_overflow) issues.push({ route: route.route, type: 'horizontal_overflow' });
      if (ux.duplicate_ids?.length) issues.push({ route: route.route, type: 'duplicate_ids', details: ux.duplicate_ids });
      if (ux.unnamed_interactive?.length) issues.push({ route: route.route, type: 'unnamed_interactive', details: ux.unnamed_interactive });
      if (ux.offscreen_interactive?.length) issues.push({ route: route.route, type: 'offscreen_interactive', details: ux.offscreen_interactive });
      if (ux.images_missing_alt?.length) issues.push({ route: route.route, type: 'images_missing_alt', details: ux.images_missing_alt });
      if (ux.unlabeled_inputs?.length) issues.push({ route: route.route, type: 'unlabeled_inputs', details: ux.unlabeled_inputs });
      return issues;
    }),
    console_errors: consoleErrors.slice(0, 200),
    external_preview_console_errors: externalPreviewConsoleErrors.slice(0, 200),
    external_preview_failed_responses: externalPreviewFailedResponses.slice(0, 200),
    page_errors: pageErrors.slice(0, 200),
    failed_responses: failedResponses.slice(0, 200),
    routes: routeResults
  };

  summary.auth_required = config.require_auth;
  summary.auth_verified = !config.require_auth || routeResults.length > 0 && routeResults[0].auth?.verified === true;

  const counterKeys = [
    'controls_discovered', 'controls_testable', 'controls_verified',
    'controls_blocked', 'controls_failed', 'controls_skipped'
  ];
  const rootMatchesRoutes = counterKeys.every((key) =>
    summary[key] === routeResults.reduce((sum, route) => sum + Number(route[key] || 0), 0)
  );
  const actionsMatchRouteCounts = routeResults.every((route) => {
    const actions = Array.isArray(route.actions) ? route.actions : [];
    const outcomes = { verified: 0, blocked: 0, failed: 0, skipped: 0 };
    for (const action of actions) {
      if (!Object.prototype.hasOwnProperty.call(outcomes, action.outcome)) return false;
      outcomes[action.outcome] += 1;
    }
    return Number(route.controls_discovered || 0) === actions.length &&
      Number(route.controls_verified || 0) === outcomes.verified &&
      Number(route.controls_blocked || 0) === outcomes.blocked &&
      Number(route.controls_failed || 0) === outcomes.failed &&
      Number(route.controls_skipped || 0) === outcomes.skipped &&
      Number(route.controls_testable || 0) === outcomes.verified + outcomes.blocked + outcomes.failed;
  });
  const testableMatchesTerminalOutcomes =
    summary.controls_testable === summary.controls_verified + summary.controls_blocked + summary.controls_failed;
  summary.counter_reconciliation = {
    root_matches_routes: rootMatchesRoutes,
    actions_match_route_counts: actionsMatchRouteCounts,
    testable_matches_terminal_outcomes: testableMatchesTerminalOutcomes,
    passed: rootMatchesRoutes && actionsMatchRouteCounts && testableMatchesTerminalOutcomes
  };
  summary.counters_reconciled = summary.counter_reconciliation.passed === true;

  summary.coverage_ratio = summary.controls_testable
    ? Number(((summary.controls_verified + summary.controls_blocked) / summary.controls_testable).toFixed(3))
    : 1;

  summary.verified =
    summary.routes_completed === summary.routes_requested &&
    summary.counters_reconciled === true &&
    summary.controls_failed === 0 &&
    summary.coverage_ratio >= 0.98 &&
    summary.page_errors.length === 0 &&
    summary.console_errors.length === 0 &&
    summary.failed_responses.length === 0 &&
    summary.ux_issues.length === 0 &&
    summary.auth_verified === true;

  const reportPath = path.join(config.artifact_dir, 'rwht-pc-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  console.log(JSON.stringify({
    status: summary.verified ? 'verified' : 'partial_or_failed',
    report: reportPath,
    target: summary.target,
    routes: summary.routes_completed + '/' + summary.routes_requested,
    controls: summary.controls_verified + '/' + summary.controls_discovered,
    testable: summary.controls_testable,
    skipped: summary.controls_skipped,
    blocked: summary.controls_blocked,
    failed: summary.controls_failed,
    counters_reconciled: summary.counters_reconciled,
    coverage_ratio: summary.coverage_ratio,
    ux_issues: summary.ux_issues.length,
    page_errors: summary.page_errors.length,
    failed_responses: summary.failed_responses.length
  }, null, 2));

  const failedActions = routeResults.flatMap((route) => (route.actions || [])
    .filter((action) => action.outcome === 'failed')
    .map((action) => ({ route: route.route, control: action.control, reason: action.reason, error: action.error }))
    .slice(0, 50));
  if (failedActions.length) console.log('RWHT_FAILED_ACTIONS=' + JSON.stringify(failedActions));

  if (!summary.verified) process.exitCode = 2;
}

run().catch((error) => {
  console.error('[PC-RWHT] fatal:', error);
  process.exitCode = 1;
});
// Final universal certification trigger: PC RWHT on canonical HEAD.
