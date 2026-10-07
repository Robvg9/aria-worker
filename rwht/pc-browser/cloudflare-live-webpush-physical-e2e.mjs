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

try {
  const context = await browser.newContext();
  await context.grantPermissions(['notifications'], { origin });

  const page = await context.newPage();
  await page.goto(base + '?probe=' + encodeURIComponent(report.notification_id), {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  report.cloudflare_live = true;

  const registration = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('service_worker_api_missing');
    const ready = await navigator.serviceWorker.ready;
    return { scope: ready.scope, active: Boolean(ready.active) };
  });
  report.service_worker_registered = Boolean(registration.active);
  report.registration_scope = registration.scope;
  assert.ok(report.service_worker_registered, 'Cloudflare PWA Service Worker did not become active');

  const firstCdp = await context.newCDPSession(page);
  const registrations = new Map();
  firstCdp.on('ServiceWorker.workerRegistrationUpdated', params => {
    for (const reg of params?.registrations || []) {
      if (reg?.scopeURL) registrations.set(String(reg.scopeURL), String(reg.registrationId));
    }
  });
  await firstCdp.send('ServiceWorker.enable');

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
  await page.close();
  report.pwa_page_closed_before_push = true;

  const controller = await context.newPage();
  const controllerCdp = await context.newCDPSession(controller);
  await controllerCdp.send('ServiceWorker.enable');
  await controllerCdp.send('ServiceWorker.deliverPushMessage', {
    origin,
    registrationId,
    data: JSON.stringify({
      title: 'Misión completada y verificada',
      body: 'ARIA terminó una misión y comprobó que el resultado quedó correcto.',
      notification_id: report.notification_id,
      mission_id: 'physical-webpush-probe',
      url: '/pwa/#notification=' + encodeURIComponent(report.notification_id)
    })
  });
  report.push_delivered_to_service_worker = true;

  const probe = await context.newPage();
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
  fs.writeFileSync(path.join(artifacts, 'cloudflare-live-webpush-physical-e2e.json'), JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 2;
} finally {
  await browser.close().catch(() => {});
}
