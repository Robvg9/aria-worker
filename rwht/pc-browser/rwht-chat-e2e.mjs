#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'aria-chat-rwht-e2e-v1.0.7';
const BASE_URL = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/#.*$/, '');
const EMAIL = String(process.env.RWHT_EMAIL || '');
const PASSWORD = String(process.env.RWHT_PASSWORD || '');
const STORAGE_STATE = process.env.RWHT_STORAGE_STATE || '';
const EXPECTED_AUTH_TEXT = String(process.env.RWHT_EXPECTED_AUTH_TEXT || 'Núcleo conectado');
const TIMEOUT_MS = Number(process.env.RWHT_TIMEOUT_MS || 90000);
const SETTLE_MS = Number(process.env.RWHT_SETTLE_MS || 1500);
const ARTIFACT_DIR = process.env.RWHT_ARTIFACT_DIR || path.resolve(process.cwd(), 'chat-rwht-artifacts');
const ANON = 'sb_publishable_E2AmZNo2hAbOYlytkVbyBQ_X7JH0HPw';

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signInViaAuthApi() {
  if (!EMAIL || !PASSWORD) return null;
  const endpoints = [
    BASE_URL.replace(/\/$/, '') + '/auth/token?grant_type=password',
    'https://icuqsstxfdbvjytkhlog.supabase.co/auth/v1/token?grant_type=password'
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: ANON, accept: 'application/json' },
        body: JSON.stringify({ email: EMAIL.trim(), password: PASSWORD }),
        cache: 'no-store'
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
    } catch {}
  }
  return null;
}

async function login(page) {
  if (STORAGE_STATE) return { mode: 'storage_state', status: 'loaded' };
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

async function readSession(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('aria_session_v2');
      const session = raw ? JSON.parse(raw) : null;
      return session && typeof session.accessToken === 'string'
        ? { accessToken: session.accessToken, userId: String(session.userId || ''), conversationId: null }
        : null;
    } catch {
      return null;
    }
  });
}

async function readServerConversation(page, accessToken) {
  return page.evaluate(async (token) => {
    const response = await fetch('/api/conversation', {
      headers: { authorization: 'Bearer ' + token },
      cache: 'no-store'
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }, accessToken);
}

async function checkChatUx(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.chatScreen');
    if (!root) return { error: 'chat_surface_missing' };
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollWidth = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth);
    const unnamedInteractive = [];
    const offscreenInteractive = [];
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
      if (!name && rect.width > 0 && rect.height > 0) unnamedInteractive.push({ tag: element.tagName, id: element.id || null });
      if (rect.width > 0 && rect.height > 0) {
        const outside = rect.right <= 0 || rect.left >= viewportWidth || rect.bottom <= 0 || rect.top >= viewportHeight;
        const huge = rect.width > viewportWidth * 1.2 || rect.height > viewportHeight * 1.2;
        if (outside || huge) offscreenInteractive.push({ tag: element.tagName, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      }
    }
    const unlabeledInputs = [...root.querySelectorAll('input,textarea,select')]
      .filter((element) => !['hidden','password','file'].includes(String(element.getAttribute('type') || '').toLowerCase()))
      .filter((element) => {
        if ((element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || '').trim()) return false;
        if ((element.getAttribute('placeholder') || '').trim()) return false;
        if (element.id && [...document.querySelectorAll('label')].some((label) => label.htmlFor === element.id)) return false;
        return true;
      })
      .map((element) => ({ tag: element.tagName, id: element.id || null }));
    return {
      horizontal_overflow: scrollWidth > viewportWidth + 2,
      body_scroll_width: scrollWidth,
      unnamed_interactive: unnamedInteractive,
      offscreen_interactive: offscreenInteractive,
      unlabeled_inputs: unlabeledInputs
    };
  });
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const bootstrapSession = await signInViaAuthApi();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(!EMAIL || !PASSWORD ? (STORAGE_STATE ? { storageState: STORAGE_STATE } : {}) : {})
  });
  if (bootstrapSession) {
    await context.addInitScript((session) => {
      localStorage.setItem('aria_session_v2', JSON.stringify(session));
    }, bootstrapSession);
  }
  const page = await context.newPage();
  const pageErrors = [];
  const failedResponses = [];
  const consoleErrors = [];
  let conversation5xxError = null;
  let conversation5xxReject;
  const conversation5xxPromise = new Promise((_, reject) => { conversation5xxReject = reject; });

  page.on('pageerror', (error) => pageErrors.push({ message: String(error?.message || error).slice(0, 1000) }));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ text: message.text().slice(0, 1000) });
  });
  page.on('response', async (response) => {
    if (response.status() >= 500) {
      const failure = { status: response.status(), method: response.request().method(), url: response.url().slice(0, 1000) };
      if (failure.url.includes('/api/conversation')) {
        try {
          failure.body = (await response.text()).slice(0, 5000);
        } catch {}
        conversation5xxError = failure;
        conversation5xxReject(new Error('chat_conversation_http_5xx'));
      }
      failedResponses.push(failure);
    }
  });

  const startedAt = new Date().toISOString();
  const base = BASE_URL;
  let loginResult = null;
  let authVerified = false;
  let ux = null;
  let localPersistence = null;
  let serverPersistence = null;
  let reloadPersistence = null;
  let responseText = '';
  let marker = '';
  let result = 'failed';
  let failure = null;

  try {
    await page.goto(base + '#home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitFor(SETTLE_MS);
    loginResult = await login(page);
    await page.waitForFunction(
      () => !document.querySelector('input[type="password"]') &&
        (Boolean(document.querySelector('.dashboardScreen')) || Boolean(document.querySelector('.chatScreen'))),
      null,
      { timeout: 60000 }
    );
    const session = await readSession(page);
    if (!session?.accessToken || !session.userId) throw new Error('authenticated_session_not_persisted');
    authVerified = true;

    await page.goto(base + '#chat', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.chatScreen .chatWindow', { state: 'visible', timeout: 60000 });
    await page.waitForSelector('.chatScreen textarea[placeholder="Habla con ARIA…"]', { state: 'visible', timeout: 30000 });
    await waitFor(SETTLE_MS);

    ux = await checkChatUx(page);
    if (ux.error) throw new Error(ux.error);
    if (ux.horizontal_overflow || ux.unnamed_interactive.length || ux.offscreen_interactive.length || ux.unlabeled_inputs.length) {
      throw new Error('chat_ux_contract_failed');
    }

    const textarea = page.locator('.chatScreen textarea[placeholder="Habla con ARIA…"]').first();
    const sendButton = page.getByRole('button', { name: /Enviar mensaje|Enviando mensaje/ }).first();
    await textarea.fill('RWHT Chat: mensaje de certificación real.');
    if (!(await sendButton.isEnabled())) throw new Error('chat_send_button_not_enabled_after_input');

    const beforeAssistant = await page.locator('.chatScreen .bubble.aria').count();
    marker = 'RWHTCHATCERT' + Date.now();
    await textarea.fill(marker + ' responde con una confirmación breve.');
    await sendButton.click();

    await page.locator('.chatScreen .bubble.user').filter({ hasText: marker }).waitFor({ state: 'visible', timeout: 30000 });
    await Promise.race([
      page.waitForFunction(
        ({ before }) => document.querySelectorAll('.chatScreen .bubble.aria').length > before,
        { before: beforeAssistant },
        { timeout: TIMEOUT_MS }
      ),
      conversation5xxPromise
    ]);

    const assistant = page.locator('.chatScreen .bubble.aria').last();
    responseText = (await assistant.innerText()).trim();
    if (!responseText) throw new Error('chat_assistant_response_empty');
    if (/error comunicando|no se pudo|fall[oó] al|conversation_/i.test(responseText)) throw new Error('chat_assistant_response_is_error');
    if (await page.locator('.chatScreen .errorBox').count()) throw new Error('chat_error_box_visible');

    await page.waitForFunction(
      ({ markerValue }) => {
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i) || '';
          if (!key.startsWith('aria-chat-history-v1:')) continue;
          try {
            const parsed = JSON.parse(localStorage.getItem(key) || 'null');
            if (parsed?.messages?.some((m) => typeof m?.text === 'string' && m.text.includes(markerValue))) {
              return true;
            }
          } catch {}
        }
        return false;
      },
      { markerValue: marker },
      { timeout: 30000 }
    );
    const stored = await page.evaluate(({ markerValue }) => {
      const matches = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i) || '';
        if (!key.startsWith('aria-chat-history-v1:')) continue;
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || 'null');
          if (parsed?.messages?.some((m) => typeof m?.text === 'string' && m.text.includes(markerValue))) {
            matches.push({ key, conversationId: parsed.conversationId || null });
          }
        } catch {}
      }
      return matches;
    }, { markerValue: marker });
    localPersistence = stored;
    if (!stored.length) throw new Error('chat_local_persistence_missing');

    const autoScroll = await page.locator('[data-testid="chat-window"]').evaluate((node) =>
      node.scrollHeight <= node.clientHeight + 8 || node.scrollTop + node.clientHeight >= node.scrollHeight - 8
    ).catch(() => false);
    if (!autoScroll) throw new Error('chat_auto_scroll_missing');

    serverPersistence = await readServerConversation(page, session.accessToken);
    if (serverPersistence.status !== 200) throw new Error('chat_server_conversation_status_' + serverPersistence.status);
    const serverMessages = Array.isArray(serverPersistence.body?.conversation?.messages)
      ? serverPersistence.body.conversation.messages
      : [];
    if (!serverMessages.some((m) => typeof m?.content === 'string' && m.content.includes(marker))) {
      throw new Error('chat_server_persistence_missing');
    }

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.chatScreen .chatWindow', { state: 'visible', timeout: 60000 });
    const semanticResponseText = responseText.replace(/\n\s*Procesado en\b[\s\S]*$/i, '').trim();
    await page.waitForFunction(
      ({ markerValue, expectedResponse }) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const userVisible = [...document.querySelectorAll('.chatScreen .bubble.user')]
          .some((node) => normalize(node.textContent).includes(normalize(markerValue)));
        const assistantVisible = [...document.querySelectorAll('.chatScreen .bubble.aria')]
          .some((node) => normalize(node.textContent).includes(normalize(expectedResponse)));
        return userVisible && assistantVisible;
      },
      { markerValue: marker, expectedResponse: semanticResponseText },
      { timeout: 60000 }
    );
    reloadPersistence = await page.locator('.chatScreen .bubble.aria').evaluateAll(
      (nodes, expectedResponse) => {
        const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
        const expected = normalize(expectedResponse);
        return nodes.filter((node) => normalize(node.textContent).includes(expected)).length;
      },
      semanticResponseText
    );
    if (!reloadPersistence) throw new Error('chat_reload_persistence_missing');

    if (consoleErrors.length) throw new Error('chat_console_errors_' + consoleErrors.length);
    if (pageErrors.length) throw new Error('chat_page_errors_' + pageErrors.length);
    if (failedResponses.length) throw new Error('chat_failed_responses_' + failedResponses.length);

    result = 'verified';
  } catch (error) {
    failure = String(error?.message || error).slice(0, 1200);
  }

  const report = {
    version: VERSION,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    target: base + '#chat',
    auth_verified: authVerified,
    login: loginResult,
    marker,
    response_text: responseText.slice(0, 4000),
    local_persistence: localPersistence,
    server_persistence: serverPersistence ? {
      status: serverPersistence.status,
      ok: serverPersistence.body?.ok === true,
      conversation_id: serverPersistence.body?.conversation_id || null
    } : null,
    reload_persistence: reloadPersistence,
    ux,
    console_errors: consoleErrors.slice(0, 100),
    page_errors: pageErrors.slice(0, 100),
    failed_responses: failedResponses.slice(0, 100),
    verified: result === 'verified',
    failure
  };
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'chat-rwht-report.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'chat-final.png'), fullPage: true }).catch(() => {});
  await context.close();
  await browser.close();

  console.log(JSON.stringify({
    status: report.verified ? 'verified' : 'failed',
    target: report.target,
    auth_verified: report.auth_verified,
    ux_issues: report.ux ? (report.ux.unnamed_interactive.length + report.ux.offscreen_interactive.length + report.ux.unlabeled_inputs.length + Number(report.ux.horizontal_overflow)) : null,
    response_verified: Boolean(responseText),
    local_persistence_verified: Boolean(localPersistence?.length),
    server_persistence_verified: Boolean(serverPersistence?.status === 200),
    reload_persistence_verified: Boolean(reloadPersistence),
    page_errors: report.page_errors.length,
    failed_responses: report.failed_responses.length,
    failure: report.failure
  }, null, 2));

  if (!report.verified) process.exitCode = 2;
}

run().catch((error) => {
  console.error('[ARIA-CHAT-RWHT] fatal:', String(error?.message || error));
  process.exitCode = 1;
});
