#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'aria-projects-rwht-e2e-v1.1.1';
const BASE_URL = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/#.*$/, '');
const EMAIL = String(process.env.RWHT_EMAIL || '');
const PASSWORD = String(process.env.RWHT_PASSWORD || '');
const STORAGE_STATE = process.env.RWHT_STORAGE_STATE || '';
const TIMEOUT_MS = Number(process.env.RWHT_TIMEOUT_MS || 150000);
const SETTLE_MS = Number(process.env.RWHT_SETTLE_MS || 1200);
const ARTIFACT_DIR = process.env.RWHT_ARTIFACT_DIR || path.resolve(process.cwd(), 'projects-rwht-artifacts');
const PROJECTS = [
  { id: 'battlecruiser', name: 'BattleCruiser' },
  { id: 'cuevacoin', name: 'CuevaCoin' },
  { id: 'aria', name: 'ARIA' }
];

function waitFor(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function login(page) {
  if (STORAGE_STATE) return { mode: 'storage_state', status: 'loaded', attempts: 0 };
  if (!EMAIL || !PASSWORD) throw new Error('authenticated_session_source_missing');
  const maxAttempts = Math.max(1, Math.min(3, Number(process.env.RWHT_AUTH_ATTEMPTS || 3)));
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const email = page.locator('input[type="email"],input[name="email"],input[autocomplete="username"]').first();
    const password = page.locator('input[type="password"],input[name="password"],input[autocomplete="current-password"]').first();
    await email.waitFor({ state: 'visible', timeout: 30000 });
    await password.waitFor({ state: 'visible', timeout: 30000 });
    await email.fill(EMAIL);
    await password.fill(PASSWORD);
    const submit = page.locator('button[type="submit"],input[type="submit"],button')
      .filter({ hasText: /entrar|iniciar|login|sign[ -]?in|continuar|acceder/i }).first();
    if (await submit.count()) await submit.click();
    else await password.press('Enter');
    try {
      await page.waitForFunction(() => {
        const passwordVisible = !![...document.querySelectorAll('input[type="password"]')].find((el) => {
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
      return { mode: 'password', status: 'authenticated', attempts };
    } catch (error) {
      const visibleError = await page.locator('text=/servicio de autenticación|ninguna de sus rutas|tardando demasiado|no pudo alcanzar/i').first().textContent().catch(() => '');
      attempts.push({ attempt, status: 'failed', error: String(error?.message || error).slice(0, 300), visible_error: String(visibleError || '').slice(0, 300) });
      if (attempt < maxAttempts) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await waitFor(2000 * attempt);
      }
    }
  }
  throw new Error('authenticated_login_failed_after_' + maxAttempts + '_attempts:' + JSON.stringify(attempts).slice(0, 1200));
}

async function readSession(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('aria_session_v2');
      const session = raw ? JSON.parse(raw) : null;
      return session && typeof session.accessToken === 'string'
        ? { accessToken: session.accessToken, userId: String(session.userId || '') }
        : null;
    } catch { return null; }
  });
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
        if (outside || huge) offscreen.push({ tag: element.tagName, id: element.id || null, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
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
      unnamed_interactive: unnamed,
      offscreen_interactive: offscreen,
      unlabeled_inputs: unlabeled
    };
  });
}

async function expectEnabled(locator, projectId) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    if (await locator.isEnabled().catch(() => false)) return;
    await waitFor(500);
  }
  throw new Error('project_chat_send_not_enabled_' + projectId);
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
    const result = await readApi(page, token, '/projects/' + encodeURIComponent(projectId) + '/missions?limit=100');
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {})
  });
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
  page.on('pageerror', (error) => pageErrors.push({ message: String(error?.message || error).slice(0, 1000), url: page.url() }));
  page.on('response', (response) => {
    if (response.status() >= 500) failedResponses.push({ status: response.status(), method: response.request().method(), url: response.url().slice(0, 1200) });
  });

  const startedAt = new Date().toISOString();
  const report = {
    version: VERSION,
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
    report.login = await login(page);
    report.auth_attempts = Number(report.login?.attempts?.length || 0);
    const session = await readSession(page);
    if (!session?.accessToken || !session.userId) throw new Error('authenticated_session_not_persisted');
    report.auth_verified = true;

    const projectsApi = await readApi(page, session.accessToken, '/projects');
    if (projectsApi.status !== 200 || !Array.isArray(projectsApi.body?.projects)) throw new Error('projects_api_unavailable_' + projectsApi.status);
    report.project_count = projectsApi.body.projects.length;
    report.project_ids = projectsApi.body.projects.map((project) => String(project.id)).sort();
    if (report.project_count !== 3 || report.project_ids.join(',') !== 'aria,battlecruiser,cuevacoin') throw new Error('project_catalog_contract_failed');

    await page.goto(BASE_URL + '#projects', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.projectShell', { state: 'visible', timeout: 60000 });
    await waitFor(SETTLE_MS);

    report.ux = await checkUx(page);
    if (report.ux.error) throw new Error(report.ux.error);
    if (report.ux.horizontal_overflow || report.ux.unnamed_interactive.length || report.ux.offscreen_interactive.length || report.ux.unlabeled_inputs.length) {
      throw new Error('projects_ux_contract_failed');
    }

    const cards = page.locator('.projectGrid .projectCard');
    if (await cards.count() !== 3) throw new Error('project_card_count_failed');
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
      await send.waitFor({state:'visible',timeout:30000});
      await expectEnabled(send, project.id);
      const postResponsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST' && /\/api\/conversation(?:\?|$)/.test(response.url())
      , { timeout: TIMEOUT_MS });
      await send.click();
      const postResponse = await postResponsePromise;
      const postBody = await postResponse.json().catch(() => null);
      if (postResponse.status() !== 200 || !postBody?.ok) throw new Error('project_chat_post_failed_' + project.id + '_' + postResponse.status());
      if (!postBody?.conversationId) throw new Error('project_chat_post_conversation_id_missing_' + project.id);
      if (postBody?.cognitive?.persistence_warning) throw new Error('project_chat_persistence_warning_' + project.id + '_' + String(postBody.cognitive.persistence_warning));
      if (!Number.isFinite(Number(postBody?.cognitive?.input_persistence_ms))) throw new Error('project_chat_input_persistence_unconfirmed_' + project.id);
      if (!Number.isFinite(Number(postBody?.cognitive?.assistant_persistence_ms))) throw new Error('project_chat_assistant_persistence_unconfirmed_' + project.id);

      await page.locator('.projectChatWindow .bubble.user').filter({ hasText: marker }).waitFor({ state: 'visible', timeout: 30000 });
      const assistant = page.locator('.projectChatWindow .bubble.aria').last();
      await assistant.waitFor({ state: 'visible', timeout: TIMEOUT_MS });
      const responseText = (await assistant.innerText()).trim();
      if (!responseText || /error comunicando|no se pudo|fall[oó] al|conversation_/i.test(responseText)) throw new Error('project_chat_bad_response_' + project.id);

      let conversation = null;
      let messages = [];
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        conversation = await readApi(page, session.accessToken, '/projects/' + project.id + '/conversation');
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
      if (!conversationId || conversationId !== String(postBody.conversationId)) throw new Error('project_conversation_id_mismatch_' + project.id);

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.projectShell', { state: 'visible', timeout: 60000 });
      await waitForPersistedSession(page, session.userId);
      await page.waitForFunction(({ expected }) => {
        const card = [...document.querySelectorAll('.projectGrid .projectCard')].find((node) => node.textContent?.includes(expected));
        return Boolean(card?.classList.contains('selected'));
      }, { expected: project.name }, { timeout: 30000 });
      await page.waitForSelector('.projectChatWindow', { state: 'visible', timeout: 30000 });
      await page.waitForFunction(({ markerValue }) => [...document.querySelectorAll('.projectChatWindow .bubble.user')].some((node) => node.textContent?.includes(markerValue)), { markerValue: marker }, { timeout: 30000 });

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

    const battle = PROJECTS[0];
    await page.locator('.projectGrid .projectCard').filter({ hasText: battle.name }).first().click();
    await page.locator('.projectTabs .tabButton').filter({ hasText: 'ARTIA' }).click();
    await page.waitForSelector('.artiaPreviewShell', { state: 'visible', timeout: 30000 });
    const iframe = page.locator('.artiaPreviewShell iframe[title="PWA LIVE de BattleCruiser"]').first();
    if (await iframe.count() !== 1) throw new Error('battlecruiser_live_preview_missing');
    if (await iframe.getAttribute('src') !== 'https://battlecruiser.robvg9.workers.dev/') throw new Error('battlecruiser_live_preview_src_mismatch');

    await page.getByRole('button', { name: 'Pausar para pintar' }).click();
    await page.getByRole('button', { name: 'Rectángulo' }).click();
    const tools = ['Lápiz','Marcador','Línea','Rectángulo','Círculo','Flecha','Texto','Borrador'];
    for (const label of tools) {
      const button = page.getByRole('button', { name: label }).first();
      if (!(await button.count())) throw new Error('artia_tool_missing_' + label);
      await button.click();
      if (!(await button.evaluate((node) => node.classList.contains('selected')))) throw new Error('artia_tool_not_selectable_' + label);
    }
    await page.getByRole('button', { name: 'Rectángulo' }).click();
    const fixture = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xq8YQwAAAABJRU5ErkJggg==';
    await page.locator('.fileButton input[type="file"]').setInputFiles({ name: 'artia-reference.png', mimeType: 'image/png', buffer: Buffer.from(fixture, 'base64') });
    await page.getByText('Referencia cargada').waitFor({ state: 'visible', timeout: 10000 });
    const instructionMarker = 'RWHTARTIA' + Date.now();
    await page.locator('.visualInstruction').fill('Certificación visual ' + instructionMarker + ': marcar esta zona y crear la misión.');
    const canvas = page.locator('.artiaPreviewShell canvas').first();
    await canvas.scrollIntoViewIfNeeded();
    await canvas.waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForFunction(() => {
      const c = document.querySelector('.artiaPreviewShell canvas');
      const shell = document.querySelector('.artiaPreviewShell');
      return Boolean(c && shell && (c.getAttribute('width') || '') !== '0' && shell.getBoundingClientRect().width > 400);
    }, null, { timeout: 10000 });
    const box = await canvas.boundingBox();
    if (!box || box.width < 400 || box.height < 200) throw new Error('artia_canvas_not_ready');
    const centerX = box.x + Math.min(180, box.width * 0.25);
    const centerY = box.y + Math.min(160, box.height * 0.25);
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await new Promise(resolve => setTimeout(resolve, 250));
    await page.mouse.move(box.x + Math.max(320, box.width * 0.55), box.y + Math.max(260, box.height * 0.45), { steps: 12 });
    await new Promise(resolve => setTimeout(resolve, 100));
    await page.mouse.up();
    await page.waitForFunction(() => {
      const text = [...document.querySelectorAll('.visualHint')].map(n => n.textContent || '').join(' ');
      return /Anotaciones:\s*[1-9]\d*/.test(text);
    }, null, { timeout: 10000 });

    const missionButton = page.getByRole('button', { name: 'Crear misión con este diseño' }).first();
    if (!(await missionButton.isEnabled())) throw new Error('artia_mission_button_not_enabled');
    const missionGoalMarker = 'RWHTVISUALMISSION' + Date.now();
    await page.locator('.visualInstruction').fill('Certificación visual ' + missionGoalMarker + ': mantener el diseño y verificar el contexto del proyecto; no ejecutar cambios externos.');
    await missionButton.click();
    await page.getByText('Misión confirmada por ARIA con el diseño y las anotaciones.').waitFor({ state: 'visible', timeout: 60000 });

    const missionWait = await waitForProjectMission(page, session.accessToken, battle.id, missionGoalMarker, 60000);
    if (!missionWait.mission) throw new Error('visual_mission_not_persisted');
    if (missionWait.result.status !== 200 || missionWait.result.body?.queue !== 'canonical') throw new Error('visual_mission_not_canonical_queue');
    const metadata = missionWait.metadata || {};
    const visual = missionWait.visual_context || {};
    if (String(metadata.project_id || '').toLowerCase() !== battle.id) throw new Error('visual_mission_project_id_missing');
    if (String(visual.image_path || '') === '') throw new Error('visual_mission_png_path_missing');
    if (String(visual.mime_type || '') !== 'image/png') throw new Error('visual_mission_png_mime_missing');
    if (!String(visual.annotation_summary || '').includes('rect')) throw new Error('visual_mission_annotation_summary_missing');
    if (!String(visual.instruction || '').includes(missionGoalMarker)) throw new Error('visual_mission_instruction_missing');

    await page.waitForSelector('.projectTabs .tabButton', { state: 'visible', timeout: 30000 });
    await page.locator('.projectTabs .tabButton').filter({ hasText: 'Misiones' }).click();
    await page.waitForSelector('.catalogList', { state: 'visible', timeout: 30000 });

    report.visual_mission = {
      mission_id: missionWait.mission.mission_id,
      project_id: metadata.project_id,
      queue: missionWait.result.body.queue,
      status: missionWait.mission.status,
      image_path: visual.image_path,
      mime_type: visual.mime_type,
      annotation_summary: visual.annotation_summary,
      instruction: visual.instruction,
      annotations: visual.annotations
    };

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.projectShell', { state: 'visible', timeout: 60000 });
    const finalSession = await waitForPersistedSession(page, session.userId);
    await page.waitForFunction(() => Boolean(document.querySelector('.projectGrid .projectCard.selected')?.textContent?.includes('BattleCruiser')), null, { timeout: 30000 });

    if (consoleErrors.length) throw new Error('projects_console_errors_' + consoleErrors.length);
    if (pageErrors.length) throw new Error('projects_page_errors_' + pageErrors.length);
    if (failedResponses.length) throw new Error('projects_failed_responses_' + failedResponses.length);

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
