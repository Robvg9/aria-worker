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
  await page.waitForSelector('.dashboardScreen,.capabilitiesViewport', { state:'visible', timeout:60000 });
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

try {
  const inspect = page.getByTestId('aria-absorb-inspect');
  await inspect.click();
  await expectNext('aria-absorb-verify');

  await page.getByTestId('aria-absorb-verify').click();
  await expectNext('aria-absorb-register');

  const register = page.getByTestId('aria-absorb-register');
  await register.click();
  await expectNext('aria-absorb-enable');

  const enable = page.getByTestId('aria-absorb-enable');
  await enable.click();
  await page.waitForFunction(() => document.body.innerText.includes('HABILITADO'), null, { timeout:30000 });
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
  body: (await page.locator('body').innerText()).slice(-12000),
  timestamp: new Date().toISOString()
};
fs.writeFileSync(path.join(artifactDir, 'absorb-live-e2e.json'), JSON.stringify(evidence, null, 2));
await page.screenshot({ path: path.join(artifactDir, 'absorb-live-e2e.png'), fullPage:true });

await context.close();
await browser.close();
console.log('ABSORB LIVE E2E: PASS target=' + base);
