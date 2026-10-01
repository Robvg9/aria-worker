#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'aria-persistence-recovery-rwht-e2e-v1.0.1';
const BASE_URL = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/#.*$/, '');
const EMAIL = String(process.env.RWHT_EMAIL || '');
const PASSWORD = String(process.env.RWHT_PASSWORD || '');
const STORAGE_STATE = process.env.RWHT_STORAGE_STATE || '';
const TIMEOUT_MS = Number(process.env.RWHT_TIMEOUT_MS || 90000);
const ARTIFACT_DIR = process.env.RWHT_ARTIFACT_DIR || path.resolve(process.cwd(), 'persistence-recovery-rwht-artifacts');

const SESSION_KEY = 'aria_session_v2';
const CACHE_PREFIX = 'aria-runtime-cache-v3';
const CHAT_PREFIX = 'aria-chat-history-v1:';

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function evaluateWithNavigationRetry(page, callback, argument) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await page.evaluate(callback, argument);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (!/execution context was destroyed|cannot find context with specified id/i.test(message)) throw error;
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
      await waitFor(150);
    }
  }
  throw lastError;
}

async function login(page) {
  await page.waitForFunction(
    () => Boolean(document.querySelector('.dashboardScreen')) || Boolean(document.querySelector('input[type="password"]')),
    null,
    { timeout: 30000 }
  );
  const dashboardVisible = await page.locator('.dashboardScreen').isVisible().catch(() => false);
  if (dashboardVisible) return { mode: STORAGE_STATE ? 'storage_state' : 'existing_session', status: 'authenticated' };
  if (!EMAIL || !PASSWORD) throw new Error('authenticated_session_source_missing');

  const email = page.locator('input[type="email"],input[name="email"],input[autocomplete="username"]').first();
  const password = page.locator('input[type="password"],input[name="password"],input[autocomplete="current-password"]').first();
  await email.waitFor({ state: 'visible', timeout: 30000 });
  await password.waitFor({ state: 'visible', timeout: 30000 });
  await email.fill(EMAIL);
  await password.fill(PASSWORD);

  const submit = page.locator('button[type="submit"],input[type="submit"],button')
    .filter({ hasText: /entrar|iniciar|login|sign[ -]?in|continuar|acceder/i })
    .first();
  if (await submit.count()) await submit.click();
  else await password.press('Enter');

  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 60000 });
  return { mode: 'password', status: 'submitted' };
}

async function readStoredSession(page) {
  return evaluateWithNavigationRetry(page, key => {
    try {
      const raw = localStorage.getItem(key);
      const s = raw ? JSON.parse(raw) : null;
      if (!s || typeof s.accessToken !== 'string' || typeof s.userId !== 'string') return null;
      return {
        userId: s.userId,
        expiresAt: Number(s.expiresAt || 0),
        accessTokenPresent: Boolean(s.accessToken),
        refreshTokenPresent: Boolean(s.refreshToken),
        emailPresent: Boolean(s.email)
      };
    } catch {
      return null;
    }
  }, SESSION_KEY);
}

async function readStateSnapshot(page) {
  return evaluateWithNavigationRetry(page, ({sessionKey, cachePrefix, chatPrefix}) => {
    const localKeys = [];
    for (let i = 0; i < localStorage.length; i += 1) localKeys.push(localStorage.key(i) || '');
    const session = (() => {
      try {
        const raw = localStorage.getItem(sessionKey);
        const s = raw ? JSON.parse(raw) : null;
        return s ? {
          userId: String(s.userId || ''),
          expiresAt: Number(s.expiresAt || 0),
          accessTokenPresent: Boolean(s.accessToken),
          refreshTokenPresent: Boolean(s.refreshToken)
        } : null;
      } catch { return null; }
    })();
    const cache = {};
    for (const kind of ['system', 'capabilities', 'active_mission', 'meditation_overview']) {
      const key = cachePrefix + ':' + String(session?.userId || '') + ':' + kind;
      cache[kind] = Boolean(localStorage.getItem(key));
    }
    const chat = localKeys.filter(key => key.startsWith(chatPrefix)).map(key => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        return { key, messages: Array.isArray(parsed?.messages) ? parsed.messages.length : 0, savedAt: Number(parsed?.savedAt || 0) };
      } catch {
        return { key, messages: 0, savedAt: 0 };
      }
    });
    return { session, cache, chat };
  }, { sessionKey: SESSION_KEY, cachePrefix: CACHE_PREFIX, chatPrefix: CHAT_PREFIX });
}

async function readConversation(page, token) {
  return evaluateWithNavigationRetry(page, async accessToken => {
    const response = await fetch('/api/conversation', {
      headers: { authorization: 'Bearer ' + accessToken },
      cache: 'no-store'
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }, token);
}

async function assertDashboard(page) {
  await page.waitForSelector('.dashboardScreen', { state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 30000 });
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {})
  });
  const page = await context.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  const requestFailures = [];
  const authRefreshResponses = [];
  let expectedRecoveryAbortErrors = false;

  page.on('pageerror', error => pageErrors.push({ message: String(error?.message || error).slice(0, 1200) }));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text().slice(0, 1200);
    if (expectedRecoveryAbortErrors && ( /Failed to load resource: net::ERR_FAILED/i.test(text) || /Failed to load resource: the server responded with a status of 401 \(\)/i.test(text) )) return;
    consoleErrors.push({ text });
  });
  page.on('response', response => {
    const responseUrl = new URL(response.url());
    if (responseUrl.pathname.endsWith('/auth/token') || responseUrl.pathname.endsWith('/auth/v1/token')) {
      void response.json().then(body => authRefreshResponses.push({
        path: responseUrl.pathname,
        grant_type: responseUrl.searchParams.get('grant_type'),
        status: response.status(),
        error: typeof body?.error === 'string' ? body.error.slice(0, 120) : null,
        error_description: typeof body?.error_description === 'string' ? body.error_description.slice(0, 200) : null
      })).catch(() => authRefreshResponses.push({
        path: responseUrl.pathname,
        grant_type: responseUrl.searchParams.get('grant_type'),
        status: response.status(),
        body_parse_failed: true
      }));
    }
    if (response.status() >= 500) {
      failedResponses.push({
        status: response.status(),
        method: response.request().method(),
        url: response.url().slice(0, 1200)
      });
    }
  });
  page.on('requestfailed', request => {
    requestFailures.push({
      method: request.method(),
      url: request.url().slice(0, 1200),
      error: request.failure()?.errorText || 'unknown'
    });
  });

  const report = {
    version: VERSION,
    started_at: new Date().toISOString(),
    target: BASE_URL,
    auth_verified: false,
    initial_session: null,
    initial_cache: null,
    reload_session: null,
    refresh: null,
    chat: {
      marker: '',
      response_text: '',
      local_persistence_verified: false,
      server_persistence_status: null,
      server_persistence_verified: false,
      reload_persistence_verified: false
    },
    recovery: {
      simulated_api_failure: false,
      dashboard_survived_api_failure: false,
      session_survived_api_failure: false,
      live_sync_recovered: false
    },
    console_errors: [],
    page_errors: [],
    failed_responses: [],
    request_failures: [],
    auth_refresh_responses: [],
    verified: false,
    failure: null
  };

  try {
    await page.goto(BASE_URL + '#home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(1200);
    report.login = await login(page);

    await assertDashboard(page);
    await waitFor(500);
    await assertDashboard(page);
    const session = await readStoredSession(page);
    if (!session?.userId || !session.accessTokenPresent || !session.refreshTokenPresent) {
      throw new Error('session_not_persisted_after_login');
    }
    report.auth_verified = true;
    report.initial_session = session;

    await page.waitForFunction(({prefix, userId}) => {
      return Boolean(localStorage.getItem(prefix + ':' + userId + ':system'));
    }, { prefix: CACHE_PREFIX, userId: session.userId }, { timeout: 30000 });
    report.initial_cache = await readStateSnapshot(page);
    if (!report.initial_cache.cache.system) throw new Error('system_cache_not_persisted');

    const refreshedBaseline = report.initial_session.expiresAt;
    const forcedExpiry = Date.now() + 65000;
    await evaluateWithNavigationRetry(page, ({key, expiry}) => {
      const raw = localStorage.getItem(key);
      const s = raw ? JSON.parse(raw) : null;
      if (!s) throw new Error('session_missing_before_refresh_probe');
      s.expiresAt = expiry;
      localStorage.setItem(key, JSON.stringify(s));
    }, { key: SESSION_KEY, expiry: forcedExpiry });

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await assertDashboard(page);

    let refreshedSession = null;
    const refreshDeadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < refreshDeadline) {
      const current = await readStoredSession(page);
      if (current && current.expiresAt > forcedExpiry + 120000) {
        refreshedSession = current;
        break;
      }
      await waitFor(1000);
    }
    if (!refreshedSession) throw new Error('session_refresh_not_repersisted');
    if (refreshedSession.userId !== session.userId) throw new Error('session_refresh_changed_user');

    report.refresh = {
      baseline_expires_at: refreshedBaseline,
      forced_expires_at: forcedExpiry,
      refreshed_expires_at: refreshedSession.expiresAt,
      expiry_advanced_ms: refreshedSession.expiresAt - forcedExpiry,
      user_id_stable: true
    };

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await assertDashboard(page);
    report.reload_session = await readStoredSession(page);
    if (!report.reload_session?.userId || report.reload_session.userId !== session.userId) {
      throw new Error('session_reload_persistence_missing');
    }

    await page.goto(BASE_URL + '#chat', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.chatScreen .chatWindow', { state: 'visible', timeout: 60000 });
    const accessToken = await evaluateWithNavigationRetry(page, key => {
      const s = JSON.parse(localStorage.getItem(key) || 'null');
      return s?.accessToken || '';
    }, SESSION_KEY);
    if (!accessToken) throw new Error('access_token_missing_for_chat');

    const marker = 'RWHTPERSIST' + Date.now();
    report.chat.marker = marker;
    const input = page.locator('.chatScreen textarea[placeholder="Habla con ARIA…"]').first();
    const send = page.getByRole('button', { name: /Enviar mensaje|Enviando mensaje/ }).first();
    await input.fill(marker + ' responde con una confirmación breve.');
    if (!(await send.isEnabled())) throw new Error('chat_send_button_not_enabled');
    const before = await page.locator('.chatScreen .bubble.aria').count();
    const chatPostResponsePromise = page.waitForResponse(response => {
      const pathname = new URL(response.url()).pathname.replace(/\/+$/, '');
      return response.request().method() === 'POST' && pathname === '/api/conversation';
    }, { timeout: TIMEOUT_MS });
    await send.click();

    await page.waitForFunction(
      ({beforeCount, markerValue}) =>
        document.querySelectorAll('.chatScreen .bubble.aria').length > beforeCount &&
        [...document.querySelectorAll('.chatScreen .bubble.user')].some(node => String(node.textContent || '').includes(markerValue)),
      { beforeCount: before, markerValue: marker },
      { timeout: TIMEOUT_MS }
    );

    const chatPostResponse = await chatPostResponsePromise;
    const chatPostBody = await chatPostResponse.json().catch(() => null);
    const canonicalAssistantText = typeof chatPostBody?.parts?.find?.(part => part?.type === 'text')?.text === 'string'
      ? chatPostBody.parts.find(part => part.type === 'text').text.trim()
      : '';
    if (!canonicalAssistantText) throw new Error('chat_post_response_missing_assistant_text');

    report.chat.response_text = canonicalAssistantText;
    report.chat.ui_response_text = (await page.locator('.chatScreen .bubble.aria').last().innerText()).trim();
    if (!report.chat.ui_response_text) throw new Error('chat_response_empty');

    report.chat.post_response = {
      status: chatPostResponse.status(),
      conversationId: typeof chatPostBody?.conversationId === 'string' ? chatPostBody.conversationId : null,
      error: typeof chatPostBody?.error === 'string' ? chatPostBody.error : null,
      cognitive: chatPostBody?.cognitive && typeof chatPostBody.cognitive === 'object' ? {
        input_persistence_ms: chatPostBody.cognitive.input_persistence_ms ?? null,
        assistant_persistence_ms: chatPostBody.cognitive.assistant_persistence_ms ?? null,
        persistence_warning: chatPostBody.cognitive.persistence_warning ?? null,
        processing_ms: chatPostBody.cognitive.processing_ms ?? null
      } : null
    };

    await page.waitForFunction(
      ({responseValue}) => {
        const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
        return [...document.querySelectorAll('.chatScreen .bubble.aria')]
          .some(node => normalize(node.textContent).includes(normalize(responseValue)));
      },
      { responseValue: canonicalAssistantText },
      { timeout: TIMEOUT_MS }
    );

    await page.waitForFunction(
      ({prefix, markerValue}) => {
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i) || '';
          if (!key.startsWith(prefix)) continue;
          try {
            const parsed = JSON.parse(localStorage.getItem(key) || 'null');
            if (parsed?.messages?.some(m => typeof m?.text === 'string' && m.text.includes(markerValue))) return true;
          } catch {}
        }
        return false;
      },
      { prefix: CHAT_PREFIX, markerValue: marker },
      { timeout: 30000 }
    );
    report.chat.local_persistence_verified = true;

    const expectedAssistantText = canonicalAssistantText.replace(/\n\s*Procesado en\b[\s\S]*$/i, '').trim();
    let server = null;
    let serverMessages = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      server = await readConversation(page, accessToken);
      serverMessages = Array.isArray(server.body?.conversation?.messages) ? server.body.conversation.messages : [];
      const userSaved = serverMessages.some(m => m?.role === 'user' && typeof m?.content === 'string' && m.content.includes(marker));
      const assistantSaved = serverMessages.some(m => m?.role === 'assistant' && typeof m?.content === 'string' && m.content.includes(expectedAssistantText));
      if (userSaved && assistantSaved) break;
      if (attempt < 5) await waitFor(1000);
    }
    report.chat.server_persistence_status = server?.status ?? null;
    report.chat.server_conversation_id = server?.body?.conversation_id ?? null;
    report.chat.server_message_count = serverMessages.length;
    report.chat.server_message_roles = serverMessages.map(m => String(m?.role ?? '')).slice(-8);
    report.chat.server_persistence_verified =
      server?.status === 200 && serverMessages.some(m => m?.role === 'user' && typeof m?.content === 'string' && m.content.includes(marker));
    report.chat.server_assistant_persistence_verified =
      server?.status === 200 && serverMessages.some(m => m?.role === 'assistant' && typeof m?.content === 'string' && m.content.includes(expectedAssistantText));
    if (!report.chat.server_persistence_verified) throw new Error('chat_server_persistence_missing');
    if (!report.chat.server_assistant_persistence_verified) throw new Error('chat_server_assistant_persistence_missing');

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.chatScreen .chatWindow', { state: 'visible', timeout: 60000 });
    const semanticResponseText = report.chat.response_text.replace(/\n\s*Procesado en\b[\s\S]*$/i, '').trim();
    await page.waitForFunction(
      ({markerValue, responseValue}) => {
        const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
        const userOk = [...document.querySelectorAll('.chatScreen .bubble.user')].some(node => normalize(node.textContent).includes(normalize(markerValue)));
        const assistantOk = [...document.querySelectorAll('.chatScreen .bubble.aria')].some(node => normalize(node.textContent).includes(normalize(responseValue)));
        return userOk && assistantOk;
      },
      { markerValue: marker, responseValue: semanticResponseText },
      { timeout: 60000 }
    );
    report.chat.reload_persistence_verified = true;

    await page.goto(BASE_URL + '#home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await assertDashboard(page);
    const beforeRecovery = await readStateSnapshot(page);
    if (!beforeRecovery.cache.system) throw new Error('system_cache_missing_before_recovery');

    expectedRecoveryAbortErrors = true;
    await page.route('**/api/system*', route => route.abort('failed'));
    await page.route('**/api/missions*', route => route.abort('failed'));
    report.recovery.simulated_api_failure = true;

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await assertDashboard(page);
    const degradedSession = await readStoredSession(page);
    const dashboardText = await page.locator('.dashboardScreen').innerText();
    report.recovery.dashboard_survived_api_failure =
      Boolean(degradedSession?.userId === session.userId) && dashboardText.trim().length > 40;
    report.recovery.session_survived_api_failure = Boolean(degradedSession?.userId === session.userId);
    if (!report.recovery.dashboard_survived_api_failure) throw new Error('dashboard_recovery_from_api_failure_missing');
    if (!report.recovery.session_survived_api_failure) throw new Error('session_recovery_from_api_failure_missing');

    await page.unroute('**/api/system*');
    await page.unroute('**/api/missions*');
    expectedRecoveryAbortErrors = false;

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await assertDashboard(page);
    await page.waitForFunction(() => {
      const sub = document.querySelector('.topBar .sub');
      return Boolean(sub && sub.textContent?.includes('Núcleo conectado'));
    }, null, { timeout: 60000 });
    report.recovery.live_sync_recovered = true;

    if (pageErrors.length) throw new Error('runtime_page_errors_' + pageErrors.length);
    if (consoleErrors.length) throw new Error('runtime_console_errors_' + consoleErrors.length);
    if (failedResponses.length) throw new Error('real_http_5xx_' + failedResponses.length);

    report.verified = true;
  } catch (error) {
    report.failure = String(error?.message || error).slice(0, 1600);
  }

  report.finished_at = new Date().toISOString();
  report.console_errors = consoleErrors.slice(0, 100);
  report.page_errors = pageErrors.slice(0, 100);
  report.failed_responses = failedResponses.slice(0, 100);
  report.request_failures = requestFailures.slice(0, 100);
  report.auth_refresh_responses = authRefreshResponses.slice(0, 20);

  fs.writeFileSync(path.join(ARTIFACT_DIR, 'persistence-recovery-rwht-report.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'persistence-recovery-final.png'), fullPage: true }).catch(() => {});
  await context.close();
  await browser.close();

  console.log(JSON.stringify({
    status: report.verified ? 'verified' : 'failed',
    auth_verified: report.auth_verified,
    session_reload_verified: Boolean(report.reload_session?.userId),
    session_refresh_verified: Boolean(report.refresh?.expiry_advanced_ms),
    chat_local_persistence_verified: report.chat.local_persistence_verified,
    chat_server_persistence_verified: report.chat.server_persistence_verified,
    chat_reload_persistence_verified: report.chat.reload_persistence_verified,
    recovery_dashboard_verified: report.recovery.dashboard_survived_api_failure,
    recovery_live_sync_verified: report.recovery.live_sync_recovered,
    page_errors: report.page_errors.length,
    console_errors: report.console_errors.length,
    failed_responses: report.failed_responses.length,
    failure: report.failure,
    auth_refresh_responses: report.auth_refresh_responses
  }, null, 2));

  if (!report.verified) process.exitCode = 2;
}

run().catch(error => {
  console.error('[ARIA-PERSISTENCE-RECOVERY-RWHT] fatal:', String(error?.message || error));
  process.exitCode = 1;
});

// Final universal certification trigger: persistence/recovery contract aligned.
