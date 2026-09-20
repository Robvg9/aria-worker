const CACHE = 'aria-pwa-__BUILD__';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
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
