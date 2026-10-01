    headers.set('authorization', 'Bearer ' + token);
    headers.set('x-aria-trace-id', traceId);
    headers.set('x-aria-request-id', requestId);
    headers.set('x-aria-pwa-build', BUILD);
    if (init.body) headers.set('content-type', 'application/json');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), isRead ? 30000 : path.endsWith('/conversation') ? 150000 : 20000);
    try {
      const response = await fetch(API + path, { ...init, headers, cache: 'no-store', signal: controller.signal });
      const raw = await response.text();
      let data: any = null;