export type MeditationNotificationKind =
  | 'mission_completed_verified'
  | 'human_gate_required'
  | 'mission_blocked'
  | 'error_recoverable'
  | 'error_nonrecoverable'
  | 'payment_or_credential_block'
  | 'mission_proposal_ready'
  | string;

export type PwaNotificationItem = {
  notification_id: string;
  source_event_id?: number | string | null;
  mission_id?: string | null;
  kind: MeditationNotificationKind;
  severity: 'info' | 'success' | 'warning' | 'error' | string;
  title?: string | null;
  message?: string | null;
  action?: string | null;
  metadata?: Record<string, unknown> | null;
  read_at?: string | null;
  created_at: string;
};

export type HumanNotificationCopy = {
  title: string;
  body: string;
};

const HISTORICAL_LABELS: Array<[RegExp,string]> = [
  [/ARIA Verification Report/gi,'Informe de verificación de ARIA'],
  [/Verification Report/gi,'Informe de verificación'],
  [/FINDINGS/gi,'HALLAZGOS'],
  [/What ARIA Found/gi,'Lo que encontró ARIA'],
  [/ROOT CAUSE/gi,'CAUSA RAÍZ'],
  [/NEXT STEPS/gi,'PRÓXIMOS PASOS'],
  [/REMEDIATION/gi,'SOLUCIÓN'],
  [/VERIFICATION/gi,'VERIFICACIÓN'],
  [/Evidence/gi,'Evidencia'],
  [/Blocked/gi,'Bloqueada'],
  [/Succeeded/gi,'Completada'],
  [/Failed/gi,'Fallida']
];

const PUSH_PUBLIC_KEY_CACHE = 'aria_web_push_public_key_v1';

export function humanizeMeditationDetail(item: PwaNotificationItem): string {
  const raw = String(item?.message ?? '').trim();
  if (!raw) return 'ARIA tiene un detalle adicional registrado.';
  let value = raw;
  for (const [pattern,replacement] of HISTORICAL_LABELS) value = value.replace(pattern,replacement);
  return value;
}

export function humanizeMeditationNotification(item: PwaNotificationItem): HumanNotificationCopy {
  const map: Record<string, HumanNotificationCopy> = {
    mission_completed_verified: {
      title: 'Misión completada y verificada',
      body: 'ARIA terminó una misión y comprobó que el resultado quedó correcto. Toca para ver los detalles.'
    },
    human_gate_required: {
      title: 'Se necesita tu confirmación',
      body: 'ARIA necesita que revises y confirmes esta misión antes de continuar.'
    },
    mission_blocked: {
      title: 'Misión bloqueada',
      body: 'ARIA no puede continuar con esta misión. Toca para ver qué falta.'
    },
    error_recoverable: {
      title: 'ARIA encontró un problema',
      body: 'La misión tuvo un problema, pero todavía existe una ruta de recuperación. Toca para revisar.'
    },
    error_nonrecoverable: {
      title: 'Misión detenida',
      body: 'ARIA no pudo completar la misión y necesita revisión. Toca para ver el motivo.'
    },
    payment_or_credential_block: {
      title: 'Falta una dependencia',
      body: 'ARIA necesita una credencial, una cuota o una dependencia de pago para continuar.'
    },
    mission_proposal_ready: {
      title: 'Nueva propuesta de ARIA',
      body: 'ARIA preparó una propuesta para que la revises.'
    }
  };

  const fallback = {
    title: 'Actualización de ARIA',
    body: 'ARIA tiene una actualización. Toca para ver los detalles.'
  };

  return map[String(item.kind)] ?? fallback;
}

export async function requestPwaNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  return Notification.requestPermission();
}

async function fetchPushApi(accessToken: string, path: string, method = 'GET', body?: unknown): Promise<any> {
  const response = await fetch('/api' + path, {
    method,
    headers: {
      authorization: 'Bearer ' + accessToken,
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store'
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : 'web_push_api_failed';
    throw new Error(message);
  }
  return data;
}

function base64UrlToUint8Array(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function ensurePwaWebPushSubscription(accessToken: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

  const status = await fetchPushApi(accessToken, '/meditation/push/status');
  const vapidPublic = String(status?.vapid_public ?? '').trim();
  if (!vapidPublic || status?.configured !== true) throw new Error('web_push_not_configured');

  const registration = await navigator.serviceWorker.ready;
  if (!registration.pushManager) return false;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(vapidPublic)
    });
  }

  const serialized = subscription.toJSON();
  const endpoint = String(serialized?.endpoint ?? '').trim();
  const p256dh = String(serialized?.keys?.p256dh ?? '').trim();
  const auth = String(serialized?.keys?.auth ?? '').trim();
  if (!endpoint || !p256dh || !auth) throw new Error('invalid_push_subscription');

  await fetchPushApi(accessToken, '/meditation/push/subscribe', 'POST', {
    endpoint,
    p256dh,
    auth,
    expiration_time: serialized?.expirationTime ?? null,
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 512) : null
  });

  try {
    localStorage.setItem(PUSH_PUBLIC_KEY_CACHE, vapidPublic);
    localStorage.setItem(PUSH_PUBLIC_KEY_CACHE + ':endpoint', endpoint);
  } catch {}
  return true;
}

export async function removePwaWebPushSubscription(accessToken: string, endpoint?: string): Promise<boolean> {
  const knownEndpoint = String(endpoint || localStorage.getItem(PUSH_PUBLIC_KEY_CACHE + ':endpoint') || '').trim();
  if (!knownEndpoint) return false;
  await fetchPushApi(accessToken, '/meditation/push/unsubscribe', 'POST', { endpoint: knownEndpoint });
  return true;
}

export async function showPwaNotification(item: PwaNotificationItem): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }
  if (!('serviceWorker' in navigator)) return false;

  const registration = await navigator.serviceWorker.ready;
  const copy = humanizeMeditationNotification(item);
  const notificationId = String(item.notification_id);
  const target = '/pwa/#notification=' + encodeURIComponent(notificationId);

  await registration.showNotification(copy.title, {
    body: copy.body,
    icon: '/pwa/icons/aria.svg',
    badge: '/pwa/icons/aria.svg',
    tag: 'aria-meditation-' + notificationId,
    renotify: true,
    data: {
      notificationId,
      url: target
    }
  });

  return true;
}

export function getNotificationIdFromHash(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(raw);
  const value = params.get('notification');
  return value ? value.trim() : null;
}
