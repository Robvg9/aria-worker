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
