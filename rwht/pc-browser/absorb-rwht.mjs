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

async function authRequest(url, email, password) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: 'sb_publishable_E2AmZNo2hAbOYlytkVbyBQ_X7JH0HPw'
      },
      body: JSON.stringify({ email: email.trim(), password }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function bootstrapSession() {
  if (storage) return;
  const email = process.env.RWHT_EMAIL || '';
  const password = process.env.RWHT_PASSWORD || '';
  if (!email || !password) throw new Error('authenticated_session_missing');

  const proxyUrl = new URL('/auth/token?grant_type=password', base).href;
  let auth = null;
  try {
    auth = await authRequest(proxyUrl, email, password);
  } catch (error) {
    auth = { ok:false, status:0, payload:{ error: String(error?.message || error) } };
  }

  if (!auth.ok) {
    try {
      auth = await authRequest('https://icuqsstxfdbvjytkhlog.supabase.co/auth/v1/token?grant_type=password', email, password);
    } catch (error) {
      auth = { ok:false, status:0, payload:{ error: String(error?.message || error) } };
    }
  }

  if (!auth.ok || !auth.payload?.access_token || !auth.payload?.refresh_token || !auth.payload?.user?.id) {
    throw new Error('auth_bootstrap_failed:http_' + auth.status + ':' + String(auth.payload?.error_description || auth.payload?.msg || auth.payload?.error || 'unknown'));
  }

  const session = {
    accessToken: auth.payload.access_token,
    refreshToken: auth.payload.refresh_token,
    userId: auth.payload.user.id,
    expiresAt: Date.now() + Math.max(60, Number(auth.payload.expires_in ?? 3600)) * 1000,
    email: auth.payload.user.email
  };
  await context.addInitScript(({ session }) => {
    localStorage.setItem('aria_session_v2', JSON.stringify(session));
  }, { session });
}

await bootstrapSession();


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
async function openCapabilities() {
  const absorbTab = page.getByRole('button', { name: 'ABSORB' }).first();
  let lastUrl = page.url();
  let lastBody = '';
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      if (!page.url().includes('#capabilities')) {
        await page.goto(base + '/#capabilities', { waitUntil:'domcontentloaded', timeout:30000 });
      }
      await page.waitForSelector('.appShell', { state:'visible', timeout:20000 });
      await page.waitForTimeout(1500);
      if (!page.url().includes('#capabilities')) {
        await page.evaluate(() => { window.location.hash = '#capabilities'; });
        await page.waitForTimeout(1500);
      }
      await absorbTab.waitFor({ state:'visible', timeout:10000 });
      await absorbTab.click();
      await page.getByTestId('aria-absorb-center').waitFor({ state:'visible', timeout:15000 });
      return;
    } catch (error) {
      lastUrl = page.url();
      lastBody = (await page.locator('body').innerText().catch(() => '')).slice(-3000);
      if (attempt === 6) throw new Error('absorb_capabilities_not_reached:url=' + lastUrl + ':body=' + lastBody);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

await openCapabilities();

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

