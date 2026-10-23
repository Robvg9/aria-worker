#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'aria-reality-board-live-e2e-v1.0.0';
const BASE_URL = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/#.*$/, '');
const EMAIL = String(process.env.RWHT_EMAIL || '');
const PASSWORD = String(process.env.RWHT_PASSWORD || '');
const STORAGE_STATE = String(process.env.RWHT_STORAGE_STATE || '');
const EXPECTED_SHA = String(process.env.GITHUB_SHA || '').trim();
const ARTIFACT_DIR = process.env.RWHT_ARTIFACT_DIR || path.resolve(process.cwd(), 'reality-board-live-artifacts');

function waitFor(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function authenticate(page) {
  await page.waitForFunction(
    () => Boolean(document.querySelector('.dashboardScreen')) || Boolean(document.querySelector('input[type="password"]')),
    null,
    { timeout: 30000 }
  );
  if (await page.locator('.dashboardScreen').isVisible().catch(() => false)) {
    return { mode: STORAGE_STATE ? 'storage_state_or_existing' : 'existing_session' };
  }
  if (!EMAIL || !PASSWORD) throw new Error('reality_board_authenticated_session_source_missing');
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
  await page.waitForSelector('.dashboardScreen', { state: 'visible', timeout: 60000 });
  return { mode: 'password' };
}

async function run() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  if (!EXPECTED_SHA) throw new Error('reality_board_expected_live_sha_missing');

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...((!EMAIL || !PASSWORD) && STORAGE_STATE ? { storageState: STORAGE_STATE } : {})
  });
  const loginPage = await context.newPage();
  let boardPageForScreenshot = null;
  const pageErrors = [];
  const consoleErrors = [];

  const report = {
    version: VERSION,
    started_at: new Date().toISOString(),
    target: BASE_URL,
    expected_live_sha: EXPECTED_SHA,
    auth_verified: false,
    reality_board: {
      verified: false,
      url: '',
      live_build_sha: '',
      summary_cards: 0,
      project_cards: 0,
      initial_api_responses: [],
      manual_refresh_api_responses: [],
      failure: null
    },
    page_errors: [],
    console_errors: [],
    failed_responses: [],
    failure: null,
    verified: false
  };

  try {
    await loginPage.goto(new URL('#home', BASE_URL).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    report.auth = await authenticate(loginPage);
    const session = await loginPage.evaluate(() => {
      try {
        const value = JSON.parse(localStorage.getItem('aria_session_v2') || 'null');
        return {
          user_id_present: Boolean(value?.userId),
          access_token_present: Boolean(value?.accessToken),
          refresh_token_present: Boolean(value?.refreshToken)
        };
      } catch {
        return { user_id_present: false, access_token_present: false, refresh_token_present: false };
      }
    });
    if (!session.user_id_present || !session.access_token_present || !session.refresh_token_present) {
      throw new Error('reality_board_authenticated_session_not_persisted');
    }
    report.auth_verified = true;

    boardPageForScreenshot = await context.newPage();
    const boardPage = boardPageForScreenshot;
    const boardApiResponses = [];
    const boardOrigin = new URL(BASE_URL).origin;
    boardPage.on('pageerror', error => pageErrors.push(String(error?.message || error).slice(0, 1000)));
    boardPage.on('console', message => {
      if (message.type() === 'error') consoleErrors.push({ text: message.text().slice(0, 1200) });
    });
    boardPage.on('response', response => {
      try {
        const url = new URL(response.url());
        if (url.origin === boardOrigin && url.pathname.startsWith('/api/projects')) {
          boardApiResponses.push({ path: url.pathname, status: response.status() });
        }
        if (response.status() >= 500) {
          report.failed_responses.push({
            status: response.status(),
            method: response.request().method(),
            url: response.url().slice(0, 1000)
          });
        }
      } catch {}
    });

    const boardUrl = new URL('reality-board.html', BASE_URL.endsWith('/') ? BASE_URL : BASE_URL + '/').href;
    report.reality_board.url = boardUrl;
    await boardPage.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await boardPage.waitForFunction(() => {
      const error = document.querySelector('#err');
      const hasError = Boolean(error && getComputedStyle(error).display !== 'none' && String(error.textContent || '').trim());
      return hasError || (
        document.querySelectorAll('#summary .row').length >= 4 &&
        document.querySelectorAll('#projects .row').length === 3 &&
        String(document.querySelector('#updated')?.textContent || '').includes('Actualizado:')
      );
    }, null, { timeout: 60000 });

    const initial = await boardPage.evaluate(async () => {
      const error = document.querySelector('#err');
      const buildResponse = await fetch('/pwa/version.json', { cache: 'no-store' }).catch(() => null);
      const build = buildResponse && buildResponse.ok ? await buildResponse.json().catch(() => null) : null;
      return {
        error_visible: Boolean(error && getComputedStyle(error).display !== 'none' && String(error.textContent || '').trim()),
        error_text: String(error?.textContent || '').trim(),
        summary_cards: document.querySelectorAll('#summary .row').length,
        project_cards: document.querySelectorAll('#projects .row').length,
        project_text: String(document.querySelector('#projects')?.innerText || ''),
        truth_text: String(document.querySelector('#truth')?.innerText || ''),
        next_text: String(document.querySelector('#next')?.innerText || ''),
        updated_text: String(document.querySelector('#updated')?.textContent || ''),
        live_build_sha: String(build?.build || '')
      };
    });

    Object.assign(report.reality_board, {
      live_build_sha: initial.live_build_sha,
      summary_cards: initial.summary_cards,
      project_cards: initial.project_cards,
      updated_text: initial.updated_text,
      project_labels_verified: ['ARIA', 'CuevaCoin', 'BattleCruiser'].every(name => initial.project_text.includes(name)),
      truth_section_verified: initial.truth_text.includes('ARIA · versión desplegada') &&
        initial.truth_text.includes('Projects + ARTIA') &&
        initial.truth_text.includes(initial.live_build_sha) &&
        initial.truth_text.includes('LIVE ALINEADO CON main'),
      uncertainty_policy_verified: initial.truth_text.includes('HISTÓRICO') || initial.truth_text.includes('NO CONFIRMADO'),
      next_actions_verified: initial.next_text.includes('CuevaCoin') && initial.next_text.includes('BattleCruiser')
    });
    if (initial.error_visible) throw new Error('reality_board_api_load_failed_' + initial.error_text.slice(0, 300));
    if (initial.live_build_sha !== EXPECTED_SHA) {
      throw new Error('reality_board_live_sha_mismatch_expected_' + EXPECTED_SHA + '_actual_' + initial.live_build_sha);
    }
    if (initial.summary_cards < 4 || initial.project_cards !== 3) throw new Error('reality_board_project_coverage_failed');
    if (!report.reality_board.project_labels_verified) throw new Error('reality_board_human_project_labels_missing');
    if (!report.reality_board.truth_section_verified) throw new Error('reality_board_live_truth_section_not_aligned');
    if (!report.reality_board.uncertainty_policy_verified) throw new Error('reality_board_uncertainty_not_rendered');
    if (!report.reality_board.next_actions_verified) throw new Error('reality_board_human_next_actions_missing');

    if (boardApiResponses.length < 4) throw new Error('reality_board_initial_live_api_coverage_missing');
    report.reality_board.initial_api_responses = boardApiResponses.slice();
    if (report.reality_board.initial_api_responses.some(response => response.status !== 200)) {
      throw new Error('reality_board_initial_project_api_read_failed');
    }

    const refreshStart = boardApiResponses.length;
    const updatedBeforeRefresh = initial.updated_text;
    await boardPage.locator('#refresh').click();
    const refreshDeadline = Date.now() + 30000;
    while (Date.now() < refreshDeadline &&
      (boardApiResponses.length - refreshStart < 4 ||
       String(await boardPage.locator('#updated').textContent().catch(() => '')) === updatedBeforeRefresh)) {
      await waitFor(250);
    }
    await waitFor(250);
    report.reality_board.manual_refresh_api_responses = boardApiResponses.slice(refreshStart);
    if (report.reality_board.manual_refresh_api_responses.length < 4) {
      throw new Error('reality_board_manual_refresh_live_api_coverage_missing');
    }
    if (report.reality_board.manual_refresh_api_responses.some(response => response.status !== 200)) {
      throw new Error('reality_board_manual_refresh_project_api_read_failed');
    }
    if (pageErrors.length) throw new Error('reality_board_page_errors_' + pageErrors.length);
    if (consoleErrors.length) throw new Error('reality_board_console_errors_' + consoleErrors.length);
    if (report.failed_responses.length) throw new Error('reality_board_http_5xx_' + report.failed_responses.length);

    report.reality_board.verified = true;
    report.verified = true;
  } catch (error) {
    report.failure = String(error?.message || error).slice(0, 1600);
    report.reality_board.failure = report.failure;
  }

  report.finished_at = new Date().toISOString();
  report.page_errors = pageErrors.slice(0, 100);
  report.console_errors = consoleErrors.slice(0, 100);
  report.failed_responses = report.failed_responses.slice(0, 100);
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'reality-board-live-report.json'), JSON.stringify(report, null, 2));
  if (boardPageForScreenshot) {
    await boardPageForScreenshot.screenshot({ path: path.join(ARTIFACT_DIR, 'reality-board-live-final.png'), fullPage: true }).catch(() => {});
  }
  await context.close();
  await browser.close();

  console.log(JSON.stringify({
    status: report.verified ? 'verified' : 'failed',
    auth_verified: report.auth_verified,
    expected_live_sha: report.expected_live_sha,
    live_build_sha: report.reality_board.live_build_sha,
    reality_board_verified: report.reality_board.verified,
    project_cards: report.reality_board.project_cards,
    summary_cards: report.reality_board.summary_cards,
    initial_api_responses: report.reality_board.initial_api_responses.length,
    manual_refresh_api_responses: report.reality_board.manual_refresh_api_responses.length,
    page_errors: report.page_errors.length,
    console_errors: report.console_errors.length,
    failed_responses: report.failed_responses.length,
    failure: report.failure
  }, null, 2));

  if (!report.verified) process.exitCode = 2;
}

run().catch(error => {
  console.error('[ARIA-REALITY-BOARD-LIVE-E2E] fatal:', String(error?.message || error));
  process.exitCode = 1;
});
