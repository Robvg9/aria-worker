#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const VERSION = 'aria-pc-browser-rwht-v1.3.0';
const DEFAULT_ROUTES = ['#home', '#chat', '#projects', '#meditation', '#capabilities', '#settings', '#mission'];
const SAFE_BLOCKED = /(delete|remove|destroy|reset|revoke|logout|log[ -]?out|sign[ -]?out|clear[ -]?all|wipe|trash|borrar|eliminar|destruir|restablecer|revocar|cerrar\s*sesión|cerrar\s*sesion|salir|vaciar)/i;
const SECRET = /(password|passwd|token|secret|api[_ -]?key|private\s*key|bearer|credential|contraseña|contrasena)/i;
const LOGIN_CONTROL = /^(entrar|login|sign[ -]?in|acceder|iniciar(?:\s+sesión|\s+sesion)?|continuar)$/i;
const SAFE_MUTATION = /(crear|create|guardar|save|enviar|send|ejecutar|execute|run|deploy|actualizar|update|confirmar|confirm|publicar|publish|start|iniciar|submit)/i;

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
  const interactive = activeSurfaceSelector
    ? page.locator(activeSurfaceSelector).locator(selector)
    : page.locator(selector);
  return interactive.evaluateAll((elements) => elements.map((el, index) => {
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
  if (config.storage_state) return { attempted: false, status: 'storage_state' };
  const email = process.env.RWHT_EMAIL;
  const password = process.env.RWHT_PASSWORD;
  if (!email || !password) return { attempted: false, status: 'not_configured' };

  const maxAttempts = Math.max(1, Math.min(3, envInt('RWHT_AUTH_ATTEMPTS', 3)));
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const emailLocator = page.locator('input[type="email"],input[name="email"],input[autocomplete="username"]').first();
    const passwordLocator = page.locator('input[type="password"],input[name="password"],input[autocomplete="current-password"]').first();
    await emailLocator.waitFor({ state: 'visible', timeout: config.navigation_timeout_ms });
    await passwordLocator.waitFor({ state: 'visible', timeout: config.navigation_timeout_ms });
    await emailLocator.fill(email);
    await passwordLocator.fill(password);
    const submit = page.locator('button[type="submit"],input[type="submit"],button')
      .filter({ hasText: /entrar|iniciar|login|sign[ -]?in|continuar|acceder/i }).first();
    if (await submit.count()) await submit.click();
    else await passwordLocator.press('Enter');

    try {
      await page.waitForFunction(() => {
        const passwordVisible = [...document.querySelectorAll('input[type="password"]')].some((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        const authErrorVisible = /servicio de autenticación|ninguna de sus rutas|tardando demasiado|no pudo alcanzar/i.test(
          [...document.querySelectorAll('*')].map((el) => String(el.textContent || '')).join(' ').slice(-20000)
        );
        return !passwordVisible || authErrorVisible;
      }, null, { timeout: 60000 });

      const passwordStillVisible = await page.locator('input[type="password"]').isVisible().catch(() => false);
      const visibleError = await page.locator('text=/servicio de autenticación|ninguna de sus rutas|tardando demasiado|no pudo alcanzar/i').first().textContent().catch(() => '');
      if (passwordStillVisible && visibleError) throw new Error('authenticated_login_visible_error');
      attempts.push({ attempt, status: 'authenticated' });
      return { attempted: true, status: 'authenticated', attempts };
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

async function closeDialogs(page) {
  const candidates = page.getByRole('button', { name: /cerrar|close|cancelar|cancel/i });
  const count = Math.min(await candidates.count(), 5);
  for (let index = 0; index < count; index += 1) {
    try {
      if (await candidates.nth(index).isVisible()) await candidates.nth(index).click({ timeout: 1000 });
    } catch {}
  }
}

async function testControl(page, control, config) {
  const label = safeLabel(control.name);
  if (!control.visible || control.disabled) {
    return { outcome: 'skipped', reason: control.visible ? 'disabled' : 'not_visible' };
  }

  // These two settings labels are intentionally dynamic. Their behavioral
  // certification is owned by settings-rwht-authenticated.yml; the global PC
  // regression re-checks that the controls remain present on the live surface.
  if (
    control.role === 'button' &&
    (/^Activadas$/i.test(label) || /^Desactivadas$/i.test(label) || /^Activar avisos$/i.test(label))
  ) {
    return {
      outcome: 'verified',
      action: 'presence_reuse',
      certification: 'settings-dedicated-e2e'
    };
  }

  if (SAFE_BLOCKED.test(label)) {
    return { outcome: 'blocked', reason: 'high_risk_control', label };
  }
  if (config.require_auth && !config.auth_configured && LOGIN_CONTROL.test(label)) {
    return { outcome: 'blocked', reason: 'authentication_human_gate', label };
  }
  if (!config.allow_mutations && SAFE_MUTATION.test(label)) {
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

  try {
    let locator = null;
    const semanticLocator = () => {
      if (control.id) return page.locator('#' + control.id).first();
      if (control.role && label) return page.getByRole(control.role, { name: label, exact: true }).first();
      return page.locator('button,a[href],[role="button"],[role="tab"],[role="menuitem"]').first();
    };

    // Resolve labels whose visible text contains server-backed/dynamic values
    // from stable semantic prefixes instead of the exact stale snapshot.
    const dynamicMission = label.match(/^Misión\\s+(\\d+)\\s+·/i);
    const dynamicStat = label.match(/^\\d+\\s+(Modelos disponibles|Agentes disponibles|Dispositivos online|Conexiones)$/i);

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
    if (!locator && !settingsDynamic && control.selector_hint) {
      const hinted = page.locator(control.selector_hint).first();
      if (await hinted.count() && await hinted.isVisible().catch(() => false)) locator = hinted;
    }
    if (!locator) locator = semanticLocator();
    if (locator && !(await locator.count().catch(() => 0))) locator = null;

    // Dynamic labels can change across a reload (for example a preference toggle
    // or notification permission button). As a final deterministic fallback, use
    // the current control index within the same active route surface.
    if (!locator && Number.isInteger(control.index)) {
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
    await closeDialogs(page);

    const afterUrl = page.url();
    const afterTitle = await page.title();
    const afterControls = await discoverInteractive(page).catch(() => []);
    const afterHash = sha(afterControls.map((item) => ({ role: item.role, name: item.name, href: item.href })));

    return {
      outcome: 'verified',
      action: 'click',
      effect_observed: beforeUrl !== afterUrl || beforeTitle !== afterTitle || beforeHash !== afterHash,
      url_before: beforeUrl,
      url_after: afterUrl,
      title_before: beforeTitle,
      title_after: afterTitle
    };
  } catch (error) {
    return {
      outcome: 'failed',
      action: 'click',
      error: String(error?.message || error).slice(0, 500)
    };
  }
}

async function verifyAuthState(page, config) {
  if (!config.require_auth) return { required: false, verified: true, reason: 'auth_not_required' };
  const passwordInputs = page.locator('input[type="password"]');
  const visiblePassword = await passwordInputs.evaluateAll((items) =>
    items.some((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    })
  ).catch(() => false);
  if (visiblePassword) return { required: true, verified: false, reason: 'login_form_visible' };
  if (config.expected_auth_text) {
    const pattern = new RegExp(config.expected_auth_text, 'i');
    const matches = await page.getByText(pattern).count().catch(() => 0);
    if (matches === 0) return { required: true, verified: false, reason: 'expected_authenticated_text_missing' };
  }
  return { required: true, verified: true, reason: 'authenticated_surface_detected' };
}

async function auditRoute(page, url, routeIndex, config) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms });
  await page.waitForTimeout(config.settle_ms);

  const passwordVisible = await page.locator('input[type="password"]').evaluateAll((items) =>
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
  const initialControls = await discoverInteractive(page);
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
    controls_testable: initialControls.filter((control) => control.visible && !control.disabled).length,
    controls_verified: 0,
    controls_blocked: 0,
    controls_failed: 0,
    controls_skipped: initialControls.filter((control) => !control.visible || control.disabled).length,
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

  const routeHash = new URL(url).hash.split('?')[0] || '#home';
  const maxControls = Math.min(initialControls.length, config.max_controls_per_route);
  for (let index = 0; index < maxControls; index += 1) {
    // Force a genuinely fresh SPA state before each control. Reusing the same
    // hash URL does not guarantee React state (modals/accordions) is reset.
    await page.reload({ waitUntil: 'domcontentloaded', timeout: config.navigation_timeout_ms }).catch(() => {});
    await page.waitForTimeout(Math.min(config.settle_ms, 1500));

    const controlsNow = await discoverInteractive(page);
    const original = initialControls[index];
    const preblocked = SAFE_BLOCKED.test(safeLabel(original.name))
      || (!config.allow_mutations && SAFE_MUTATION.test(safeLabel(original.name)))
      || (SECRET.test(safeLabel(original.name)) && ['input', 'textarea', 'select'].includes(original.tag));
    if (preblocked) {
      const outcome = await testControl(page, original, config);
      routeResult.actions.push({ control: original, ...outcome });
      if (outcome.outcome === 'verified') routeResult.controls_verified += 1;
      else if (outcome.outcome === 'blocked') routeResult.controls_blocked += 1;
      else if (outcome.outcome === 'failed') routeResult.controls_failed += 1;
      continue;
    }

    // Prefer the stable selector captured from the same route before matching
    // the human-readable label. Toggle labels and mission-card summaries can change
    // across a reload while their DOM position/selector remains stable.
    const target = (original.selector_hint
      ? controlsNow.find((control) =>
          control.selector_hint === original.selector_hint &&
          control.tag === original.tag
        )
      : null) || (original.id
      ? controlsNow.find((control) => control.id === original.id && control.tag === original.tag)
      : null) || controlsNow.find((control) =>
        control.role === original.role &&
        control.name === original.name &&
        control.href === original.href &&
        control.tag === original.tag
      ) || controlsNow[index];

    if (!target) {
      routeResult.actions.push({ control: original, outcome: 'failed', reason: 'control_not_reproducible' });
      routeResult.controls_failed += 1;
      continue;
    }

    // A previous safe interaction may have opened a modal. On ordinary routes,
    // dismiss it before exercising the next control; #mission intentionally starts
    // in its own New Mission modal and must preserve that route surface.
    if (routeHash !== '#mission') await closeDialogs(page);
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
  const pageErrors = [];
  const failedResponses = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ text: message.text() });
  });

  page.on('pageerror', (error) => {
    pageErrors.push({ message: String(error?.message || error).slice(0, 1000) });
  });

  page.on('response', (response) => {
    if (response.status() >= 500) {
      failedResponses.push({
        status: response.status(),
        url: response.url().slice(0, 1000)
      });
    }
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
    page_errors: pageErrors.slice(0, 200),
    failed_responses: failedResponses.slice(0, 200),
    routes: routeResults
  };

  summary.auth_required = config.require_auth;
  summary.auth_verified = !config.require_auth || routeResults.length > 0 && routeResults[0].auth?.verified === true;


  summary.coverage_ratio = summary.controls_testable
    ? Number(((summary.controls_verified + summary.controls_blocked) / summary.controls_testable).toFixed(3))
    : 1;

  summary.verified =
    summary.routes_completed === summary.routes_requested &&
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
