#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/\/$/, '');
const artifactDir = path.resolve(process.cwd(), 'absorb-artifacts');
fs.mkdirSync(artifactDir, { recursive: true });
const storage = process.env.RWHT_STORAGE_STATE || '';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext(storage ? { storageState: storage } : {});
const page = await context.newPage();

async function loginIfNeeded() {
  const password = page.locator('input[type="password"]').first();
  if (!(await password.isVisible().catch(() => false))) return;
  const emailValue = process.env.RWHT_EMAIL || '';
  const passwordValue = process.env.RWHT_PASSWORD || '';
  if (!emailValue || !passwordValue) throw new Error('authenticated_session_missing');
  await page.locator('input[type="email"],input[name="email"],input[autocomplete="username"]').first().fill(emailValue);
  await password.fill(passwordValue);
  const submit = page.locator('button[type="submit"],button').filter({ hasText: /entrar|iniciar|acceder|continuar/i }).first();
  if (await submit.count()) await submit.click(); else await password.press('Enter');
  await page.waitForFunction(() => {
    try {
      const session = JSON.parse(localStorage.getItem('aria_session_v2') || 'null');
      return Boolean(session?.accessToken && session?.refreshToken && session?.userId);
    } catch {
      return false;
    }
  }, null, { timeout:60000 });
  await page.goto(base + '/#capabilities', { waitUntil:'domcontentloaded', timeout:60000 });
  await page.getByRole('button', { name: 'ABSORB' }).first().waitFor({ state:'visible', timeout:60000 });
}

let opened = false;
for (let attempt = 1; attempt <= 9; attempt++) {
  try {
    await page.goto(base + '/#capabilities', { waitUntil:'domcontentloaded', timeout:20000 });
    opened = true;
    break;
  } catch (error) {
    if (attempt === 9) throw error;
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}
if (!opened) throw new Error('live_target_not_reached');
await page.waitForTimeout(1500);
await loginIfNeeded();

const absorbTab = page.getByRole('button', { name: 'ABSORB' }).first();
await absorbTab.waitFor({ state:'visible', timeout:30000 });
await absorbTab.click();
await page.getByTestId('aria-absorb-center').waitFor({ state:'visible', timeout:30000 });

async function readPersistedAbsorption() {
  const result = await page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('aria_session_v2') || 'null');
    const token = typeof session?.accessToken === 'string' ? session.accessToken : '';
    if (!token) return { httpStatus: 0, payload: { error: 'session_token_missing' } };
    const response = await fetch('/api/absorb', {
      headers: { authorization: 'Bearer ' + token, 'cache-control': 'no-store' },
      cache: 'no-store'
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = { error: 'invalid_json' }; }
    return { httpStatus: response.status, payload };
  });
  if (result.httpStatus !== 200) throw new Error('absorb_list_http_' + result.httpStatus + ':' + JSON.stringify(result.payload));
  const rows = Array.isArray(result.payload?.absorptions) ? result.payload.absorptions : [];
  const row = rows.find((item) => item?.source_owner === 'affaan-m' && item?.source_repo === 'ECC' && item?.source_requested_ref === 'v2.2.3');
  if (!row) throw new Error('absorb_record_not_found');
  return row;
}

async function waitForPersistedStatus(expected, timeout = 90000) {
  return waitForPersistedStatuses([expected], timeout);
}

async function waitForPersistedStatuses(expectedStatuses, timeout = 90000) {
  const wanted = new Set(expectedStatuses.map(String));
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await readPersistedAbsorption();
      if (wanted.has(String(last.status))) return last;
    } catch (error) {
      last = { error: String(error?.message || error) };
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('absorb_persisted_status_timeout:' + expectedStatuses.join('|') + ':' + JSON.stringify(last));
}

async function expectNext(testId, timeout = 90000) {
  const locator = page.getByTestId(testId);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await locator.isVisible().catch(() => false)) return;
    const body = await page.locator('body').innerText().catch(() => '');
    if (/absorb_[a-z_]+|No se pudo|no pudo completarse|error del/i.test(body)) {
      throw new Error('absorb_ui_error:' + body.slice(-2500));
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('absorb_next_state_timeout:' + testId + ':\n' + (await page.locator('body').innerText()).slice(-2500));
}

let finalAbsorption = null;
try {
  let current = await readPersistedAbsorption().catch(() => null);

  if (!current) {
    await page.getByTestId('aria-absorb-inspect').click();
    current = await waitForPersistedStatus('INDEXED');
  }
  if (!current.inventory || current.source_commit_sha?.length !== 40 || current.source_digest_sha256?.length !== 64) {
    throw new Error('absorb_index_persistence_contract_failed');
  }

  if (String(current.status) === 'INDEXED') {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('button', { name: 'ABSORB' }).first().waitFor({ state:'visible', timeout:30000 });
    await page.getByRole('button', { name: 'ABSORB' }).first().click();
    await page.getByTestId('aria-absorb-center').waitFor({ state:'visible', timeout:30000 });
    await page.getByTestId('aria-absorb-verify').click();
    current = await waitForPersistedStatus('VERIFIED');
    if (current.verification?.state !== 'VERIFIED' || current.verification?.evidence_persisted !== true) {
      throw new Error('absorb_verify_persistence_contract_failed');
    }
  }

  if (String(current.status) === 'VERIFIED') {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('button', { name: 'ABSORB' }).first().waitFor({ state:'visible', timeout:30000 });
    await page.getByRole('button', { name: 'ABSORB' }).first().click();
    await page.getByTestId('aria-absorb-center').waitFor({ state:'visible', timeout:30000 });
    await page.getByTestId('aria-absorb-register').click();
    current = await waitForPersistedStatus('REGISTERED');
    if (current.runtime_binding?.binding_id !== 'tool_ecc_operator' || current.enabled !== false) {
      throw new Error('absorb_register_persistence_contract_failed');
    }
  }

  if (String(current.status) === 'REGISTERED') {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByRole('button', { name: 'ABSORB' }).first().waitFor({ state:'visible', timeout:30000 });
    await page.getByRole('button', { name: 'ABSORB' }).first().click();
    await page.getByTestId('aria-absorb-center').waitFor({ state:'visible', timeout:30000 });
    await page.getByTestId('aria-absorb-enable').waitFor({ state:'visible', timeout:30000 });
    await page.getByTestId('aria-absorb-enable').click();
    current = await waitForPersistedStatus('ENABLED');
  }

  if (String(current.status) !== 'ENABLED' ||
      current.enabled !== true ||
      current.runtime_binding?.binding_id !== 'tool_ecc_operator' ||
      current.runtime_binding?.operation !== 'ecc.execute' ||
      current.verification?.runtime_verified !== true ||
      Number(current.verification?.runtime_evidence_count || 0) < 1) {
    throw new Error('absorb_enable_persistence_contract_failed:' + JSON.stringify(current));
  }

  finalAbsorption = current;
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByRole('button', { name: 'ABSORB' }).first().waitFor({ state:'visible', timeout:30000 });
  await page.getByRole('button', { name: 'ABSORB' }).first().click();
  await page.getByTestId('aria-absorb-center').waitFor({ state:'visible', timeout:30000 });
  await page.getByText('HABILITADO', { exact: true }).waitFor({ state:'visible', timeout:30000 });
} catch (error) {
  const failure = {
    url: page.url(),
    title: await page.title(),
    error: String(error?.stack || error),
    body: (await page.locator('body').innerText().catch(() => '')).slice(-12000),
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(path.join(artifactDir, 'absorb-live-e2e-failure.json'), JSON.stringify(failure, null, 2));
  await page.screenshot({ path: path.join(artifactDir, 'absorb-live-e2e-failure.png'), fullPage:true }).catch(() => {});
  throw error;
}

const evidence = {
  url: page.url(),
  title: await page.title(),
  persisted_absorption: finalAbsorption,
  timestamp: new Date().toISOString()
};
fs.writeFileSync(path.join(artifactDir, 'absorb-live-e2e.json'), JSON.stringify(evidence, null, 2));
await page.screenshot({ path: path.join(artifactDir, 'absorb-live-e2e.png'), fullPage:true }).catch(() => {});
await context.close().catch(() => {});
await browser.close().catch(() => {});
console.log('ABSORB LIVE E2E: PASS target=' + base);

