#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'aria-projects-rwht-e2e-v1.1.8';
const BASE_URL = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/project-preview/aria/').replace(/#.*$/, '');
const EMAIL = String(process.env.RWHT_EMAIL || '');
const PASSWORD = String(process.env.RWHT_PASSWORD || '');
const STORAGE_STATE = process.env.RWHT_STORAGE_STATE || '';
const BOOTSTRAP_SESSION_PATH = process.env.RWHT_BOOTSTRAP_SESSION_PATH || '';
const ANON = 'sb_publishable_E2AmZNo2hAbOYlytkVbyBQ_X7JH0HPw';
const TIMEOUT_MS = Number(process.env.RWHT_TIMEOUT_MS || 150000);
const SETTLE_MS = Number(process.env.RWHT_SETTLE_MS || 1200);
const RELOAD_CHAT_TIMEOUT_MS = Number(process.env.RWHT_RELOAD_CHAT_TIMEOUT_MS || 60000);
const ARTIFACT_DIR = process.env.RWHT_ARTIFACT_DIR || path.resolve(process.cwd(), 'projects-rwht-artifacts');
const CERT_SCOPE = String(process.env.RWHT_CERT_SCOPE || 'full').trim().toLowerCase();
const STEPS_7_8_ONLY = CERT_SCOPE === 'steps-7-8';
const PROJECTS = [
  { id: 'battlecruiser', name: 'BattleCruiser' },
  { id: 'cuevacoin', name: 'CuevaCoin' },
  { id: 'aria', name: 'ARIA' }
];

function waitFor(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForPreviewContent(page, expectedSrc, projectId) {
  const normalizedExpected = String(expectedSrc).replace(/\/$/, '');
  const started = Date.now();
  while (Date.now() - started < 30000) {
    const frame = page.frames().find((item) => {
      const actual = String(item.url() || '').replace(/\/$/, '');
      return actual === normalizedExpected || actual.startsWith(normalizedExpected + '?') || actual.startsWith(normalizedExpected + '#');
    });
    if (frame) {
      const bodyText = await frame.locator('body').innerText().catch(() => '');
      const title = await frame.title().catch(() => '');
      if (bodyText.trim().length >= 20 || title.trim()) {
        return { loaded: true, url: frame.url(), title: title.trim(), body_text: bodyText.trim().slice(0, 4000) };
      }
    }
    await waitFor(500);
  }
  throw new Error('artia_preview_content_not_loaded_' + projectId);
}

async function login(page) {
  await page.waitForFunction(
    () => Boolean(localStorage.getItem('aria_session_v2')) || Boolean(document.querySelector('.dashboardScreen')) || Boolean(document.querySelector('.authScreen')) || Boolean(document.querySelector('input[type="password"]')),
    null,
    { timeout: 30000 }
  );

  const persistedBeforeHydration = await readSession(page).catch(() => null);
  const hydrated = persistedBeforeHydration?.accessToken ? null : await hydrateAriaSessionFromStoredSupabaseAuth(page);
  const persisted = hydrated || persistedBeforeHydration;
  if (persisted?.accessToken && persisted.userId) {
    const live = await ensureLiveSession(page);
    if (live) return { mode: hydrated ? 'preseeded_supabase_session_hydrated' : 'preseeded_or_existing_session', status: 'authenticated', attempts: 0 };
  }

  // A stale localStorage token can leave the PWA dashboard shell visible without
  // an authenticated API session. Re-authenticate once through the API before
  // trying UI selectors; Supabase Auth may recover between the initial bootstrap
  // and this point. Do not confuse a missing login form with successful login.
  if (EMAIL && PASSWORD) {
    const fresh = await signInViaAuthApi();
    if (fresh?.accessToken && fresh.refreshToken && fresh.userId) {
      await page.evaluate((session) => localStorage.setItem('aria_session_v2', JSON.stringify(session)), fresh);
      const live = await ensureLiveSession(page);
      if (live) return { mode: 'fresh_auth_api_recovery', status: 'authenticated', attempts: 1, auth_endpoint: fresh.authEndpoint || null };
    }
  }

  if (!EMAIL || !PASSWORD) throw new Error('authenticated_session_source_missing_or_expired');

  const email = page.locator('input[aria-label="Correo"],input[type="email"],input[name="email"],input[autocomplete="username"]').first();
  const password = page.locator('input[aria-label="Contraseña"],input[type="password"],input[name="password"],input[autocomplete="current-password"]').first();
  try {
    await email.waitFor({ state: 'visible', timeout: 12000 });
    await password.waitFor({ state: 'visible', timeout: 8000 });
  } catch {
    throw new Error('auth_provider_unavailable_no_login_form_after_api_recovery');
  }
  await email.fill(EMAIL);
  await password.fill(PASSWORD);
  await password.press('Enter');
  await page.waitForFunction(() => Boolean(localStorage.getItem('aria_session_v2')) && !document.querySelector('input[type="password"]'), null, { timeout: 60000 });
  const authenticated = await ensureLiveSession(page);
  if (!authenticated) throw new Error('authenticated_session_not_verified_after_login');
  return { mode: 'password_ui_fallback', status: 'authenticated', attempts: 1 };
}

async function hydrateAriaSessionFromStoredSupabaseAuth(page) {
  const localCandidate = await page.evaluate(() => {
    const decodeCandidate = (raw) => {
      if (!raw || typeof raw !== 'string') return null;
      const variants = [raw, decodeURIComponent(raw)];
      if (raw.startsWith('base64-')) {
        try {
          variants.push(Buffer.from(raw.slice(7).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        } catch {}
      }
      for (const variant of variants) {
        try {
          const parsed = JSON.parse(variant);
          const value = Array.isArray(parsed) ? parsed[0] : parsed;
          const accessToken = String(value?.access_token || '');
          const refreshToken = String(value?.refresh_token || '');
          const userId = String(value?.user?.id || '');
          if (accessToken && refreshToken && userId) {
            return {
              accessToken,
              refreshToken,
              userId,
              expiresAt: Number(value?.expires_at ? value.expires_at * 1000 : Date.now() + Math.max(60, Number(value?.expires_in || 3600)) * 1000),
              email: value?.user?.email || null
            };
          }
        } catch {}
      }
      return null;
    };
    for (const key of Object.keys(localStorage)) {
      const candidate = decodeCandidate(localStorage.getItem(key));
      if (candidate) return candidate;
    }
    return null;
  });

  if (localCandidate?.accessToken) {
    await page.evaluate((session) => localStorage.setItem('aria_session_v2', JSON.stringify(session)), localCandidate);
    return { ...localCandidate, source: 'localStorage' };
  }

  const cookies = await page.context().cookies();
  const grouped = new Map();
  for (const cookie of cookies) {
    if (!/(auth|access|refresh|token)/i.test(cookie.name)) continue;
    const base = cookie.name.replace(/\.\d+$/, '');
    const list = grouped.get(base) || [];
    list.push(cookie);
    grouped.set(base, list);
  }
  const decodeCookieParts = (items) => {
    const ordered = items.sort((a,b) => a.name.localeCompare(b.name)).map(x => x.value).join('');
    const variants = [ordered, decodeURIComponent(ordered)];
    if (ordered.startsWith('base64-')) {
      try { variants.push(Buffer.from(ordered.slice(7).replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')); } catch {}
    }
    for (const variant of variants) {
      try {
        const parsed = JSON.parse(variant);
        const value = Array.isArray(parsed) ? parsed[0] : parsed;
        const accessToken = String(value?.access_token || '');
        const refreshToken = String(value?.refresh_token || '');
        const userId = String(value?.user?.id || '');
        if (accessToken && refreshToken && userId) return {
          accessToken,
          refreshToken,
          userId,
          expiresAt: Number(value?.expires_at ? value.expires_at * 1000 : Date.now() + Math.max(60, Number(value?.expires_in || 3600)) * 1000),
          email: value?.user?.email || null
        };
      } catch {}
    }
    return null;
  };

  for (const items of grouped.values()) {
    const candidate = decodeCookieParts(items);
    if (candidate) {
      await page.evaluate((session) => localStorage.setItem('aria_session_v2', JSON.stringify(session)), candidate);
      return { ...candidate, source: 'cookie' };
    }
  }

  return null;
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
      const response = await fetch('/api/session', {
        headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
        cache: 'no-store'
      });
      return response.status;
    } catch {
      return 0;
    }
  }, accessToken);
}

function readBootstrapSession() {
  if (!BOOTSTRAP_SESSION_PATH) return null;
  try {
    const session = JSON.parse(fs.readFileSync(BOOTSTRAP_SESSION_PATH, 'utf8'));
    if (session?.accessToken && session?.refreshToken && session?.userId) return session;
  } catch {}
  return null;
}

async function signInViaAuthApi() {
  if (!EMAIL || !PASSWORD) return null;
  // Prefer direct Supabase Auth from the CI runner. Node fetch is not subject to browser
  // CORS, so the certification does not depend on the PWA auth proxy being healthy.
  const origin = new URL(BASE_URL).origin;
  const endpoints = [
    'https://icuqsstxfdbvjytkhlog.supabase.co/auth/v1/token?grant_type=password',
    origin + '/auth/token?grant_type=password'
  ];
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: ANON, accept: 'application/json' },
        body: JSON.stringify({ email: EMAIL.trim(), password: PASSWORD }),
        cache: 'no-store',
        signal: controller.signal
      });
      const body = await response.json().catch(() => null);
      if (response.ok && body?.access_token && body?.refresh_token && body?.user?.id) {
        return {
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          userId: body.user.id,
          expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000,
          email: body.user.email || EMAIL,
          authEndpoint: endpoint
        };
      }
    } catch {
      // Try the same credentials through the public ARIA auth proxy as a fallback.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
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
  if (refreshed) {
    const refreshedStatus = await apiAuthStatus(page, refreshed.accessToken);
    if (refreshedStatus === 200 || refreshedStatus === 204) return refreshed;
  }
  return null;
}

async function waitForPersistedSession(page, expectedUserId, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = await readSession(page).catch(() => null);
    if (session?.accessToken && session.userId === expectedUserId) return session;
    await waitFor(500);
  }
  throw new Error('reload_auth_session_not_persisted');
}

async function readApiCurrent(page, apiPath) {
  const stored = await readSession(page).catch(() => null);
  if (!stored?.accessToken) throw new Error('authenticated_session_missing_before_api_read');
  const live = await ensureLiveSession(page);
  if (!live?.accessToken) throw new Error('authenticated_session_refresh_failed_before_api_read');
  return readApi(page, live.accessToken, apiPath);
}

async function readApi(page, token, apiPath) {
  return page.evaluate(async ({ token: authToken, apiPath: endpoint }) => {
    const response = await fetch('/api' + endpoint, {
      headers: { authorization: 'Bearer ' + authToken },
      cache: 'no-store'
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }, { token, apiPath });
}

async function checkUx(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.projectShell');
    if (!root) return { error: 'project_surface_missing' };
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
    const firstProjectCard = root.querySelector('.projectGrid .projectCard');
    const projectTabs = root.querySelector('.projectTabs');
    const bodyViewport = root.querySelector('.projectBodyViewport');
    const bodyViewportStyle = bodyViewport ? getComputedStyle(bodyViewport) : null;
    const bodyViewportScrollable = Boolean(bodyViewport && bodyViewportStyle && ['auto','scroll'].includes(bodyViewportStyle.overflowY) && bodyViewport.scrollHeight > bodyViewport.clientHeight + 1);
    const unnamed = [];
    const offscreen = [];
    const unlabeled = [];
    for (const element of root.querySelectorAll('button,a[href],[role="button"],[role="tab"],[role="menuitem"],input:not([type="hidden"]):not([type="password"]):not([type="file"]),textarea,select,[contenteditable="true"]')) {
      const rect = element.getBoundingClientRect();
      const name = (
        element.getAttribute('aria-label') ||
        element.getAttribute('aria-labelledby') ||
        element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.innerText ||
        element.textContent ||
        ''
      ).replace(/\s+/g, ' ').trim();
      if (!name && rect.width > 0 && rect.height > 0) unnamed.push({ tag: element.tagName, id: element.id || null });
      if (rect.width > 0 && rect.height > 0) {
        const outside = rect.right <= 0 || rect.left >= viewportWidth || rect.bottom <= 0 || rect.top >= viewportHeight;
        const huge = rect.width > viewportWidth * 1.2 || rect.height > viewportHeight * 1.2;
        // The project content area is intentionally scrollable. Its below-the-fold controls are reachable.
        // Cards and section navigation outside that body remain subject to the strict offscreen gate.
        const insideScrollableBody = Boolean(bodyViewportScrollable && bodyViewport && bodyViewport.contains(element));
        if ((outside && !insideScrollableBody) || huge) offscreen.push({ tag: element.tagName, id: element.id || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      }
    }
    for (const element of root.querySelectorAll('input,textarea,select')) {
      if (['hidden','password','file'].includes(String(element.getAttribute('type') || '').toLowerCase())) continue;
      if ((element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || '').trim()) continue;
      if ((element.getAttribute('placeholder') || '').trim()) continue;
      if (element.id && [...document.querySelectorAll('label')].some((label) => label.htmlFor === element.id)) continue;
      unlabeled.push({ tag: element.tagName, id: element.id || null });
    }
    return {
      horizontal_overflow: scrollWidth > viewportWidth + 2,
      body_scroll_width: scrollWidth,
      viewport_width: viewportWidth,
      viewport_height: viewportHeight,
      window_scroll_y: window.scrollY,
      document_scroll_top: document.documentElement.scrollTop,
      body_scroll_top: document.body.scrollTop,
      project_shell_scroll_top: root.scrollTop,
      first_project_card_top: firstProjectCard?.getBoundingClientRect().top ?? null,
      project_tabs_top: projectTabs?.getBoundingClientRect().top ?? null,
      project_tabs_bottom: projectTabs?.getBoundingClientRect().bottom ?? null,
      project_body_viewport_scrollable: bodyViewportScrollable,
      project_body_viewport_overflow_y: bodyViewportStyle?.overflowY ?? null,
      project_body_viewport_client_height: bodyViewport?.clientHeight ?? null,
      project_body_viewport_scroll_height: bodyViewport?.scrollHeight ?? null,
      project_shell_overflow_anchor: getComputedStyle(root).overflowAnchor,
      active_element_tag: document.activeElement?.tagName ?? null,
      active_element_label: (document.activeElement?.getAttribute('aria-label') || document.activeElement?.getAttribute('title') || document.activeElement?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0,120),
      active_element_inside_project_shell: !!document.activeElement && root.contains(document.activeElement),
      unnamed_interactive: unnamed,
      offscreen_interactive: offscreen,
      unlabeled_inputs: unlabeled
    };
  });
}

async function expectEnabled(locator, projectId, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await locator.isEnabled().catch(() => false)) return;
    await waitFor(500);
  }
  throw new Error('project_chat_send_not_enabled_' + projectId + '_after_' + timeoutMs + 'ms');
}

async function waitForProjectChatMarker(page, token, projectId, marker, timeoutMs = 60000) {
  const started = Date.now();
  let lastStatus = 0;
  while (Date.now() - started < timeoutMs) {
    const result = await readApiCurrent(page, '/projects/' + encodeURIComponent(projectId) + '/conversation');
    lastStatus = result.status;
    if (result.status === 200) {
      const messages = Array.isArray(result.body?.conversation?.messages) ? result.body.conversation.messages : [];
      if (messages.some((message) => typeof message?.content === 'string' && message.content.includes(marker))) {
        return { verified: true, status: result.status, conversation_id: String(result.body?.conversation_id || '') };
      }
    }
    await waitFor(1000);
  }
  throw new Error('project_chat_reload_persistence_timeout_' + projectId + '_status_' + lastStatus);
}

function normalizeMetadata(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch {}
  }
  return {};
}

async function waitForProjectMission(page, token, projectId, goalMarker, timeoutMs = 60000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const result = await readApiCurrent(page, '/projects/' + encodeURIComponent(projectId) + '/missions?limit=20');
    last = result;
    if (result.status === 200 && result.body?.queue === 'canonical' && Array.isArray(result.body?.missions)) {
      const hit = result.body.missions.find((mission) => String(mission.goal || '').includes(goalMarker));
      if (hit) {
        const metadata = normalizeMetadata(hit.metadata);
        const visual = normalizeMetadata(metadata.visual_context);
        return { result, mission: hit, metadata, visual_context: visual };
      }
    }
    await waitFor(2000);
  }
  return { result: last, mission: null, metadata: null, visual_context: null };
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  // Build a fresh session when CI credentials are present. The custom ARIA PWA stores
  // its canonical session in localStorage, so a generic Playwright storageState alone
  // is not sufficient for this application.
  const bootstrapSession = readBootstrapSession() || await signInViaAuthApi();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {})
  });
  if (bootstrapSession) {
    // Seed only the top-level ARIA document. Embedded sandboxed project previews
    // must not attempt to read/write localStorage or create false PWA page errors.
    await context.addInitScript((session) => {
      try {
        if (window.top !== window) return;
      } catch {
        return;
      }
      try {
        localStorage.setItem('aria_session_v2', JSON.stringify(session));
      } catch {
        // Local storage is intentionally unavailable inside sandboxed previews.
      }
    }, bootstrapSession);
  }
  const page = await context.newPage();
  const consoleErrors = [];
  const externalPreviewConsoleErrors = [];
  const pageErrors = [];
  const failedResponses = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location?.() || {};
    const url = String(location.url || page.url());
    const item = { text: message.text().slice(0, 1000), url };
    const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
    const internalHosts = new Set(['aria.robvg9.workers.dev','icuqsstxfdbvjytkhlog.supabase.co']);
    if (host && !internalHosts.has(host)) externalPreviewConsoleErrors.push(item);
    else consoleErrors.push(item);
  });
  page.on('pageerror', (error) => pageErrors.push({ message: String(error?.message || error).slice(0, 1000), stack: String(error?.stack || '').slice(0, 5000), url: page.url() }));
  page.on('response', (response) => {
    if (response.status() >= 500) failedResponses.push({ status: response.status(), method: response.request().method(), url: response.url().slice(0, 1200) });
  });

  const startedAt = new Date().toISOString();
  const report = {
    version: VERSION,
    certification_scope: CERT_SCOPE,
    steps_7_8: null,
    external_preview_page_errors: [],
    started_at: startedAt,
    finished_at: null,
    target: BASE_URL + '#projects',
    auth_verified: false,
    reload_auth_verified: false,
    login: null,
    auth_attempts: 0,
    project_count: 0,
    project_ids: [],
    tabs: [],
    projects: [],
    overview_preview_results: [],
    preview_results: [],
    visual_missions: [],
    visual_mission: null,
    ux: null,
    console_errors: [],
    external_preview_console_errors: [],
    page_errors: [],
    failed_responses: [],
    verified: false,
    failure: null
  };

  try {
    await page.goto(BASE_URL + '#home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(SETTLE_MS);
    try {
      report.login = await login(page);
    } catch (authError) {
      const stored = await readSession(page).catch(() => null);
      report.login = {
        mode: 'failed',
        status: 'unavailable',
        attempts: 1,
        stale_local_session_detected: Boolean(stored?.accessToken),
        error: authError instanceof Error ? authError.message : String(authError)
      };
      throw authError;
    }
    report.auth_attempts = Number(report.login?.attempts || 0);
    let session = await readSession(page);
    if (!session?.accessToken || !session.userId) throw new Error('authenticated_session_not_persisted');
    let liveSession = await ensureLiveSession(page);
    if (!liveSession?.accessToken && bootstrapSession?.accessToken && bootstrapSession?.userId) {
      await page.evaluate((value) => localStorage.setItem('aria_session_v2', JSON.stringify(value)), bootstrapSession);
      liveSession = await ensureLiveSession(page);
    }
    if (!liveSession?.accessToken || !liveSession.userId) {
      const authStatus = session?.accessToken ? await apiAuthStatus(page, session.accessToken) : 0;
      throw new Error('authenticated_live_session_not_verified_status_' + authStatus);
    }
    session = liveSession;
    report.auth_verified = true;

    const projectsApi = await readApiCurrent(page, '/projects');
    if (projectsApi.status !== 200 || !Array.isArray(projectsApi.body?.projects)) throw new Error('projects_api_unavailable_' + projectsApi.status);
    report.project_count = projectsApi.body.projects.length;
    report.project_ids = projectsApi.body.projects.map((project) => String(project.id)).sort();
    if (report.project_count !== 3 || report.project_ids.join(',') !== 'aria,battlecruiser,cuevacoin') throw new Error('project_catalog_contract_failed');

    await page.goto(BASE_URL + '#projects', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.projectShell', { state: 'visible', timeout: 60000 });
    await waitFor(SETTLE_MS);

    report.ux = await checkUx(page);
    if (report.ux.error) throw new Error(report.ux.error);
    if (report.ux.project_shell_overflow_anchor !== 'none') throw new Error('projects_scroll_anchor_not_disabled');
    if (Number(report.ux.project_shell_scroll_top) !== 0 || Number(report.ux.first_project_card_top) < 0) throw new Error('projects_scroll_anchor_contract_failed');
    if (Number(report.ux.project_tabs_top) < 0 || Number(report.ux.project_tabs_bottom) > Number(report.ux.viewport_height)) throw new Error('projects_tabs_must_remain_visible');
    if (!report.ux.project_body_viewport_scrollable || !['auto','scroll'].includes(report.ux.project_body_viewport_overflow_y)) throw new Error('projects_body_viewport_must_own_scrolling');
    if (report.ux.horizontal_overflow || report.ux.unnamed_interactive.length || report.ux.offscreen_interactive.length || report.ux.unlabeled_inputs.length) {
      throw new Error('projects_ux_contract_failed');
    }

    const cards = page.locator('.projectGrid .projectCard');
    if (await cards.count() !== 3) throw new Error('project_card_count_failed');

    // The preview belongs to the selected project's normal workspace, not only ARTIA.
    const overviewPreviewResults = report.overview_preview_results;
    if (!STEPS_7_8_ONLY) {
    for (const expected of [
      { id: 'battlecruiser', name: 'BattleCruiser', src: 'https://battlecruiser.robvg9.workers.dev/' },
      { id: 'cuevacoin', name: 'CuevaCoin', src: 'https://aria.robvg9.workers.dev/project-preview/cuevacoin/' },
      { id: 'aria', name: 'ARIA', src: 'https://aria.robvg9.workers.dev/project-preview/aria/' }
    ]) {
      await page.locator('.projectGrid .projectCard').filter({ hasText: expected.name }).first().click();
      await page.locator('.projectTabs .tabButton').filter({ hasText: 'Resumen' }).click();
      await page.waitForSelector('.projectOverviewPreview', { state: 'visible', timeout: 30000 });
      const overviewIframe = page.locator('.projectOverviewPreview iframe').first();
      if (await overviewIframe.count() !== 1) throw new Error('project_overview_preview_missing_' + expected.id);
      const overviewSrc = await overviewIframe.getAttribute('src');
      if (overviewSrc !== expected.src) throw new Error('project_overview_preview_src_mismatch_' + expected.id);
      const overviewLoaded = await waitForPreviewContent(page, expected.src, expected.id);
      const overviewSearchable = (overviewLoaded.title + ' ' + overviewLoaded.body_text).toLowerCase();
      if (!overviewSearchable.includes(expected.name.toLowerCase())) throw new Error('project_overview_preview_content_mismatch_' + expected.id);
      overviewPreviewResults.push({ id: expected.id, src: overviewSrc, loaded: true });
    }
    }
    const tabs = page.locator('.projectTabs .tabButton');
    report.tabs = await tabs.allTextContents();
    if (report.tabs.map((x) => x.trim()).join('|') !== 'Resumen|Chat|Misiones|ARTIA') throw new Error('project_tab_contract_failed');

    for (const project of PROJECTS) {
      await page.locator('.projectGrid .projectCard').filter({ hasText: project.name }).first().click();
      await page.waitForSelector('.projectHero', { state: 'visible', timeout: 30000 });
      const hero = await page.locator('.projectHero h2').innerText();
      if (!hero.includes(project.name)) throw new Error('project_selection_failed_' + project.id);

      await page.locator('.projectTabs .tabButton').filter({ hasText: 'Chat' }).click();
      await page.waitForSelector('.projectChatWindow', { state: 'visible', timeout: 30000 });
      await page.waitForSelector('.projectChatWindow + *', { state: 'attached', timeout: 30000 }).catch(() => {});
      const marker = 'RWHTPROJECTCHAT' + project.id.toUpperCase() + Date.now();
      const composer = page.locator('.projectShell textarea[placeholder^="Habla con ARIA sobre"]').first();
      await composer.fill(marker + ' responde con una confirmación breve y menciona únicamente el proyecto actual.');
      const send = page.getByRole('button', { name: 'Enviar mensaje' }).first();
      await send.waitFor({state:'visible',timeout:TIMEOUT_MS});
      await expectEnabled(send, project.id);
      await send.click();
      await page.locator('.projectChatWindow .bubble.user').filter({ hasText: marker }).waitFor({ state: 'visible', timeout: 30000 });
      // Finish on a real response OR a visible error, so a broken runtime is
      // reported with evidence instead of waiting four minutes for a bubble that cannot arrive.
      await page.waitForFunction(({ markerValue }) => {
        const bubbles=[...document.querySelectorAll('.projectChatWindow .bubble')];
        const userIndex=bubbles.findIndex(node=>node.classList.contains('user')&&(node.textContent||'').includes(markerValue));
        const assistantAfterUser=userIndex>=0&&bubbles.slice(userIndex+1).some(node=>node.classList.contains('aria')&&String(node.textContent||'').trim().length>0);
        const surfacedError=[...document.querySelectorAll('.projectShell .errorBox')].some(node=>String(node.textContent||'').trim().length>0);
        return assistantAfterUser||surfacedError;
      }, { markerValue: marker }, { timeout: TIMEOUT_MS });
      const surfacedChatError=(await page.locator('.projectShell .errorBox').allTextContents()).map(x=>x.trim()).find(Boolean);
      if(surfacedChatError) throw new Error('project_chat_runtime_error_'+project.id+'_'+surfacedChatError.slice(0,240));
      const assistant = page.locator('.projectChatWindow .bubble.aria').last();
      await assistant.waitFor({ state: 'visible', timeout: 15000 });
      const responseTextProbe = (await assistant.innerText()).trim();
      if (!responseTextProbe) throw new Error('project_chat_assistant_response_empty_' + project.id);
      const responseText = (await assistant.innerText()).trim();
      if (!responseText || /error comunicando|no se pudo|fall[oó] al|conversation_/i.test(responseText)) throw new Error('project_chat_bad_response_' + project.id);

      let conversation = null;
      let messages = [];
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        conversation = await readApiCurrent(page, '/projects/' + project.id + '/conversation');
        if (conversation.status === 200) {
          messages = Array.isArray(conversation.body?.conversation?.messages) ? conversation.body.conversation.messages : [];
          if (messages.some((message) => typeof message?.content === 'string' && message.content.includes(marker))) break;
        }
        await waitFor(1000);
      }
      if (!conversation || conversation.status !== 200) throw new Error('project_conversation_status_' + project.id + '_' + String(conversation?.status ?? 'missing'));
      if (!messages.some((message) => typeof message?.content === 'string' && message.content.includes(marker))) {
        throw new Error('project_chat_server_readback_missing_' + project.id);
      }
      const conversationId = String(conversation.body?.conversation_id || '');
      if (!conversationId) throw new Error('project_conversation_id_missing_' + project.id);

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
      await page.waitForSelector('.projectShell', { state: 'visible', timeout: 60000 });
      await waitForPersistedSession(page, session.userId);
      const refreshedAfterReload = await ensureLiveSession(page);
      if (!refreshedAfterReload?.accessToken || refreshedAfterReload.userId !== session.userId) throw new Error('reload_live_session_not_verified');
      session = refreshedAfterReload;
      report.reload_auth_verified = true;
      const selectedProject = page.locator('.projectGrid .projectCard.selected').filter({ hasText: project.name }).first();
      await selectedProject.waitFor({ state: 'visible', timeout: RELOAD_CHAT_TIMEOUT_MS });
      await page.waitForSelector('.projectChatWindow', { state: 'visible', timeout: RELOAD_CHAT_TIMEOUT_MS });
      const reloadReadback = await waitForProjectChatMarker(page, session.accessToken, project.id, marker, 60000);
      if (!reloadReadback.verified || reloadReadback.conversation_id !== conversationId) {
        throw new Error('project_chat_reload_persistence_mismatch_' + project.id);
      }

      report.projects.push({
        id: project.id,
        name: project.name,
        chat: {
          marker,
          response_verified: true,
          server_status: conversation.status,
          server_persistence_verified: true,
          conversation_id: conversationId,
          reload_persistence_verified: true
        }
      });
    }

    if (new Set(report.projects.map((project) => project.chat.conversation_id)).size !== 3) throw new Error('project_conversation_ids_not_isolated');

    const visualMissions = report.visual_missions;
    if (!STEPS_7_8_ONLY) {
    // ARTIA must accept real visual mission creation for every project, not only BattleCruiser.
    const visualMissionExpectations = {
      battlecruiser: { src: 'https://battlecruiser.robvg9.workers.dev/', mode: 'auth-required' },
      cuevacoin: { src: 'https://aria.robvg9.workers.dev/project-preview/cuevacoin/', mode: 'source' },
      aria: { src: 'https://aria.robvg9.workers.dev/project-preview/aria/', mode: 'live' }
    };
    for (const visualProject of PROJECTS) {
      await page.locator('.projectGrid .projectCard').filter({ hasText: visualProject.name }).first().click();
      await page.locator('.projectTabs .tabButton').filter({ hasText: 'ARTIA' }).click();
      await page.waitForSelector('.artiaPreviewShell', { state: 'visible', timeout: 30000 });
      const expectedPreview = visualMissionExpectations[visualProject.id];
      const visualIframe = page.locator('.artiaPreviewShell iframe').first();
      if (await visualIframe.count() !== 1) throw new Error('artia_visual_iframe_missing_' + visualProject.id);
      if (await visualIframe.getAttribute('src') !== expectedPreview.src) throw new Error('artia_visual_iframe_src_mismatch_' + visualProject.id);
      const visualPreviewContent = await waitForPreviewContent(page, expectedPreview.src, visualProject.id);
      const visualSearchable = (visualPreviewContent.title + ' ' + visualPreviewContent.body_text).toLowerCase();
      if (!visualSearchable.includes(visualProject.name.toLowerCase())) throw new Error('artia_visual_preview_content_mismatch_' + visualProject.id);
      const visualBadge = page.locator('.artiaPreviewShell .projectReferenceBadge').first();
      if (expectedPreview.mode === 'source') {
        await visualBadge.waitFor({ state: 'visible', timeout: 10000 });
        if (!(await visualBadge.innerText()).includes('REFERENCIA VISUAL')) throw new Error('artia_visual_source_badge_missing_' + visualProject.id);
      } else if (expectedPreview.mode === 'auth-required') {
        await visualBadge.waitFor({ state: 'visible', timeout: 10000 });
        if (!(await visualBadge.innerText()).toLowerCase().includes('requiere sesión')) throw new Error('artia_visual_auth_required_badge_missing_' + visualProject.id);
      } else if (await visualBadge.count() > 0 && await visualBadge.isVisible().catch(() => false)) {
        throw new Error('artia_visual_live_badge_mislabelled_' + visualProject.id);
      }

      await page.getByRole('button', { name: 'Pausar para pintar' }).click();
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.artiaPreviewShell canvas');
        const iframe = document.querySelector('.artiaPreviewShell iframe');
        const pauseControlActive = [...document.querySelectorAll('.visualPreviewControlGroup button')].some((button) => /Reproducir vista/.test(button.innerText || ''));
        const hint = String(document.querySelector('.visualHint')?.textContent || '');
        return Boolean(pauseControlActive && canvas && getComputedStyle(canvas).pointerEvents === 'auto'
          && (!iframe || getComputedStyle(iframe).pointerEvents === 'none')
          && /La vista está pausada/.test(hint));
      }, null, { timeout: 15000 }).catch(async (error) => {
        const state = await page.evaluate(() => ({
          url: location.href,
          selected_project: document.querySelector('.projectGrid .projectCard.selected')?.innerText?.trim() || null,
          selected_tab: document.querySelector('.projectTabs .tabButton.selected')?.innerText?.trim() || null,
          visual_board_present: Boolean(document.querySelector('.visualBoardPanel')),
          canvas_pointer_events: getComputedStyle(document.querySelector('.artiaPreviewShell canvas')).pointerEvents,
          iframe_pointer_events: document.querySelector('.artiaPreviewShell iframe') ? getComputedStyle(document.querySelector('.artiaPreviewShell iframe')).pointerEvents : null,
          hint: document.querySelector('.visualHint')?.textContent || null
        }));
        throw new Error('artia_pause_state_not_applied_' + visualProject.id + '_' + JSON.stringify(state) + '; cause=' + String(error?.message || error));
      });
      await page.getByRole('button', { name: 'Rectángulo' }).click();
      const rectTool = page.getByRole('button', { name: 'Rectángulo' }).first();
      if (!(await rectTool.evaluate((node) => node.classList.contains('selected')))) throw new Error('artia_rect_tool_not_selected_' + visualProject.id);
      const visualGoalMarker = 'RWHTVISUALMISSION' + visualProject.id.toUpperCase() + Date.now();
      await page.locator('.visualInstruction').fill('Certificación visual ' + visualGoalMarker + ': comprobar que esta superficie acepta una misión dibujada y conserva el contexto del proyecto.');
      const visualCanvas = page.locator('.artiaPreviewShell canvas').first();
      await visualCanvas.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const c = document.querySelector('.artiaPreviewShell canvas');
        const shell = document.querySelector('.artiaPreviewShell');
        if (!c || !shell) return false;
        const rect = c.getBoundingClientRect();
        return c.width > 0 && c.height > 0 && rect.width > 400 && rect.height > 200 && shell.getBoundingClientRect().width > 400;
      }, null, { timeout: 30000 }).catch(async (error) => {
        const state = await page.evaluate(() => {
          const c = document.querySelector('.artiaPreviewShell canvas');
          const shell = document.querySelector('.artiaPreviewShell');
          const r = c?.getBoundingClientRect();
          const s = shell?.getBoundingClientRect();
          return {
            canvas_found: Boolean(c),
            canvas_width_attr: c?.getAttribute('width') ?? null,
            canvas_height_attr: c?.getAttribute('height') ?? null,
            canvas_width: c?.width ?? null,
            canvas_height: c?.height ?? null,
            canvas_rect: r ? { width: r.width, height: r.height, x: r.x, y: r.y } : null,
            shell_rect: s ? { width: s.width, height: s.height, x: s.x, y: s.y } : null,
            project_tab: document.querySelector('.projectTabs .tabButton.active')?.textContent?.trim() ?? null
          };
        });
        throw new Error('artia_canvas_not_ready_' + visualProject.id + '_' + JSON.stringify(state) + '; cause=' + String(error?.message || error));
      });
      // Draw only inside the canvas area that is actually visible through the
      // scrollable Projects body. Its full DOM rect may extend underneath the
      // fixed project tabs after scrollIntoViewIfNeeded(); those occluded pixels
      // must not be used as pointer targets.
      const drawGeometry = await page.evaluate(() => {
        const canvas = document.querySelector('.artiaPreviewShell canvas');
        const viewport = document.querySelector('.projectBodyViewport');
        if (!canvas || !viewport) return null;
        const r = canvas.getBoundingClientRect();
        const v = viewport.getBoundingClientRect();
        const visible = {
          left: Math.max(r.left, v.left),
          top: Math.max(r.top, v.top),
          right: Math.min(r.right, v.right),
          bottom: Math.min(r.bottom, v.bottom)
        };
        return {
          canvas: { x: r.x, y: r.y, width: r.width, height: r.height },
          project_body_viewport: { x: v.x, y: v.y, width: v.width, height: v.height },
          visible_canvas: { ...visible, width: visible.right-visible.left, height: visible.bottom-visible.top }
        };
      });
      if (!drawGeometry?.visible_canvas || drawGeometry.visible_canvas.width < 400 || drawGeometry.visible_canvas.height < 200) {
        throw new Error('artia_canvas_visible_area_not_ready_' + visualProject.id + '_' + JSON.stringify(drawGeometry));
      }
      const visibleCanvas = drawGeometry.visible_canvas;
      const drawPoints = {
        start: { x: visibleCanvas.left + visibleCanvas.width * 0.20, y: visibleCanvas.top + visibleCanvas.height * 0.20 },
        end: { x: visibleCanvas.left + visibleCanvas.width * 0.55, y: visibleCanvas.top + visibleCanvas.height * 0.55 }
      };
      // Do not let a bad hit target silently become a global PWA swipe. Prove that
      // both ends of the real mouse gesture are in the visible clip AND actually hit
      // the annotation canvas (not an overlapped project tab or neighboring control).
      const hitTest = await page.evaluate(({ start, end }) => {
        const canvas = document.querySelector('.artiaPreviewShell canvas');
        const viewport = document.querySelector('.projectBodyViewport');
        const describe = (point) => {
          const target = document.elementFromPoint(point.x, point.y);
          const inViewport = Boolean(viewport && (() => {
            const v = viewport.getBoundingClientRect();
            return point.x >= v.left && point.x < v.right && point.y >= v.top && point.y < v.bottom;
          })());
          return {
            x: point.x, y: point.y,
            in_project_body_viewport: inViewport,
            is_canvas: Boolean(canvas && target === canvas),
            tag: target?.tagName || null,
            class_name: target ? String(target.className?.baseVal || target.className || '').slice(0, 180) : null,
            text: String(target?.textContent || '').trim().slice(0, 120)
          };
        };
        const rect = canvas?.getBoundingClientRect();
        const v = viewport?.getBoundingClientRect();
        return {
          hash: location.hash,
          project: document.querySelector('.projectGrid .projectCard.selected')?.innerText?.trim() || null,
          tab: document.querySelector('.projectTabs .tabButton.selected')?.innerText?.trim() || null,
          canvas_pointer_events: canvas ? getComputedStyle(canvas).pointerEvents : null,
          canvas_rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
          project_body_viewport_rect: v ? { x: v.x, y: v.y, width: v.width, height: v.height } : null,
          visible_canvas: null,
          viewport: { width: innerWidth, height: innerHeight },
          start: describe(start),
          end: describe(end)
        };
      }, drawPoints);
      hitTest.visible_canvas = drawGeometry.visible_canvas;
      if (!hitTest.start.is_canvas || !hitTest.end.is_canvas
        || !hitTest.start.in_project_body_viewport || !hitTest.end.in_project_body_viewport) {
        await page.screenshot({ path: path.join(ARTIFACT_DIR, 'artia-hit-test-failure-' + visualProject.id + '.png'), fullPage: true }).catch(() => {});
        throw new Error('artia_canvas_hit_test_failed_' + visualProject.id + '_' + JSON.stringify(hitTest));
      }
      const beforeDraw = await visualCanvas.evaluate((node) => (node instanceof HTMLCanvasElement ? node.toDataURL('image/png') : ''));
      await page.mouse.move(drawPoints.start.x, drawPoints.start.y);
      await page.mouse.down();
      await new Promise(resolve => setTimeout(resolve, 120));
      await page.mouse.move(drawPoints.end.x, drawPoints.end.y, { steps: 12 });
      await page.mouse.up();
      const routeAfterDrawingGesture = await page.evaluate(() => location.hash);
      if (routeAfterDrawingGesture !== '#projects') {
        throw new Error('artia_drawing_gesture_changed_global_route_' + visualProject.id + '_to_' + routeAfterDrawingGesture);
      }
      await page.waitForFunction(() => [...document.querySelectorAll('.visualHint')].some(n => /Anotaciones:\s*[1-9]\d*/.test(n.textContent || '')), null, { timeout: 30000 }).catch(async (error) => {
        const state = await page.evaluate(() => {
          const c = document.querySelector('.artiaPreviewShell canvas');
          const iframe = document.querySelector('.artiaPreviewShell iframe');
          const rect = c?.getBoundingClientRect();
          return {
            url: location.href,
            selected_project: document.querySelector('.projectGrid .projectCard.selected')?.innerText?.trim() || null,
            selected_tab: document.querySelector('.projectTabs .tabButton.selected')?.innerText?.trim() || null,
            visual_board_present: Boolean(document.querySelector('.visualBoardPanel')),
            canvas_found: Boolean(c),
            canvas_pointer_events: c ? getComputedStyle(c).pointerEvents : null,
            iframe_pointer_events: iframe ? getComputedStyle(iframe).pointerEvents : null,
            canvas_rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
            hints: [...document.querySelectorAll('.visualHint')].map(n => n.textContent || ''),
            body_tail: (document.body?.innerText || '').slice(-1600)
          };
        });
        await page.screenshot({ path: path.join(ARTIFACT_DIR, 'artia-drawing-failure-' + visualProject.id + '.png'), fullPage: true }).catch(() => {});
        throw new Error('artia_drawing_annotation_not_observed_' + visualProject.id + '_' + JSON.stringify(state) + '; cause=' + String(error?.message || error));
      });
      const afterDraw = await visualCanvas.evaluate((node) => (node instanceof HTMLCanvasElement ? node.toDataURL('image/png') : ''));
      if (!beforeDraw || !afterDraw || beforeDraw === afterDraw) throw new Error('artia_canvas_drawing_not_observed_' + visualProject.id);
      const visualMissionButton = page.getByRole('button', { name: 'Crear misión con este diseño' }).first();
      if (!(await visualMissionButton.isEnabled())) throw new Error('artia_visual_mission_button_not_enabled_' + visualProject.id);
      await visualMissionButton.click();
      await page.waitForFunction(() => [...document.querySelectorAll('.visualBoardPanel .notice')].some((node) => {
        const text = node.textContent || '';
        return text.includes('Misión confirmada por ARIA con el diseño y las anotaciones.')
          || /visual_mission_create_not_confirmed|ARIA no confirmó la creación de la misión|No se pudo guardar el diseño|No se pudo enviar el diseño/i.test(text);
      }), null, { timeout: 120000 });
      const missionNotice = (await page.locator('.visualBoardPanel .notice').last().innerText().catch(() => '')).trim();
      if (!missionNotice.includes('Misión confirmada por ARIA con el diseño y las anotaciones.')) {
        throw new Error('visual_mission_submission_failed_' + visualProject.id + '_' + missionNotice.slice(0, 240));
      }

      // Read the canonical project-mission list instead of assuming a particular
      // browser response URL. The live UI can succeed while proxies/redirects make
      // a response listener miss the POST event; server read-back is the authority.
      let visualMission = null;
      let visualMissionId = '';
      const verifyStarted = Date.now();
      while (Date.now() - verifyStarted < 90000) {
        const listed = await readApiCurrent(page, '/projects/' + encodeURIComponent(visualProject.id) + '/missions?limit=20');
        const rows = Array.isArray(listed.body?.missions) ? listed.body.missions : [];
        const match = rows.find((row) => {
          const metadata = normalizeMetadata(row?.metadata);
          const context = normalizeMetadata(metadata.visual_context);
          const goal = String(row?.goal || row?.title || row?.name || '');
          return goal.includes(visualGoalMarker) || String(context.instruction || '').includes(visualGoalMarker);
        });
        const candidateId = String(match?.mission_id || '');
        if (candidateId) {
          const direct = await readApiCurrent(page, '/missions/' + encodeURIComponent(candidateId));
          if (direct.status === 200 && direct.body?.mission?.mission_id === candidateId) {
            visualMission = direct.body.mission;
            visualMissionId = candidateId;
            break;
          }
        }
        await waitFor(1500);
      }
      if (!visualMission || !visualMissionId) throw new Error('visual_mission_not_persisted_' + visualProject.id);
      // A certification-created mission must not remain in the live queue after proof.
      // Cancel it through the canonical API, then read the persisted row back again.
      const terminalStatuses = new Set(['succeeded','failed','blocked','cancelled']);
      let cleanupStatus = String(visualMission.status || '');
      if (!terminalStatuses.has(cleanupStatus)) {
        const liveForCleanup = await ensureLiveSession(page);
        if (!liveForCleanup?.accessToken || liveForCleanup.userId !== session.userId) throw new Error('visual_mission_cleanup_session_missing_' + visualProject.id);
        const cancelResult = await page.evaluate(async ({ missionId, token }) => {
          try {
            const response = await fetch('/api/missions/' + encodeURIComponent(missionId) + '/cancel', {
              method: 'POST',
              headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
              cache: 'no-store'
            });
            const body = await response.json().catch(() => null);
            return { status: response.status, body };
          } catch (error) {
            return { status: 0, body: { error: error instanceof Error ? error.message : String(error) } };
          }
        }, { missionId: visualMissionId, token: liveForCleanup.accessToken });
        const afterCancel = await readApiCurrent(page, '/missions/' + encodeURIComponent(visualMissionId));
        const afterMission = afterCancel.status === 200 ? afterCancel.body?.mission : null;
        cleanupStatus = String(afterMission?.status || '');
        if (!terminalStatuses.has(cleanupStatus)) {
          throw new Error('visual_mission_cleanup_left_active_' + visualProject.id + '_http_' + cancelResult.status + '_status_' + cleanupStatus);
        }
        visualMission = afterMission;
      }

      const visualMetadata = normalizeMetadata(visualMission.metadata);
      const visualContext = normalizeMetadata(visualMetadata.visual_context);
      if (String(visualMetadata.project_id || '').toLowerCase() !== visualProject.id) throw new Error('visual_mission_project_id_missing_' + visualProject.id);
      if (!String(visualContext.image_path || '')) throw new Error('visual_mission_png_path_missing_' + visualProject.id);
      if (String(visualContext.mime_type || '') !== 'image/png') throw new Error('visual_mission_png_mime_missing_' + visualProject.id);
      if (!String(visualContext.annotation_summary || '').includes('rect')) throw new Error('visual_mission_annotation_summary_missing_' + visualProject.id);
      if (!String(visualContext.instruction || '').includes(visualGoalMarker)) throw new Error('visual_mission_instruction_missing_' + visualProject.id);
      visualMissions.push({
        mission_id: visualMission.mission_id,
        project_id: visualProject.id,
        queue: 'canonical',
        status: visualMission.status,
        cleanup_terminal_status: cleanupStatus,
        image_path: visualContext.image_path,
        mime_type: visualContext.mime_type,
        annotation_summary: visualContext.annotation_summary,
        instruction: visualContext.instruction
      });
    }

    }
    if (!STEPS_7_8_ONLY) {
    // ARTIA preview certification: every project must expose a real preview surface.
    const previewExpectations = [
      { id: 'battlecruiser', name: 'BattleCruiser', src: 'https://battlecruiser.robvg9.workers.dev/', mode: 'auth-required' },
      { id: 'cuevacoin', name: 'CuevaCoin', src: 'https://aria.robvg9.workers.dev/project-preview/cuevacoin/', mode: 'source' },
      { id: 'aria', name: 'ARIA', src: 'https://aria.robvg9.workers.dev/project-preview/aria/', mode: 'live' }
    ];
    const previewResults = report.preview_results;
    for (const expected of previewExpectations) {
      await page.locator('.projectGrid .projectCard').filter({ hasText: expected.name }).first().click();
      await page.locator('.projectTabs .tabButton').filter({ hasText: 'ARTIA' }).click();
      await page.waitForSelector('.artiaPreviewShell', { state: 'visible', timeout: 30000 });
      const previewFrame = page.locator('.artiaPreviewShell iframe').first();
      if (await previewFrame.count() !== 1) throw new Error('artia_preview_missing_' + expected.id);
      const actualSrc = await previewFrame.getAttribute('src');
      if (actualSrc !== expected.src) throw new Error('artia_preview_src_mismatch_' + expected.id + '_' + String(actualSrc));
      const badge = page.locator('.artiaPreviewShell .projectReferenceBadge').first();
      if (expected.mode === 'source') {
        await badge.waitFor({ state: 'visible', timeout: 10000 });
        if (!(await badge.innerText()).includes('REFERENCIA VISUAL')) throw new Error('artia_source_badge_missing_' + expected.id);
      } else if (expected.mode === 'auth-required') {
        await badge.waitFor({ state: 'visible', timeout: 10000 });
        if (!(await badge.innerText()).toLowerCase().includes('requiere sesión')) throw new Error('artia_auth_required_badge_missing_' + expected.id);
      } else if (await badge.count() > 0 && await badge.isVisible().catch(() => false)) {
        throw new Error('artia_live_preview_mislabelled_' + expected.id);
      }
      previewResults.push({ id: expected.id, src: actualSrc, mode: expected.mode, verified: true });
    }

    await page.waitForSelector('.projectTabs .tabButton', { state: 'visible', timeout: 30000 });
    await page.locator('.projectTabs .tabButton').filter({ hasText: 'Misiones' }).click();
    await page.waitForSelector('.catalogList', { state: 'visible', timeout: 30000 });

    report.preview_results = previewResults;
    report.overview_preview_results = overviewPreviewResults;
    if (overviewPreviewResults.length !== PROJECTS.length) throw new Error('overview_preview_coverage_failed');
    report.visual_missions = visualMissions;
    report.visual_mission = visualMissions[0] || null;
    if (visualMissions.length !== PROJECTS.length) throw new Error('visual_mission_coverage_failed');
    } else {
      report.preview_results = [];
      report.visual_missions = [];
      report.visual_mission = null;
      report.scope_note = 'Steps 7-8 only: drawing missions and the full ARTIA preview gate are left to later certification steps.';
    }

    // The visual/preview loops deliberately end on ARIA. Capture the actual
    // selected project before reload and assert that same selection is preserved,
    // rather than hard-coding BattleCruiser after the loop changed the selection.
    const selectedBeforeFinalReload = (await page.locator('.projectGrid .projectCard.selected').innerText().catch(() => '')).trim();
    const expectedSelectedProject = PROJECTS.find((project) => selectedBeforeFinalReload.includes(project.name));
    if (!expectedSelectedProject) throw new Error('final_selected_project_unavailable_before_reload');
    report.final_selected_project = expectedSelectedProject.id;

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.projectShell', { state: 'visible', timeout: 60000 });
    const finalSession = await waitForPersistedSession(page, session.userId);
    const finalLiveSession = await ensureLiveSession(page);
    if (!finalLiveSession?.accessToken || finalLiveSession.userId !== session.userId) throw new Error('final_live_session_not_verified');
    session = finalLiveSession;
    await page.waitForFunction(({ projectName }) => Boolean(document.querySelector('.projectGrid .projectCard.selected')?.textContent?.includes(projectName)), { projectName: expectedSelectedProject.name }, { timeout: 30000 });
    if (!report.reality_board?.verified) await page.screenshot({ path: path.join(ARTIFACT_DIR, 'projects-final.png'), fullPage: true }).catch(() => {});

    // Verify the independent Reality Board against live API responses, exact deployment SHA,
    // current GitHub main and the source freshness contract. The app must surface uncertainty
    // instead of promoting historical sources or a mismatched E2E run to LIVE truth.
    const boardUrl = new URL('reality-board.html', BASE_URL.endsWith('/') ? BASE_URL : BASE_URL + '/').href;
    const boardApiResponses = [];
    const boardOrigin = new URL(BASE_URL).origin;
    const onBoardResponse = (response) => {
      try {
        const u = new URL(response.url());
        if (u.origin === boardOrigin && u.pathname.startsWith('/api/projects')) {
          boardApiResponses.push({ path: u.pathname, status: response.status() });
        }
      } catch {}
    };
    page.on('response', onBoardResponse);
    await page.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
      const err = document.querySelector('#err');
      const hasError = Boolean(err && getComputedStyle(err).display !== 'none' && String(err.textContent || '').trim());
      return hasError || (document.querySelectorAll('#summary .row').length >= 4 && document.querySelectorAll('#projects .row').length === 3 && String(document.querySelector('#updated')?.textContent || '').includes('Actualizado:'));
    }, null, { timeout: 60000 });
    const boardInitial = await page.evaluate(() => {
      const err = document.querySelector('#err');
      const errorVisible = Boolean(err && getComputedStyle(err).display !== 'none' && String(err.textContent || '').trim());
      const truthText = String(document.querySelector('#truth')?.innerText || '');
      const projectText = String(document.querySelector('#projects')?.innerText || '');
      const nextText = String(document.querySelector('#next')?.innerText || '');
      const summaryCount = document.querySelectorAll('#summary .row').length;
      const projectCount = document.querySelectorAll('#projects .row').length;
      const liveBuild = fetch('/pwa/version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
      return Promise.resolve(liveBuild).then(build => ({
        errorVisible,
        errorText: String(err?.textContent || '').trim(),
        summaryCount,
        projectCount,
        truthText,
        projectText,
        nextText,
        updatedText: String(document.querySelector('#updated')?.textContent || ''),
        liveBuildSha: String(build?.build || '')
      }));
    });
    if (boardInitial.errorVisible) throw new Error('reality_board_api_load_failed_' + boardInitial.errorText.slice(0, 300));
    if (boardInitial.summaryCount < 4 || boardInitial.projectCount !== 3) throw new Error('reality_board_project_coverage_failed');
    if (!boardInitial.liveBuildSha) throw new Error('reality_board_live_build_sha_missing');
    if (process.env.RWHT_CERT_SHA && boardInitial.liveBuildSha !== process.env.RWHT_CERT_SHA) {
      throw new Error('reality_board_live_sha_mismatch_expected_' + process.env.RWHT_CERT_SHA + '_actual_' + boardInitial.liveBuildSha);
    }
    if (!boardInitial.projectText.includes('ARIA') || !boardInitial.projectText.includes('CuevaCoin') || !boardInitial.projectText.includes('BattleCruiser')) throw new Error('reality_board_human_project_labels_missing');
    if (!boardInitial.truthText.includes('ARIA · versión desplegada') || !boardInitial.truthText.includes('Projects + ARTIA')) throw new Error('reality_board_truth_sources_missing');
    if (!boardInitial.nextText.includes('CuevaCoin') || !boardInitial.nextText.includes('BattleCruiser')) throw new Error('reality_board_human_next_actions_missing');
    if (!boardInitial.truthText.includes(boardInitial.liveBuildSha)) throw new Error('reality_board_live_sha_not_rendered');
    if (!boardInitial.truthText.includes('HISTÓRICO') && !boardInitial.truthText.includes('NO CONFIRMADO')) throw new Error('reality_board_uncertainty_not_rendered');

    const initialBoardApiCount = boardApiResponses.length;
    if (initialBoardApiCount < 4) throw new Error('reality_board_initial_load_did_not_query_all_project_sources');
    await page.getByRole('button', { name: 'Actualizar ahora' }).click();
    const refreshDeadline = Date.now() + 30000;
    while (Date.now() < refreshDeadline && boardApiResponses.length - initialBoardApiCount < 4) await waitFor(250);
    await waitFor(500);
    page.off('response', onBoardResponse);
    const manualRefreshResponses = boardApiResponses.slice(initialBoardApiCount);
    if (manualRefreshResponses.length < 4) throw new Error('reality_board_manual_refresh_did_not_query_all_project_sources');
    const badBoardReads = [...boardApiResponses, ...manualRefreshResponses].filter(x => x.status !== 200);
    if (badBoardReads.length) throw new Error('reality_board_project_api_read_failed_' + JSON.stringify(badBoardReads.slice(0, 8)));
    report.reality_board = {
      url: boardUrl,
      verified: true,
      live_build_sha: boardInitial.liveBuildSha,
      projects: ['aria', 'cuevacoin', 'battlecruiser'],
      summary_cards: boardInitial.summaryCount,
      project_cards: boardInitial.projectCount,
      truth_section_rendered: true,
      human_next_actions_rendered: true,
      initial_api_responses: boardApiResponses.slice(0, initialBoardApiCount),
      manual_refresh_api_responses: manualRefreshResponses,
      source_policy: 'CuevaCoin historical is never called LIVE; source ARTIA preview is not equated with project runtime',
      updated_text: boardInitial.updatedText
    };
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'reality-board-final.png'), fullPage: true }).catch(() => {});

    const isKnownExternalPreviewError = (item) => /https:\/\/battlecruiser\.robvg9\.workers\.dev\//i.test(String(item?.stack || ''));
    report.external_preview_page_errors = pageErrors.filter(isKnownExternalPreviewError);
    const inScopePageErrors = STEPS_7_8_ONLY ? pageErrors.filter((item) => !isKnownExternalPreviewError(item)) : pageErrors;
    if (consoleErrors.length) throw new Error('projects_console_errors_' + consoleErrors.length);
    if (inScopePageErrors.length) throw new Error('projects_page_errors_' + inScopePageErrors.length);
    if (failedResponses.length) throw new Error('projects_failed_responses_' + failedResponses.length);

    const persistedChats = report.projects.length === PROJECTS.length
      && new Set(report.projects.map((project) => project.chat?.conversation_id)).size === PROJECTS.length
      && report.projects.every((project) => project.chat?.server_persistence_verified === true && project.chat?.reload_persistence_verified === true);
    const exactRealityBoard = report.reality_board?.verified === true
      && Boolean(process.env.RWHT_CERT_SHA)
      && report.reality_board.live_build_sha === process.env.RWHT_CERT_SHA;
    report.steps_7_8 = {
      step_7: { status: exactRealityBoard ? 'PASS' : 'FAIL', live_build_sha: report.reality_board?.live_build_sha || null, expected_sha: process.env.RWHT_CERT_SHA || null, reality_board_verified: report.reality_board?.verified === true },
      step_8: { status: report.auth_verified && report.reload_auth_verified && persistedChats ? 'PASS' : 'FAIL', authenticated: report.auth_verified, reload_auth_verified: report.reload_auth_verified, projects_with_persisted_chat: report.projects.filter((project) => project.chat?.server_persistence_verified && project.chat?.reload_persistence_verified).length, distinct_conversations: new Set(report.projects.map((project) => project.chat?.conversation_id)).size },
      phase_total: 'OPEN; later steps remain independent gates'
    };
    if (STEPS_7_8_ONLY && (!exactRealityBoard || !persistedChats)) throw new Error('steps_7_8_acceptance_contract_failed');
    report.reload_auth_verified = true;
    report.verified = true;
  } catch (error) {
    report.failure = String(error?.message || error).slice(0, 1500);
  } finally {
    report.finished_at = new Date().toISOString();
    report.console_errors = consoleErrors.slice(0, 100);
    report.external_preview_console_errors = externalPreviewConsoleErrors.slice(0, 100);
    report.page_errors = pageErrors.slice(0, 100);
    report.failed_responses = failedResponses.slice(0, 100);
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'projects-rwht-report.json'), JSON.stringify(report, null, 2));
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'projects-final.png'), fullPage: true }).catch(() => {});
    await context.close();
    await browser.close();
  }

  console.log(JSON.stringify({
    status: report.verified ? 'verified' : 'failed',
    auth_verified: report.auth_verified,
    reload_auth_verified: report.reload_auth_verified,
    projects_verified: report.projects.length + '/' + PROJECTS.length,
    conversation_ids_isolated: new Set(report.projects.map((project) => project.chat.conversation_id)).size === report.projects.length,
    visual_missions_verified: (report.visual_missions || []).filter((x) => x?.mission_id).length + '/' + PROJECTS.length,
    visual_mission_verified: Boolean(report.visual_mission?.mission_id),
    png_persisted: Boolean(report.visual_mission?.image_path),
    canonical_queue: report.visual_mission?.queue || null,
    page_errors: report.page_errors.length,
    console_errors: report.console_errors.length,
    external_preview_console_errors: report.external_preview_console_errors.length,
    failed_responses: report.failed_responses.length,
    failure: report.failure
  }, null, 2));

  if (!report.verified) process.exitCode = 2;
}

run().catch((error) => {
  console.error('[ARIA-PROJECTS-RWHT] fatal:', String(error?.message || error));
  process.exitCode = 1;
});

// Final universal certification trigger: authenticated Projects RWHT on canonical HEAD.

// Final universal certification trigger: Projects RWHT on canonical HEAD.
