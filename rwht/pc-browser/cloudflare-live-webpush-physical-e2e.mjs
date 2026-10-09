#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const base = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/\/?$/, '/');
const origin = new URL(base).origin;
const artifacts = path.resolve(process.env.RWHT_ARTIFACT_DIR || 'production-webpush-physical-e2e-artifacts');
fs.mkdirSync(artifacts, { recursive: true });

const browser = await chromium.launch({ headless: false });
const report = {
  status: 'failed',
  stage: 'startup',
  origin,
  cloudflare_live: false,
  service_worker_registered: false,
  pwa_page_closed_before_push: false,
  push_delivered_to_service_worker: false,
  native_notification_shown: false,
  notification_id: crypto.randomUUID(),
  registration_scope: null,
  registration_id: null,
  error: null
};

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + '_timeout_after_' + timeoutMs + 'ms')), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}


try {
  const context = await browser.newContext();
  await context.grantPermissions(['notifications'], { origin });

  const page = await context.newPage();
  report.stage = 'open_live_pwa';
  await page.goto(base + '?probe=' + encodeURIComponent(report.notification_id), {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  report.cloudflare_live = true;

  report.stage = 'register_and_activate_service_worker';
  const registration = await withTimeout(page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('service_worker_api_missing');
    const build = String(document.querySelector('meta[name="aria-build"]')?.getAttribute('content') || '').trim();
    if (!build) throw new Error('aria_build_sha_missing');
    const url = '/pwa/sw-' + build + '.js';
    const reg = await navigator.serviceWorker.register(url, { scope: '/pwa/' });
    const active = reg.active;
    if (active?.state === 'activated') return { scope: reg.scope, active: true, script_url: url, build };
    const worker = reg.installing || reg.waiting || reg.active;
    if (!worker) throw new Error('service_worker_registration_has_no_worker');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('service_worker_activation_timeout_after_20000ms')), 20000);
      const finish = () => {
        if (worker.state === 'activated') {
          clearTimeout(timer);
          resolve();
        } else if (worker.state === 'redundant') {
          clearTimeout(timer);
          reject(new Error('service_worker_became_redundant'));
        }
      };
      worker.addEventListener('statechange', finish);
      finish();
    });
    return { scope: reg.scope, active: Boolean(reg.active?.state === 'activated'), script_url: url, build };
  }), 30000, 'service_worker_registration');
  report.service_worker_registered = Boolean(registration.active);
  report.registration_scope = registration.scope;
  assert.ok(report.service_worker_registered, 'Cloudflare PWA Service Worker did not become active');

  report.stage = 'discover_cdp_registration';
  const firstCdp = await context.newCDPSession(page);
  const registrations = new Map();
  firstCdp.on('ServiceWorker.workerRegistrationUpdated', params => {
    for (const reg of params?.registrations || []) {
      if (reg?.scopeURL) registrations.set(String(reg.scopeURL), String(reg.registrationId));
    }
  });
  await withTimeout(firstCdp.send('ServiceWorker.enable'), 15000, 'cdp_service_worker_enable');

  let registrationId = null;
  for (let i = 0; i < 10 && !registrationId; i += 1) {
    registrationId =
      [...registrations.entries()].find(([scope]) => scope === registration.scope)?.[1] ||
      [...registrations.entries()].find(([scope]) => scope.startsWith(origin + '/pwa/'))?.[1] ||
      null;
    if (!registrationId) await page.waitForTimeout(500);
  }
  assert.ok(registrationId, 'Service Worker CDP registration id not found');
  report.registration_id = registrationId;

  // Close the only PWA page before delivering the push.
  report.stage = 'close_pwa_before_push';
  await page.close();
  report.pwa_page_closed_before_push = true;

  const controller = await context.newPage();
  const controllerCdp = await context.newCDPSession(controller);
  await controllerCdp.send('ServiceWorker.enable');
  report.stage = 'deliver_background_push';
  await withTimeout(controllerCdp.send('ServiceWorker.deliverPushMessage', {
    origin,
    registrationId,
    data: JSON.stringify({
      title: 'Misión completada y verificada',
      body: 'ARIA terminó una misión y comprobó que el resultado quedó correcto.',
      notification_id: report.notification_id,
      mission_id: 'physical-webpush-probe',
      url: '/pwa/#notification=' + encodeURIComponent(report.notification_id)
    })
  }), 15000, 'deliver_push_message');
  report.push_delivered_to_service_worker = true;

  const probe = await context.newPage();
  report.stage = 'verify_background_receipt_and_notification';
  await probe.goto(base + '#home', { waitUntil: 'domcontentloaded', timeout: 60000 });

  let receipt = null;
  for (let i = 0; i < 20; i += 1) {
    receipt = await probe.evaluate(async () => {
      const cache = await caches.open('aria-push-receipts-v1');
      const response = await cache.match('/pwa/__aria-push-receipt__');
      const receipt = response ? await response.json().catch(() => null) : null;
      const registration = await navigator.serviceWorker.ready;
      const shown = await registration.getNotifications({
        tag: receipt?.notification_id ? 'aria-meditation-' + receipt.notification_id : undefined
      });
      return {
        receipt,
        shown_notifications: shown.length,
        permission: 'Notification' in window ? Notification.permission : 'unsupported'
      };
    }).catch(() => null);

    if (receipt?.receipt?.notification_id === report.notification_id) break;
    await probe.waitForTimeout(500);
  }

  assert.equal(
    receipt?.receipt?.notification_id,
    report.notification_id,
    'background push did not reach the Service Worker after the PWA page was closed'
  );
  report.native_notification_shown = receipt.shown_notifications === 1;
  assert.equal(receipt.shown_notifications, 1, 'native notification was not shown');
  assert.equal(receipt.permission, 'granted', 'browser notification permission was not granted');

  await probe.close();
  await controller.close();
  await context.close();

  report.status = 'verified';
  fs.writeFileSync(path.join(artifacts, 'cloudflare-live-webpush-physical-e2e.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error?.message || error);
  report.failed_at_stage = report.stage;
  fs.writeFileSync(path.join(artifacts, 'cloudflare-live-webpush-physical-e2e.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 2;
} finally {
  await browser.close().catch(() => {});
}
