#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const base = String(process.env.RWHT_URL || 'https://aria.robvg9.workers.dev/pwa/').replace(/\/?$/, '/');
const origin = new URL(base).origin;
const artifactDir = path.resolve(process.env.RWHT_ARTIFACT_DIR || 'production-webpush-e2e-artifacts');
fs.mkdirSync(artifactDir, { recursive: true });

const ANON = 'sb_publishable_E2AmZNo2hAbOYlytkVbyBQ_X7JH0HPw';
const SUPABASE_URL = 'https://icuqsstxfdbvjytkhlog.supabase.co';
const RECEIPT_CACHE = 'aria-push-receipts-v1';
const RECEIPT_URL = '/pwa/__aria-push-receipt__';

function runSql(query) {
  return execFileSync('supabase', ['db', 'query', '--linked', query], {
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env }
  });
}

async function getAuthSession() {
  if (process.env.RWHT_STORAGE_STATE) {
    return null;
  }
  const email = String(process.env.RWHT_EMAIL || '').trim();
  const password = String(process.env.RWHT_PASSWORD || '');
  assert.ok(email && password, 'RWHT credentials are required for production Web Push E2E');

  const response = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      apikey: ANON,
      authorization: 'Bearer ' + ANON,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  const body = await response.json().catch(() => null);
  assert.equal(response.status, 200, 'Supabase password auth failed');
  assert.ok(body?.access_token && body?.user?.id, 'Supabase auth response missing session');
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || '',
    userId: body.user.id,
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in || 3600)) * 1000,
    email: body.user.email || email
  };
}

async function readSession(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('aria_session_v2');
      const session = raw ? JSON.parse(raw) : null;
      return session && typeof session.accessToken === 'string'
        ? {
            accessToken: session.accessToken,
            refreshToken: session.refreshToken || '',
            userId: String(session.userId || ''),
            expiresAt: Number(session.expiresAt || 0),
            email: session.email || null
          }
        : null;
    } catch { return null; }
  });
}

async function ensurePushSubscription(page, token) {
  await page.context().grantPermissions(['notifications'], { origin });
  const result = await page.evaluate(async ({ token, origin }) => {
    const statusResponse = await fetch('/api/meditation/push/status', {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      cache: 'no-store'
    });
    const status = await statusResponse.json().catch(() => null);
    if (statusResponse.status !== 200 || status?.configured !== true || !status?.vapid_public) {
      throw new Error('web_push_status_invalid:' + statusResponse.status + ':' + JSON.stringify(status));
    }

    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) throw new Error('push_manager_unavailable');

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const normalized = String(status.vapid_public).replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      const binary = atob(padded);
      const applicationServerKey = Uint8Array.from(binary, c => c.charCodeAt(0));
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error('push_subscription_invalid');

    const saveResponse = await fetch('/api/meditation/push/subscribe', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        expiration_time: json.expirationTime ?? null,
        user_agent: navigator.userAgent.slice(0, 512)
      })
    });
    const saved = await saveResponse.json().catch(() => null);
    if (saveResponse.status !== 200) throw new Error('push_subscription_save_failed:' + saveResponse.status);

    await caches.open('aria-push-receipts-v1').then(cache => cache.delete('/pwa/__aria-push-receipt__')).catch(() => {});

    return {
      endpoint: json.endpoint,
      active_subscriptions: Number(saved?.subscription?.active ? 1 : 0),
      scope: registration.scope
    };
  }, { token, origin });
  return result;
}

async function insertRealNotification(missionId, userId, notificationId) {
  const safe = value => String(value).replaceAll("'", "''");
  const sql = `
begin;

insert into aria_internal.mission_state
  (mission_id, goal, status, current_step, total_steps, completed_steps, checkpoint, metadata, lease_owner, lease_until)
values
  ('${safe(missionId)}','Production Web Push E2E','succeeded',1,1,1,
   jsonb_build_object('probe',true,'web_push_e2e',true),
   jsonb_build_object('user_id','${safe(userId)}','probe','production_webpush_e2e'),
   null,null);

with ev as (
  insert into aria_internal.mission_events (mission_id,event_type,payload)
  values (
    '${safe(missionId)}',
    'mission_verified',
    jsonb_build_object('probe',true,'production_web_push_e2e',true,'notification_id','${safe(notificationId)}')
  )
  returning event_id
)
insert into aria_internal.meditation_notifications
  (source_event_id, mission_id, kind, severity, title, message, action, metadata)
select event_id,
       '${safe(missionId)}',
       'mission_completed_verified',
       'success',
       'Misión completada y verificada',
       'ARIA producción Web Push E2E',
       'review_result',
       jsonb_build_object('probe',true,'production_web_push_e2e',true,'notification_id','${safe(notificationId)}')
from ev;

commit;
`;
  runSql(sql);
}

async function waitForDelivery(notificationId) {
  let last = '';
  for (let i = 0; i < 30; i += 1) {
    last = runSql(`select status from aria_internal.meditation_push_deliveries where notification_id='${notificationId}' order by updated_at desc limit 1;`);
    if (/\bsent\b/i.test(last)) return { status: 'sent', raw: last };
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return { status: 'timeout', raw: last };
}

async function readReceipt(page, notificationId) {
  return page.evaluate(async ({ notificationId }) => {
    const cache = await caches.open('aria-push-receipts-v1');
    const response = await cache.match('/pwa/__aria-push-receipt__');
    const receipt = response ? await response.json().catch(() => null) : null;
    const registration = await navigator.serviceWorker.ready;
    const shown = await registration.getNotifications({
      tag: 'aria-meditation-' + notificationId
    });
    return {
      receipt,
      shown_notifications: shown.length,
      permission: 'Notification' in window ? Notification.permission : 'unsupported'
    };
  }, { notificationId });
}

const report = {
  status: 'failed',
  cloudflare_origin: origin,
  subscription_registered: false,
  notification_inserted: false,
  server_delivery_sent: false,
  service_worker_received: false,
  native_notification_shown: false,
  notification_id: null,
  mission_id: null,
  subscription_scope: null,
  delivery_raw: null,
  receipt: null
};

const browser = await chromium.launch({ headless: false });
try {
  const injectedSession = await getAuthSession();
  const context = await browser.newContext(
    process.env.RWHT_STORAGE_STATE ? { storageState: process.env.RWHT_STORAGE_STATE } : {}
  );
  if (injectedSession) {
    await context.addInitScript(session => {
      localStorage.setItem('aria_session_v2', JSON.stringify(session));
    }, injectedSession);
  }

  const page = await context.newPage();
  await page.goto(base + '#meditation', { waitUntil: 'domcontentloaded', timeout: 60000 });

  const session = await readSession(page);
  assert.ok(session?.accessToken && session?.userId, 'authenticated ARIA session missing');

  const subscription = await ensurePushSubscription(page, session.accessToken);
  report.subscription_registered = true;
  report.subscription_scope = subscription.scope;

  const notificationId = crypto.randomUUID();
  const missionId = 'mission_webpush_prod_' + Date.now();
  report.notification_id = notificationId;
  report.mission_id = missionId;

  // The browser page is closed before the server creates the notification.
  await page.close();
  await new Promise(resolve => setTimeout(resolve, 1000));

  await insertRealNotification(missionId, session.userId, notificationId);
  report.notification_inserted = true;

  const delivery = await waitForDelivery(notificationId);
  report.delivery_raw = delivery.raw;
  assert.equal(delivery.status, 'sent', 'server did not persist Web Push delivery as sent');
  report.server_delivery_sent = true;

  const probe = await context.newPage();
  await probe.goto(base + '#meditation', { waitUntil: 'domcontentloaded', timeout: 60000 });

  let receipt = null;
  for (let i = 0; i < 20; i += 1) {
    receipt = await readReceipt(probe, notificationId).catch(() => null);
    if (receipt?.receipt?.notification_id === notificationId) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  report.receipt = receipt;
  assert.equal(receipt?.receipt?.notification_id, notificationId, 'Service Worker did not receive the background push');
  report.service_worker_received = true;
  assert.equal(receipt?.shown_notifications, 1, 'native Web Push notification was not shown');
  report.native_notification_shown = true;

  await probe.close();
  await context.close();

  report.status = 'verified';
  fs.writeFileSync(
    path.join(artifactDir, 'production-webpush-e2e.json'),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error?.message || error);
  fs.writeFileSync(
    path.join(artifactDir, 'production-webpush-e2e.json'),
    JSON.stringify(report, null, 2)
  );
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 2;
} finally {
  await browser.close().catch(() => {});
}
