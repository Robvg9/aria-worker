const CACHE = 'aria-pwa-__BUILD__';
const PUSH_RECEIPT_CACHE = 'aria-push-receipts-v1';
const PUSH_RECEIPT_URL = '/pwa/__aria-push-receipt__';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== PUSH_RECEIPT_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, fallbackKey = './') {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(fallbackKey, copy)).catch(() => undefined);
    }
    return response;
  } catch {
    const cached = await caches.match(fallbackKey);
    if (cached) return cached;
    throw new Error('network_unavailable');
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (!url.pathname.startsWith('/pwa/')) return;

  const isNavigation = event.request.mode === 'navigate';
  const isImmutableAsset = url.pathname.includes('/assets/');

  if (isNavigation) {
    event.respondWith(networkFirst(event.request, './'));
    return;
  }

  if (isImmutableAsset) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return networkFirst(event.request, event.request);
      })
    );
    return;
  }

  event.respondWith(networkFirst(event.request, event.request));
});

self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    try { payload = { body: event.data ? event.data.text() : '' }; } catch {}
  }

  const title = String(payload?.title || 'Actualización de ARIA');
  const body = String(payload?.body || 'ARIA tiene una actualización.');
  const notificationId = String(payload?.notification_id || '');
  const missionId = String(payload?.mission_id || '');
  const target = String(
    payload?.url ||
    (notificationId ? '/pwa/#notification=' + encodeURIComponent(notificationId) : '/pwa/#home')
  );

  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body,
      icon: '/pwa/icons/aria.svg',
      badge: '/pwa/icons/aria.svg',
      tag: notificationId ? 'aria-meditation-' + notificationId : 'aria-meditation-update',
      renotify: true,
      data: {
        notificationId: notificationId || null,
        missionId: missionId || null,
        url: target
      }
    });

    const receipt = {
      received: true,
      notification_id: notificationId || null,
      mission_id: missionId || null,
      received_at: new Date().toISOString(),
      handler: 'service_worker_push'
    };
    const cache = await caches.open(PUSH_RECEIPT_CACHE);
    await cache.put(PUSH_RECEIPT_URL, new Response(JSON.stringify(receipt), {
      headers: { 'content-type': 'application/json' }
    }));
  })();
});

self.addEventListener('notificationclick', event => {
  const notification = event.notification;
  const target = notification?.data?.url || (
    '/pwa/#notification=' + encodeURIComponent(String(notification?.data?.notificationId || ''))
  );
  notification.close();

  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      try {
        const current = new URL(client.url);
        if (current.pathname.startsWith('/pwa/')) {
          await client.navigate(target);
          return client.focus();
        }
      } catch {}
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
    return undefined;
  })());
});
