import { useEffect, useRef, useState } from 'react';
import { ProjectWorkspace } from './ProjectWorkspace';
import { missionActivityLabel, missionGoalPreview, missionHumanTitle, missionListLabel } from './missionPresentation';
import { TEST_CATALOG, TEST_CATALOG_VERSION } from './testCatalog';
import { getNotificationIdFromHash, humanizeMeditationDetail, humanizeMeditationNotification, requestPwaNotificationPermission, showPwaNotification, type PwaNotificationItem } from './notifications';

const API = '/api';
const CACHE_PREFIX = 'aria-runtime-cache-v3';
const CACHE_TTL_MS: Record<string, number> = { system: 15000, capabilities: 21600000, active_mission: 10000, meditation_overview: 21600000 };
const ANON = 'sb_publishable_E2AmZNo2hAbOYlytkVbyBQ_X7JH0HPw';
const SESSION_KEY = 'aria_session_v2';
const UI_PREFS_KEY = 'aria_ui_preferences_v1';
const BUILD = import.meta.env.VITE_BUILD ?? '2026.09.19-pwa-v9';
const MEDITATION_LIVE_POLL_MS = 2500;
function shortBuild(build: string) {
  const value = String(build || '');
  return value.length > 10 ? value.slice(0, 8) + '…' : value;
}

type UiPrefs = { swipeNavigation: boolean; animations: boolean };

function readUiPrefs(): UiPrefs {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_PREFS_KEY) || 'null');
    return {
      swipeNavigation: true,
      animations: parsed?.animations !== false
    };
  } catch {
    return { swipeNavigation: true, animations: true };
  }
}

function saveUiPrefs(next: UiPrefs) {
  try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next)); } catch {}
  window.dispatchEvent(new Event('aria-ui-settings-changed'));
}

const SWIPE_PAGES = ['#home', '#chat', '#projects', '#meditation', '#capabilities', '#settings'];

function navigationSwipeIndex(nav: NavigationState): number {
  if (nav.page === 'projects') return 2;
  if (nav.page === 'meditation') return 3;
  if (nav.page === 'capabilities') return 4;
  if (nav.page === 'settings') return 5;
  return nav.screen === 1 ? 1 : 0;
}

type Session = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: number;
  email?: string;
};

type Message = { id: string; role: 'user' | 'aria'; text: string; processingMs?: number };
type CapabilityCatalog = {
  summary: Record<string, number>;
  executors: any[];
  models: any[];
  agents: any[];
  devices: any[];
  connections: any[];
  generated_at: string;
};
type Mission = any;
type MissionEvent = any;
type AppPage = 'aria' | 'meditation' | 'capabilities' | 'projects' | 'settings';

type NavigationState = {
  page: AppPage;
  screen: 0 | 1;
  newMission: boolean;
};

function navigationFromHash(hash = window.location.hash): NavigationState {
  switch (hash) {
    case '#chat': return { page: 'aria', screen: 1, newMission: false };
    case '#mission': return { page: 'aria', screen: 0, newMission: true };
    case '#projects': return { page: 'projects', screen: 0, newMission: false };
    case '#meditation': return { page: 'meditation', screen: 0, newMission: false };
    case '#capabilities': return { page: 'capabilities', screen: 0, newMission: false };
    case '#settings': return { page: 'settings', screen: 0, newMission: false };
    default: return { page: 'aria', screen: 0, newMission: false };
  }
}

function formatProcessingTime(ms: number): string {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 1000) return value + ' ms';
  return (value / 1000).toFixed(value < 10000 ? 1 : 0) + ' s';
}
function processingLabel(ms: number): string {
  if (ms < 1500) return 'ARIA está analizando tu mensaje…';
  if (ms < 4000) return 'ARIA está procesando el contexto…';
  if (ms < 10000) return 'ARIA está razonando y preparando la respuesta…';
  return 'ARIA sigue procesando la respuesta…';
}

function missionResultText(mission: any): string {
  const results = mission?.checkpoint?.results && typeof mission.checkpoint.results === 'object' ? mission.checkpoint.results : {};
  const preferredKeys = ['summary_1', 'crosscheck_1', 'facts_1'];
  for (const key of preferredKeys) {
    const value = results[key];
    const found = [value?.response?.content, value?.response?.text, value?.stdout, value?.output, value?.message, value?.result?.response?.content]
      .find((v: any) => typeof v === 'string' && v.trim());
    if (found) return String(found).trim();
  }
  const structured: string[] = [];
  for (const value of Object.values(results) as any[]) {
    const found = [value?.response?.content, value?.response?.text, value?.stdout, value?.output, value?.message, value?.result?.response?.content]
      .find((v: any) => typeof v === 'string' && v.trim());
    if (found) structured.push(String(found).trim());
  }
  if (structured.length) return structured[structured.length - 1];
  const direct = [mission?.last_stdout, mission?.last_stderr]
    .map((v: any) => typeof v === 'string' ? v.trim() : '')
    .filter(Boolean)
    .filter((v: string) => !/^(retry[_-]?exhausted|retryexhaustedreplanned|executor_error|verification_failed|device_enqueue_\d+|human_gate_required)$/i.test(v));
  if (direct.length) return direct.join('\n\n');
  const internal = String(mission?.last_stderr || mission?.next_action || '').trim().toLowerCase();
  const human: Record<string,string> = {
    retryexhaustedreplanned: 'ARIA tuvo que descartar una estrategia que agotó sus reintentos, generó una alternativa y continuó con ella. El detalle verificable de la misión aparece en su respuesta y evidencia.',
    retry_exhausted_replanned: 'ARIA tuvo que descartar una estrategia que agotó sus reintentos, generó una alternativa y continuó con ella. El detalle verificable de la misión aparece en su respuesta y evidencia.',
    retry_exhausted_all_strategies: 'ARIA agotó las estrategias gobernadas disponibles para esta misión y necesita una nueva intervención antes de continuar.',
    executor_error: 'Uno de los executors de ARIA no pudo completar su paso. La misión conserva la evidencia para diagnosticarlo.',
    verification_failed: 'La comprobación del resultado no fue válida. La misión conserva la evidencia necesaria para corregir el problema.'
  };
  return human[internal] || '';
}
function humanOperation(operation: any, executorType: any): string {
  const op = String(operation || '');
  const ex = String(executorType || '');
  if (op === 'text_generation') return 'procesar y generar la respuesta con el motor de IA';
  if (op === 'shell.execute') return 'ejecutar una instrucción controlada en el dispositivo';
  if (op === 'file.read') return 'leer información de un archivo';
  if (op === 'file.write') return 'escribir información en un archivo';
  if (op === 'database.query') return 'consultar información de la base de datos';
  if (op === 'database.write') return 'actualizar información en la base de datos';
  if (op === 'cloud.deploy') return 'desplegar cambios en la nube';
  if (ex === 'model') return 'procesar la misión con el motor de IA';
  if (ex === 'device') return 'realizar una acción controlada en un dispositivo';
  return op || ex || 'ejecutar un paso gobernado';
}

function missionHumanSummary(mission: any) {
  const steps = Array.isArray(mission?.steps) ? mission.steps : (Array.isArray(mission?.checkpoint?.plan) ? mission.checkpoint.plan : []);
  const completed = steps.filter((step: any) => ['succeeded', 'skipped'].includes(String(step?.status)));
  const operations = completed.map((step: any) => humanOperation(step?.operation, step?.executor_type));
  const uniqueOperations = Array.from(new Set(operations));
  const readOnly = steps.length > 0 && steps.every((step: any) => String(step?.risk || '').toUpperCase() === 'READ' && !/(write|create|update|delete|deploy)/i.test(String(step?.operation || '')));
  const result = missionResultText(mission);
  const hasMemoryRecall = Boolean(mission?.checkpoint?.cognitive_loop?.recalled_before_planning);
  const what = completed.length ? 'ARIA completó ' + completed.length + ' paso' + (completed.length === 1 ? '' : 's') + ' y los verificó correctamente.' : 'ARIA todavía no tiene pasos completados para resumir.';
  const how = [hasMemoryRecall ? 'Primero recuperó contexto de su memoria autorizada.' : '', uniqueOperations.length ? 'Después realizó: ' + uniqueOperations.join(', ') + '.' : '', 'Al terminar, comprobó el resultado según las reglas de verificación de la misión.'].filter(Boolean).join(' ');
  const changed = readOnly ? 'No realizó cambios en ARIA ni en sistemas externos; esta misión fue de lectura/análisis.' : 'La misión incluyó operaciones con capacidad de modificar información. Los cambios concretos deben describirse a partir del resultado real de cada paso, nunca suponerse.';
  const improvement = readOnly ? 'No se modificó el sistema. El valor de esta misión es la información o respuesta obtenida y verificada.' : 'La mejora esperada es la definida por el objetivo de la misión y solo se considera realizada cuando el resultado la demuestra.';
  const expected = result ? 'Resultado obtenido:' : 'Resultado esperado: la misión debía producir un resultado verificable para el objetivo indicado.';
  return { what, how, changed, improvement, expected, result };
}

function cacheKey(kind: string, userId: string) {
  return CACHE_PREFIX + ':' + userId + ':' + kind;
}

function readCached<T>(kind: string, userId: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(kind, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ttl = CACHE_TTL_MS[kind] ?? 30000;
    if (!Number.isFinite(parsed?.savedAt) || Date.now() - Number(parsed.savedAt) > ttl) {
      localStorage.removeItem(cacheKey(kind, userId));
      return null;
    }
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function writeCached<T>(kind: string, userId: string, data: T) {
  try {
    localStorage.setItem(cacheKey(kind, userId), JSON.stringify({ savedAt: Date.now(), data }));
  } catch {}
}

const CHAT_HISTORY_KEY_PREFIX = 'aria-chat-history-v1';

type CachedChatHistory = {
  conversationId: string | null;
  messages: Message[];
  pendingMission: { goal: string; conversationId: string } | null;
  savedAt: number;
};

function chatHistoryKey(userId: string) {
  return CHAT_HISTORY_KEY_PREFIX + ':' + userId;
}

function readChatHistory(userId: string): CachedChatHistory | null {
  try {
    const raw = localStorage.getItem(chatHistoryKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.messages)) return null;
    return {
      conversationId: typeof parsed.conversationId === 'string' ? parsed.conversationId : null,
      messages: parsed.messages
        .filter((m: any) => m && (m.role === 'user' || m.role === 'aria') && typeof m.text === 'string')
        .map((m: any) => ({
          id: String(m.id || crypto.randomUUID()),
          role: m.role,
          text: String(m.text),
          ...(Number.isFinite(Number(m.processingMs)) ? { processingMs: Number(m.processingMs) } : {})
        })),
      pendingMission: parsed?.pendingMission && typeof parsed.pendingMission.goal === 'string'
        ? {
            goal: String(parsed.pendingMission.goal),
            conversationId: String(parsed.pendingMission.conversationId || parsed.conversationId || '')
          }
        : null,
      savedAt: Number(parsed.savedAt) || Date.now()
    };
  } catch {
    return null;
  }
}

function writeChatHistory(
  userId: string,
  conversationId: string | null,
  messages: Message[],
  pendingMission: { goal: string; conversationId: string } | null
) {
  try {
    localStorage.setItem(chatHistoryKey(userId), JSON.stringify({
      conversationId,
      messages: messages.slice(-120),
      pendingMission,
      savedAt: Date.now()
    } satisfies CachedChatHistory));
  } catch {}
}

const HUMAN_API_ERRORS: Record<string, string> = {
  app_api_unreachable: 'No pude conectar con ARIA. La red está inestable; los datos que ya estaban cargados se mantienen disponibles.',
  conversation_persist_failed: 'No se pudo guardar el mensaje del chat. ARIA intentará mantener la conversación disponible.',
  conversation_model_execution_failed: 'El modelo que tomó la solicitud no pudo completar la respuesta. ARIA agotó las rutas disponibles; inténtalo de nuevo.',
  conversation_planner_failed: 'El planificador de ARIA no respondió. La interfaz sigue disponible y puedes reintentar.',
  project_conversation_lookup_failed: 'No se pudo abrir el chat de este proyecto. ARIA está reparando la conexión del chat; vuelve a entrar en unos segundos.',
  invalid_or_expired_session: 'La sesión de ARIA expiró. Vuelve a entrar para continuar.'
};

async function api(path: string, token: string, init: RequestInit = {}) {
  const method = String(init.method ?? 'GET').toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const attempts = isRead ? 2 : 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const headers = new Headers(init.headers);
    headers.set('authorization', 'Bearer ' + token);
    if (init.body) headers.set('content-type', 'application/json');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), isRead ? 9000 : path.endsWith('/conversation') ? 30000 : 20000);
    try {
      const response = await fetch(API + path, { ...init, headers, cache: 'no-store', signal: controller.signal });
      const raw = await response.text();
      let data: any = null;
      try { data = raw ? JSON.parse(raw) : null; } catch {}
      if (!response.ok) {
        const code = String(data?.error ?? 'aria_api_error');
        const detail = HUMAN_API_ERRORS[code];
        throw new Error(detail ?? code);
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await new Promise(resolve => window.setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(isRead
          ? 'ARIA está tardando en actualizar los datos. Los datos guardados siguen disponibles.'
          : 'ARIA tardó demasiado en responder. Revisa la conexión e inténtalo de nuevo.');
      }
      if (error instanceof TypeError) {
        throw new Error('No pude conectar con ARIA. Revisa la conexión e inténtalo de nuevo.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('No se pudo conectar con ARIA.');
}

async function parseAuthResponse(response: Response) {
  const d: any = await response.json().catch(() => ({}));
  if (!response.ok || !d.access_token || !d.user?.id) {
    throw new Error(d.error_description || d.msg || d.error || 'No se pudo iniciar sesión.');
  }
  return d;
}

async function signInDirect(email: string, password: string) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7000);
  try {
    const r = await fetch('https://icuqsstxfdbvjytkhlog.supabase.co/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON },
      body: JSON.stringify({ email: email.trim(), password }),
      cache: 'no-store',
      signal: controller.signal
    });
    return parseAuthResponse(r);
  } finally {
    window.clearTimeout(timer);
  }
}

async function signInProxy(email: string, password: string) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch('/auth/token?grant_type=password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON },
      body: JSON.stringify({ email: email.trim(), password }),
      cache: 'no-store',
      signal: controller.signal
    });
    return parseAuthResponse(r);
  } finally {
    window.clearTimeout(timer);
  }
}

async function refreshSessionDirect(refreshToken: string) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7000);
  try {
    const r = await fetch('https://icuqsstxfdbvjytkhlog.supabase.co/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
      signal: controller.signal
    });
    return parseAuthResponse(r);
  } finally {
    window.clearTimeout(timer);
  }
}

async function refreshSessionProxy(refreshToken: string) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const r = await fetch('/auth/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
      signal: controller.signal
    });
    return parseAuthResponse(r);
  } finally {
    window.clearTimeout(timer);
  }
}

async function refreshSession(session: Session) {
  let directError: unknown = null;
  try {
    const d: any = await refreshSessionDirect(session.refreshToken);
    return {
      ...session,
      accessToken: d.access_token,
      refreshToken: d.refresh_token || session.refreshToken,
      expiresAt: Date.now() + Math.max(60, Number(d.expires_in ?? 3600)) * 1000,
      email: d.user?.email || session.email
    } satisfies Session;
  } catch (error) {
    directError = error;
    const retryable = error instanceof DOMException && error.name === 'AbortError' || error instanceof TypeError;
    if (!retryable) throw error;
  }
  try {
    const d: any = await refreshSessionProxy(session.refreshToken);
    return {
      ...session,
      accessToken: d.access_token,
      refreshToken: d.refresh_token || session.refreshToken,
      expiresAt: Date.now() + Math.max(60, Number(d.expires_in ?? 3600)) * 1000,
      email: d.user?.email || session.email
    } satisfies Session;
  } catch (error) {
    if ((error instanceof DOMException && error.name === 'AbortError') || error instanceof TypeError) {
      throw new Error('ARIA no pudo renovar la sesión por ninguna de sus rutas.');
    }
    if (error instanceof Error && error.message) throw error;
    throw directError instanceof Error ? directError : new Error('No se pudo renovar la sesión.');
  }
}

async function signIn(email: string, password: string) {
  let directError: unknown = null;
  try {
    const d: any = await signInDirect(email, password);
    const s: Session = {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      userId: d.user.id,
      expiresAt: Date.now() + Math.max(60, Number(d.expires_in ?? 3600)) * 1000,
      email: d.user.email
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  } catch (error) {
    directError = error;
    const retryable = error instanceof DOMException && error.name === 'AbortError' || error instanceof TypeError;
    if (!retryable) throw error;
  }

  try {
    const d: any = await signInProxy(email, password);
    const s: Session = {
      accessToken: d.access_token,
      refreshToken: d.refresh_token,
      userId: d.user.id,
      expiresAt: Date.now() + Math.max(60, Number(d.expires_in ?? 3600)) * 1000,
      email: d.user.email
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  } catch (proxyError) {
    if ((proxyError instanceof DOMException && proxyError.name === 'AbortError') || proxyError instanceof TypeError) {
      throw new Error('ARIA no pudo alcanzar el servicio de autenticación por ninguna de sus rutas. La red o el servicio de autenticación está tardando demasiado.');
    }
    if (proxyError instanceof Error && proxyError.message) throw proxyError;
    throw directError instanceof Error ? directError : new Error('No se pudo iniciar sesión.');
  }
}
function activeMissionRank(status: any, leaseOwner?: any, leaseUntil?: any): number {
  const value = String(status ?? '').toLowerCase();
  const leased = Boolean(leaseOwner && leaseUntil && new Date(String(leaseUntil)).getTime() > Date.now());
  // La superficie "EJECUCIÓN EN TIEMPO REAL" representa trabajo que realmente
  // está siendo ejecutado o esperando una condición externa de esa ejecución.
  // Planning/queued/paused son estados de cola/control, no una ejecución viva.
  if (value === 'running' && leased) return 60;
  if (value === 'running') return 50;
  if (value === 'waiting' && leased) return 45;
  if (value === 'waiting') return 40;
  return 0;
}

function selectLiveMission(overview: any): any | null {
  const candidates = [
    ...(Array.isArray(overview?.missions) ? overview.missions : []),
    overview?.active_mission
  ].filter(Boolean);
  const unique = Array.from(new Map(candidates.map((m: any) => [String(m.mission_id), m])).values());
  return unique
    .filter((m: any) => activeMissionRank(m.status, m.lease_owner, m.lease_until) > 0)
    .sort((a: any, b: any) =>
      activeMissionRank(b.status, b.lease_owner, b.lease_until) - activeMissionRank(a.status, a.lease_owner, a.lease_until) ||
      new Date(String(b.updated_at || 0)).getTime() - new Date(String(a.updated_at || 0)).getTime()
    )[0] ?? null;
}

function humanNextAction(action: any, status: string): string {
  const value = String(action ?? '').trim();
  if (!value) return status === 'succeeded' ? 'Misión finalizada.' : 'Continuar con la misión.';
  const lower = value.toLowerCase();
  if (lower.startsWith('replan:')) return 'Descartar la estrategia fallida y preparar una alternativa gobernada.';
  if (lower.startsWith('retry:')) return 'Reintentar el paso con una ruta gobernada disponible.';
  if (lower.startsWith('execute:')) return 'Ejecutar el siguiente paso de la misión.';
  if (lower.startsWith('verify:')) return 'Verificar el resultado del paso actual.';
  if (lower.startsWith('recovery:')) return 'Aplicar la recuperación registrada y volver a ejecutar la misión.';
  if (lower.startsWith('resume:')) return 'Reanudar la misión cuando la condición pendiente esté lista.';
  if (lower.startsWith('manual:')) return 'Esperar una intervención humana para resolver el bloqueo.';
  if (lower === 'next_ready_batch') return 'Preparar y ejecutar el siguiente paso de la misión.';
  if (lower === 'verify_goal') return 'Comprobar el resultado final de la misión.';
  if (lower === 'none') return 'Sin pasos pendientes.';
  return value;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    succeeded: 'Completada',
    failed: 'Fallida',
    blocked: 'Bloqueada',
    cancelled: 'Cancelada',
    running: 'Ejecutándose',
    queued: 'En cola',
    planning: 'Planificando',
    paused: 'Pausada',
    active: 'Activa',
    online: 'Online',
    available: 'Disponible',
    connected: 'Conectada',
    unavailable: 'No disponible',
    degraded: 'Degradada',
    stopped: 'Detenida'
  };
  return map[status] ?? status;
}

function verificationLabel(step: any) {
  const result = step?.result && typeof step.result === 'object' ? step.result : {};
  if (result.__aria_verification_evidence?.verified === true) return 'Verificación PASS';
  const value = String(result.verification_status ?? result.repair?.verification_status ?? '').toLowerCase();
  if (value === 'verified') return 'Verificación PASS';
  if (value.includes('pending') || value.includes('awaiting')) return 'Verificación pendiente';
  if (value === 'failed' || value === 'error' || value === 'unverified') return 'Verificación fallida';
  if (step?.status === 'succeeded') return 'Verificación registrada';
  if (['running', 'planning'].includes(String(step?.status))) return 'Se verificará al terminar el paso';
  if (String(step?.status) === 'queued') return 'Pendiente de ejecución';
  return 'Pendiente de verificación';
}
function tone(status: string) {
  if (['succeeded', 'available', 'connected', 'online', 'active'].includes(status)) return 'good';
  if (['failed', 'blocked', 'cancelled', 'unavailable'].includes(status)) return 'bad';
  if (['running', 'planning', 'queued'].includes(status)) return 'live';
  return 'neutral';
}

function formatDate(value?: string) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return value;
  }
}

function renderInlineMarkdown(value: string) {
  const token = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|\x60[^\x60\n]+\x60|\[[^\]\n]+\]\(https?:\/\/[^)]+\)|\*[^*\n]+?\*|_[^_\n]+?_)/g;
  return value.split(token).filter(part => part !== '').map((part, index) => {
    const key = String(index);
    if (/^\*\*[\s\S]+\*\*$/.test(part) || /^__[\s\S]+__$/.test(part)) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (/^~~[\s\S]+~~$/.test(part)) return <del key={key}>{part.slice(2, -2)}</del>;
    if (/^\x60[\s\S]+\x60$/.test(part)) return <code key={key} className='markdownInlineCode'>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={key} href={link[2]} target='_blank' rel='noreferrer'>{renderInlineMarkdown(link[1])}</a>;
    if (/^\*[\s\S]+\*$/.test(part)) return <strong key={key}>{part.slice(1, -1)}</strong>;
    if (/^_[\s\S]+_$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;
    return <span key={key}>{part}</span>;
  });
}

function renderMarkdown(value: string) {
  const text = String(value ?? '').replace(/\r/g, '');
  const lines = text.split('\n');
  const blocks: any[] = [];
  let codeBuffer: string[] | null = null;

  const flushCode = () => {
    if (codeBuffer === null) return;
    blocks.push(<pre key={'code-' + blocks.length}><code>{codeBuffer.join('\n')}</code></pre>);
    codeBuffer = null;
  };

  lines.forEach((line, index) => {
    if (line.trim().startsWith('```')) {
      if (codeBuffer === null) codeBuffer = []; else flushCode();
      return;
    }
    if (codeBuffer !== null) { codeBuffer.push(line); return; }
    if (!line.trim()) { blocks.push(<div key={'blank-' + index} className='markdownSpacer' />); return; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { blocks.push(<div key={'h-' + index} className={'markdownHeading markdownH' + heading[1].length}>{renderInlineMarkdown(heading[2])}</div>); return; }
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      const number = line.match(/^\s*(\d+)[.)]/)?.[1] ?? '';
      blocks.push(<div key={'ol-' + index} className='markdownListItem'>{number}. {renderInlineMarkdown(ordered[1])}</div>);
      return;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (unordered) { blocks.push(<div key={'ul-' + index} className='markdownListItem'>• {renderInlineMarkdown(unordered[1])}</div>); return; }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) { blocks.push(<blockquote key={'q-' + index}>{renderInlineMarkdown(quote[1])}</blockquote>); return; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { blocks.push(<hr key={'hr-' + index} />); return; }
    blocks.push(<p key={'p-' + index}>{renderInlineMarkdown(line)}</p>);
  });

  flushCode();
  return blocks;
}
function useLiveSync(load: () => Promise<void>, token: string, intervalMs: number) {
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    let stopped = false;
    let running = false;
    const run = async () => {
      if (stopped || running || !navigator.onLine || document.visibilityState === 'hidden') return;
      running = true;
      try { await loadRef.current(); } finally { running = false; }
    };
    const wake = () => { if (document.visibilityState !== 'hidden') void run(); };
    void run();
    const timer = window.setInterval(() => void run(), intervalMs);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [token, intervalMs]);
}

function GlobalBottomNav({ navigation, onProjects, onMeditation, onCapabilities }: {
  navigation: NavigationState;
  onProjects: () => void;
  onMeditation: () => void;
  onCapabilities: () => void;
}) {
  const go = (hash:string) => { window.location.hash = hash; };
  return (
    <nav className='bottomNav' aria-label='Navegación principal'>
      <button title='Inicio' type='button' className={navigation.page === 'aria' && navigation.screen === 0 ? 'active' : ''} aria-label='Inicio' onClick={() => go('#home')}><span>⌂</span><small>Inicio</small></button>
      <button title='Chat' type='button' className={navigation.page === 'aria' && navigation.screen === 1 ? 'active' : ''} aria-label='Chat' onClick={() => go('#chat')}><span>💬</span><small>Chat</small></button>
      <button title='Nueva misión' type='button' className='bottomNavPrimary' aria-label='Nueva misión' onClick={() => go('#mission')}><span>＋</span><small>Misión</small></button>
      <button title='Proyectos' type='button' className={navigation.page === 'projects' ? 'active' : ''} aria-label='Proyectos' onClick={onProjects}><span>◈</span><small>Proyectos</small></button>
      <button title='Meditación IA' type='button' className={navigation.page === 'meditation' ? 'active' : ''} aria-label='Meditación IA' onClick={onMeditation}><span>◌</span><small>Medita</small></button>
      <button title='Capacidades' type='button' className={navigation.page === 'capabilities' ? 'active' : ''} aria-label='Capacidades' onClick={onCapabilities}><span>⚙</span><small>Cap.</small></button>
      <button title='Configuración' type='button' className={navigation.page === 'settings' ? 'active' : ''} aria-label='Configuración' onClick={() => go('#settings')}><span>☰</span><small>Config.</small></button>
    </nav>
  );
}

function InstallButton() {
  const [event, setEvent] = useState<any>(null);
  useEffect(() => {
    const onBefore = (e: any) => { e.preventDefault(); setEvent(e); };
    window.addEventListener('beforeinstallprompt', onBefore);
    return () => window.removeEventListener('beforeinstallprompt', onBefore);
  }, []);
  if (!event) return null;
  return <button className='ghost' onClick={() => event.prompt()}>Instalar PWA</button>;
}

function Auth({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try { onSignedIn(await signIn(email, password)); }
    catch (x) { setError(x instanceof Error ? x.message : 'No se pudo iniciar sesión.'); }
    finally { setBusy(false); }
  }
  return (
    <main className='authScreen'>
      <div className='authGlow' />
      <form className='authCard' onSubmit={submit}>
        <div className='brandMark'>A</div>
                <h1>Tu centro de mando cognitivo.</h1>
        <p>Conversación, misiones, modelos, agentes, dispositivos y Meditación IA en una sola interfaz.</p>
        <input aria-label='Correo' type='email' inputMode='email' value={email} onChange={e => setEmail(e.target.value)} placeholder='Correo electrónico' autoComplete='username' />
        <input aria-label='Contraseña' type='password' value={password} onChange={e => setPassword(e.target.value)} placeholder='Contraseña' autoComplete='current-password' />
        {error && <div className='errorBox'><div>{error}</div>{error.includes('sincronizar') && <button className='ghost' disabled={syncing} onClick={() => void load()}>{syncing ? 'Sincronizando…' : 'Reintentar ahora'}</button>}</div>}
        <button className='primary wide' disabled={busy}>{busy ? 'ENTRANDO…' : 'ENTRAR EN ARIA'}</button>
      </form>
    </main>
  );
}

function StatCard({ value, label, color = '' }: { value: string | number; label: string; color?: string }) {
  return <div className='statCard'><div className={'statValue ' + color}>{value}</div><div className='statLabel'>{label}</div></div>;
}

function QuickCatalogModal({ title, items, onClose }: { title: string; items: any[]; onClose: () => void }) {
  return (
    <div className='modalBackdrop' onClick={onClose}>
      <section className='detailModal compactModal' onClick={e => e.stopPropagation()}>
        <div className='detailTop'>
          <div><div className='eyebrow'>INVENTARIO RÁPIDO</div><h2>{title}</h2><div className='muted'>{items.length} elementos disponibles en la última sincronización.</div></div>
          <button className='ghost' onClick={onClose}>Cerrar</button>
        </div>
        <div className='catalogList'>
          {items.slice(0, 40).map((item: any, index: number) => {
            const id = item.model_id ?? item.agent_id ?? item.device_id ?? item.id ?? item.provider_id ?? index;
            const title = item.display_name ?? item.agent_id ?? item.name ?? item.provider_id ?? item.id ?? 'Elemento';
            const sub = item.model_id ?? item.role ?? item.type ?? item.agent_type ?? item.purpose ?? '';
            const st = item.status ?? item.integration_status ?? 'available';
            return <div className='catalogRow' key={id}><div><strong>{title}</strong><small>{sub}</small></div><span className={'pill ' + tone(st)}>{statusLabel(st)}</span></div>;
          })}
          {!items.length && <div className='emptyState'>Todavía no hay datos disponibles para este inventario.</div>}
        </div>
      </section>
    </div>
  );
}

function CapabilityCenter({
  caps,
  userId
}: {
  caps: CapabilityCatalog | null;
  userId: string;
}) {
  const CAP_TAB_KEY='aria_capabilities_tab_v3:'+userId;
  const [tab, setTab] = useState<'overview' | 'models' | 'agents' | 'devices' | 'executors' | 'connections' | 'tests'>(() => {
    try {
      const saved = localStorage.getItem(CAP_TAB_KEY);
      return (saved as any) || 'overview';
    } catch {
      return 'overview';
    }
  });
  const [filter, setFilter] = useState('');
  const [testCategory, setTestCategory] = useState('Todas');
  const [selectedTest, setSelectedTest] = useState<(typeof TEST_CATALOG)[number] | null>(null);

  const source = tab === 'models' ? caps?.models ?? [] : tab === 'agents' ? caps?.agents ?? [] : tab === 'devices' ? caps?.devices ?? [] : tab === 'executors' ? caps?.executors ?? [] : tab === 'connections' ? caps?.connections ?? [] : [];
  const q = filter.trim().toLowerCase();
  const filtered = q ? source.filter((item: any) => JSON.stringify(item).toLowerCase().includes(q)) : source;

  const testCategories = ['Todas', ...Array.from(new Set(TEST_CATALOG.map(test => test.category)))];
  const filteredTests = TEST_CATALOG.filter(test => {
    const categoryOk = testCategory === 'Todas' || test.category === testCategory;
    const queryOk = !q || JSON.stringify(test).toLowerCase().includes(q);
    return categoryOk && queryOk;
  });

  function saveTab(next: typeof tab) {
    setTab(next);
    setFilter('');
    if (next !== 'tests') setTestCategory('Todas');
    try { localStorage.setItem(CAP_TAB_KEY,next); } catch {}
  }

  return (
    <main className='appShell'>
      <header className='topBar'>
        <div><div className='eyebrow'>ARIA / UNIVERSO</div><h1>Centro de capacidades</h1><div className='sub'>Inventario real, pruebas, cobertura y rutas gobernadas.</div></div>
      </header>
      <div className='pageBodyViewport capabilitiesViewport'>
        <section className='panel'>
          <div className='capHero'>
            <div className='heroOrb smallOrb'>ARIA</div>
            <div><div className='eyebrow'>INVENTARIO LIVE</div><div className='capHeroText'>{caps ? (caps.summary.models_available ?? 0) + ' modelos disponibles · ' + (caps.summary.agents_available ?? 0) + ' agentes disponibles · ' + (caps.summary.devices_online ?? 0) + ' dispositivos online' : 'Sincronizando inventario…'}</div><div className='muted'>{caps ? 'Actualizado ' + formatDate(caps.generated_at) : 'Esperando al núcleo'}</div></div>
          </div>

          <div className='capTabs'>
            {(['overview','models','agents','devices','executors','connections','tests'] as const).map(t =>
              <button key={t} className={'tabButton ' + (tab === t ? 'selected' : '')} onClick={() => saveTab(t)}>
                {t === 'overview' ? 'Resumen' : t === 'models' ? 'Modelos' : t === 'agents' ? 'Agentes' : t === 'devices' ? 'Dispositivos' : t === 'executors' ? 'Executors' : t === 'connections' ? 'Conexiones' : 'Pruebas'}
              </button>
            )}
          </div>

          {tab === 'overview' ? (
            caps ? (
              <div className='capGrid'>
                <button className='capTile' onClick={() => saveTab('models')}><span>MODELOS</span><strong>{caps.summary.models ?? 0}</strong><small>{caps.summary.models_available ?? 0} disponibles</small></button>
                <button className='capTile' onClick={() => saveTab('agents')}><span>AGENTES</span><strong>{caps.summary.agents ?? 0}</strong><small>{caps.summary.agents_available ?? 0} disponibles</small></button>
                <button className='capTile' onClick={() => saveTab('devices')}><span>DISPOSITIVOS</span><strong>{caps.summary.devices ?? 0}</strong><small>{caps.summary.devices_online ?? 0} online</small></button>
                <button className='capTile' onClick={() => saveTab('executors')}><span>EXECUTORS</span><strong>{caps.summary.executors ?? 0}</strong><small>rutas gobernadas</small></button>
                <button className='capTile' onClick={() => saveTab('connections')}><span>CONEXIONES</span><strong>{caps.summary.connections ?? 0}</strong><small>estado no sensible</small></button>
                <button className='capTile' onClick={() => saveTab('tests')}><span>PRUEBAS</span><strong>{TEST_CATALOG.length}</strong><small>{TEST_CATALOG.filter(test => test.includedInNpmTest).length} en npm test</small></button>
              </div>
            ) : <div className='emptyState'>No se pudo cargar el inventario.</div>
          ) : tab === 'tests' ? (
            <div className='testCenter'>
              <div className='testCenterStats'>
                <div className='statCard'><div className='statValue'>{TEST_CATALOG.length}</div><div className='statLabel'>Tests catalogados</div></div>
                <div className='statCard'><div className='statValue'>{TEST_CATALOG.filter(test => test.includedInNpmTest).length}</div><div className='statLabel'>Incluidos en npm test</div></div>
                <div className='statCard'><div className='statValue'>{testCategories.length - 1}</div><div className='statLabel'>Áreas de prueba</div></div>
              </div>
              <div className='testCatalogHeader'>
                <div><div className='panelTitle'>CATÁLOGO DE PRUEBAS · v{TEST_CATALOG_VERSION}</div><div className='muted'>Cada entrada muestra qué comprueba, para qué sirve y dónde vive el test.</div></div>
                <span className='pill positive'>{filteredTests.length} visibles</span>
              </div>
              <div className='testCategoryBar'>
                {testCategories.map(category => <button key={category} className={'tabButton ' + (testCategory === category ? 'selected' : '')} onClick={() => setTestCategory(category)}>{category}</button>)}
              </div>
              <div className='searchRow'><input value={filter} onChange={e => setFilter(e.target.value)} placeholder='Buscar por test, área o capacidad…' /><span>{filteredTests.length} resultados</span></div>
              <div className='testCatalogList'>
                {filteredTests.map(test => (
                  <button type='button' className='testCatalogRow' key={test.id} onClick={() => setSelectedTest(test)}>
                    <div className='testCatalogMain'>
                      <div><strong>{test.title}</strong><small>{test.file}</small></div>
                      <div className='testCatalogMeta'><span className='pill'>{test.category}</span><span className={'pill ' + (test.includedInNpmTest ? 'positive' : '')}>{test.includedInNpmTest ? 'CI · npm test' : 'Catálogo'}</span></div>
                    </div>
                    <span>›</span>
                  </button>
                ))}
              </div>
              {selectedTest && <div className='modalBackdrop' onClick={() => setSelectedTest(null)}>
                <section className='detailModal testDetailModal' onClick={e => e.stopPropagation()}>
                  <div className='detailTop'>
                    <div><div className='eyebrow'>{selectedTest.category}</div><h2>{selectedTest.title}</h2><div className='muted'>{selectedTest.file}</div></div>
                    <button className='ghost' onClick={() => setSelectedTest(null)}>Cerrar</button>
                  </div>
                  <div className='humanSummaryGrid'>
                    <div><strong>Cómo funciona</strong><p>{selectedTest.how}</p></div>
                    <div><strong>Qué capacidad comprueba</strong><p>{selectedTest.capabilities}</p></div>
                    <div><strong>Ejecución</strong><p>{selectedTest.includedInNpmTest ? 'Forma parte de la batería npm test.' : 'Está catalogado en el repositorio pero no forma parte de npm test.'}</p></div>
                  </div>
                </section>
              </div>}
            </div>
          ) : (
            <>
              <div className='searchRow'><input value={filter} onChange={e => setFilter(e.target.value)} placeholder='Filtrar capacidades…' /><span>{filtered.length} resultados</span></div>
              <div className='catalogList'>
                {filtered.slice(0, 80).map((item: any, index: number) => {
                  const id = item.model_id ?? item.agent_id ?? item.device_id ?? item.id ?? item.provider_id ?? index;
                  const title = item.display_name ?? item.agent_id ?? item.name ?? item.provider_id ?? item.id ?? 'Elemento';
                  const sub = item.model_id ?? item.role ?? item.type ?? item.agent_type ?? item.purpose ?? '';
                  const st = item.status ?? item.integration_status ?? 'available';
                  return <div className='catalogRow' key={id}><div><strong>{title}</strong><small>{sub}</small></div><span className={'pill ' + tone(st)}>{statusLabel(st)}</span></div>;
                })}
                {!filtered.length && <div className='emptyState'>No hay coincidencias.</div>}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}


function MissionDetail({ mission, events, onClose, onRetry, onCancel }: { mission: Mission; events: MissionEvent[]; onClose: () => void; onRetry?: () => Promise<void>; onCancel?: () => Promise<void> }) {
  const [showTechnical, setShowTechnical] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [cancelError, setCancelError] = useState('');
  const status = String(mission.status);
  const terminal = ['succeeded', 'failed', 'blocked', 'cancelled'].includes(status);
  const summary = missionHumanSummary(mission);
  const humanTitle = status === 'succeeded' ? 'Resumen humano' : status === 'failed' ? 'Qué falló' : status === 'blocked' ? 'Diagnóstico del bloqueo' : status === 'waiting' ? 'Verificación en curso' : 'Situación actual';
  return (
    <div className='modalBackdrop' onClick={onClose}>
      <section className='detailModal' onClick={e => e.stopPropagation()}>
        <div className='detailTop'><div><div className='eyebrow'>RESUMEN DE MISIÓN</div><h2>{missionHumanTitle(mission)}</h2>
                  <div className='muted'>{missionGoalPreview(mission)}</div><div className='muted missionActivityHint'>{missionActivityLabel(mission)}</div><span className={'pill ' + tone(status)}>{statusLabel(status)}</span></div><button className='ghost' onClick={onClose}>Cerrar</button></div>
        <div className='detailGrid'>
          <StatCard value={mission.completed_steps ?? 0} label={'Pasos de ' + (mission.total_steps ?? mission.steps?.length ?? '—')} />
          <StatCard value={terminal ? 'Final' : 'En curso'} label='Estado' />
          <StatCard value={formatDate(mission.finished_at)} label='Finalización' />
        </div>
        {mission?.block_details && (status === 'blocked' || status === 'waiting' || status === 'failed' || status === 'paused' || mission.block_details.kind === 'replan_required' || mission.block_details.kind === 'human_gate') && (
          <div className='detailResult recoveryPanel'>
            <div className='panelTitle'>{mission.block_details.kind === 'human_gate' ? 'HUMAN GATE · QUÉ FALTA' : 'BLOQUEO · QUÉ FALTA'}</div>
            <div className='recoveryExplanation'><strong>{mission.block_details.explanation || mission.block_details.reason || 'La misión necesita una intervención antes de continuar.'}</strong><p>{mission.block_details.reason}</p></div>
            <div className='recoverySteps'><strong>Cómo solucionarlo</strong>{(mission.block_details.steps?.length ? mission.block_details.steps : [mission.block_details.remediation || mission.block_details.next_action || 'Revisar el diagnóstico y corregir la causa.','Cuando quede resuelto, vuelve a ejecutar la misión.']).map((stepText: string, index: number) => <div className='recoveryStep' key={String(index) + stepText}><span>{index + 1}</span><p>{stepText}</p></div>)}</div>
            <div className='recoveryActions'>
              {mission.block_details.link && <a className='ghost recoveryLink' href={mission.block_details.link} target='_blank' rel='noreferrer'>{mission.block_details.link_label || 'Abrir recurso relacionado'}</a>}
              {onRetry && mission.block_details.retry_ready !== false && <button className='primary' disabled={retrying || cancelling} onClick={async () => { setRetrying(true); setRetryError(''); try { await onRetry(); } catch (e) { setRetryError(e instanceof Error ? e.message : 'No se pudo reintentar la misión.'); } finally { setRetrying(false); } }}>{retrying ? 'Reintentando…' : 'Reintentar misión'}</button>}
            </div>
            {retryError && <div className='errorBox'>{retryError}</div>}
            {cancelError && <div className='errorBox'>{cancelError}</div>}
            {mission.block_details.evidence && <div className='muted'>Evidencia: paso {String(mission.block_details.evidence.step_id || '—')} · {String(mission.block_details.evidence.operation || 'operación')} · {String(mission.block_details.evidence.verification_status || mission.block_details.evidence.result_status || 'estado registrado')}</div>}
          </div>
        )}
        {mission?.block_details && (
          <div className='detailResult'>
            <div className='panelTitle'>{status === 'blocked' ? 'POR QUÉ QUEDÓ BLOQUEADA' : 'RECUPERACIÓN / VERIFICACIÓN'}</div>
            <div className='humanSummaryGrid'>
              <div><strong>Motivo</strong><p>{mission.block_details.reason || 'Sin motivo registrado.'}</p></div>
              <div><strong>Qué está haciendo ARIA</strong><p>{mission.block_details.next_action || 'ARIA determinará la siguiente estrategia gobernada.'}</p></div>
              <div><strong>Cómo solucionarlo</strong><p>{mission.block_details.remediation || 'Generar una estrategia alternativa con la evidencia disponible.'}</p></div>
              <div><strong>¿Se puede recuperar?</strong><p>{mission.block_details.recoverable ? 'Sí. La misión conserva evidencia y puede continuar sin repetir innecesariamente el cambio.' : 'No con la estrategia actual. Requiere una nueva intervención gobernada.'}</p></div>
            </div>
            {mission.block_details.evidence && <div className='muted'>Evidencia: paso {String(mission.block_details.evidence.step_id || '—')} · {String(mission.block_details.evidence.operation || 'operación')} · {String(mission.block_details.evidence.verification_status || mission.block_details.evidence.result_status || 'estado registrado')}</div>}
          </div>
        )}
        <div className='detailResult'>
          <div className='panelTitle'>{humanTitle.toUpperCase()}</div>
          <div className='humanSummaryGrid'>
            <div><strong>Qué hizo ARIA</strong><p>{summary.what}</p></div>
            <div><strong>Cómo lo hizo</strong><p>{summary.how}</p></div>
            <div><strong>Qué cambió</strong><p>{summary.changed}</p></div>
            <div><strong>Qué mejora ahora</strong><p>{summary.improvement}</p></div>
            <div><strong>{summary.result ? 'Resultado obtenido' : 'Resultado esperado'}</strong><p>{summary.expected}</p></div>
          </div>
          <div className='missionAnswer'><div className='panelTitle'>RESPUESTA / RESULTADO DE ARIA</div><div className='markdownBody'>{summary.result ? renderMarkdown(summary.result) : <p>{status === 'succeeded' ? 'La misión terminó, pero ARIA no generó un texto final presentable. La evidencia detallada sigue disponible abajo.' : 'ARIA todavía no tiene una respuesta final presentable. El diagnóstico y la evidencia siguen disponibles.'}</p>}</div></div>
        </div>
        {!terminal && onCancel && (
          <div className='detailResult missionCancelPanel'>
            <div className='panelTitle'>CONTROL DE MISIÓN</div>
            <p className='muted'>Puedes detener esta misión sin afectar las demás. ARIA guardará la cancelación en su timeline.</p>
            <button className='ghost dangerAction' disabled={cancelling} onClick={async () => { if (!window.confirm('¿Cancelar esta misión? ARIA dejará de continuarla y registrará la cancelación.')) return; setCancelling(true); setCancelError(''); try { await onCancel(); } catch (e) { setCancelError(e instanceof Error ? e.message : 'No se pudo cancelar la misión.'); } finally { setCancelling(false); } }}>{cancelling ? 'Cancelando…' : 'Cancelar misión'}</button>
            {cancelError && <div className='errorBox'>{cancelError}</div>}
          </div>
        )}
        <section className='technicalDetails'>
          <button type='button' className='technicalToggle' onClick={() => setShowTechnical(value => !value)} aria-expanded={showTechnical}>
            <span>{showTechnical ? 'Ocultar evidencia técnica' : 'Ver evidencia técnica'}</span><span>{showTechnical ? '⌃' : '⌄'}</span>
          </button>
          {showTechnical && <div className='detailTimeline'>
            <div className='panelTitle'>TIMELINE REAL</div>
            {events.length ? events.map((e: any, i: number) => <div className='timelineRow' key={e.event_id ?? String(e.created_at) + '-' + i}><span className='timelineDot' /><div><strong>{String(e.event_type ?? 'evento').replaceAll('_', ' ')}</strong><small>{formatDate(e.created_at)}</small>{e.payload && <pre>{JSON.stringify(e.payload, null, 2)}</pre>}</div></div>) : <div className='muted'>No hay eventos adicionales disponibles.</div>}
          </div>}
        </section>   </section>
    </div>
  );
}
function PwaNotificationCenter({ session }: { session: Session }) {
  const [items, setItems] = useState<PwaNotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PwaNotificationItem | null>(null);
  const [missionDetail, setMissionDetail] = useState<any>(null);
  const [missionEvents, setMissionEvents] = useState<MissionEvent[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const firstSync = useRef(true);
  const seenKey = 'aria_notification_seen_v1:' + session.userId;

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) setPermission(Notification.permission);
    else setPermission('unsupported');
  }, []);

  async function openNotification(item: PwaNotificationItem) {
    setSelected(item);
    setOpen(true);
    setMissionDetail(null);
    setMissionEvents([]);

    try {
      await api('/meditation/notifications/read', session.accessToken, {
        method: 'POST',
        body: JSON.stringify({ notification_ids: [item.notification_id] })
      });
      setItems(current => current.map(x => x.notification_id === item.notification_id
        ? { ...x, read_at: new Date().toISOString() }
        : x
      ));
      setUnread(current => Math.max(0, current - (item.read_at ? 0 : 1)));
    } catch {}

    if (item.mission_id) {
      const [missionResult, eventsResult] = await Promise.all([
        api('/missions/' + encodeURIComponent(item.mission_id), session.accessToken).catch(() => null),
        api('/missions/' + encodeURIComponent(item.mission_id) + '/events', session.accessToken).catch(() => ({ events: [] }))
      ]);
      if (missionResult?.mission) setMissionDetail(missionResult.mission);
      setMissionEvents(eventsResult?.events ?? []);
    }
  }

  async function loadNotifications() {
    try {
      const data = await api('/meditation/notifications?limit=50', session.accessToken);
      const next = Array.isArray(data?.notifications) ? data.notifications as PwaNotificationItem[] : [];
      setItems(next);
      setUnread(Number(data?.unread_count ?? 0));

      let seen: string[] = [];
      try { seen = JSON.parse(localStorage.getItem(seenKey) || '[]'); } catch {}
      const seenSet = new Set(seen.map(String));
      const fresh = next.filter(item => !seenSet.has(String(item.notification_id)));

      if (firstSync.current) {
        next.forEach(item => seenSet.add(String(item.notification_id)));
        firstSync.current = false;
      } else if (permission === 'granted') {
        for (const item of fresh.slice(0, 3)) {
          try { await showPwaNotification(item); } catch {}
          seenSet.add(String(item.notification_id));
        }
      } else {
        fresh.forEach(item => seenSet.add(String(item.notification_id)));
      }

      const compactSeen = Array.from(seenSet).slice(-200);
      localStorage.setItem(seenKey, JSON.stringify(compactSeen));
    } catch {}
  }

  useLiveSync(loadNotifications, session.accessToken, 8000);

  useEffect(() => {
    const id = getNotificationIdFromHash();
    if (!id || !items.length) return;
    const item = items.find(x => String(x.notification_id) === id);
    if (!item) return;
    window.history.replaceState(null, '', '/pwa/');
    void openNotification(item);
  }, [items]);

  async function enableNotifications() {
    const result = await requestPwaNotificationPermission();
    setPermission(result);
    if (result === 'granted') {
      setOpen(true);
      await loadNotifications();
    }
  }

  const selectedCopy = selected ? humanizeMeditationNotification(selected) : null;

  return (
    <>
      <button
        className='notificationLauncher'
        aria-label={permission === 'granted' ? 'Abrir avisos de ARIA' : 'Activar avisos de ARIA'}
        onClick={() => permission === 'granted' ? setOpen(true) : void enableNotifications()}
      >
        <span>🔔</span>
        <span>{permission === 'granted' ? 'Avisos' : 'Activar avisos'}</span>
        {unread > 0 && <b>{unread}</b>}
      </button>

      {open && (
        <div className='notificationBackdrop' onClick={() => setOpen(false)}>
          <section className='notificationPanel' onClick={e => e.stopPropagation()}>
            <div className='notificationHeader'>
              <div>
                <div className='eyebrow'>ARIA / AVISOS</div>
                <h2>Notificaciones</h2>
                <div className='muted'>{unread} sin leer · Los avisos de Meditación IA llegan desde ARIA.</div>
              </div>
              <button className='ghost' onClick={() => setOpen(false)}>Cerrar</button>
            </div>

            {permission !== 'granted' && (
              <div className='notificationPermission'>
                <strong>Activa los avisos de ARIA en este teléfono.</strong>
                <span>Así las alertas aparecerán como notificaciones de ARIA y podrás tocarlas para abrir el detalle.</span>
                <button className='primary' onClick={() => void enableNotifications()}>Activar avisos</button>
              </div>
            )}

            {selected && selectedCopy && (
              <div className='notificationSelected'>
                <div className='panelTitle'>{selectedCopy.title.toUpperCase()}</div>
                <p>{selectedCopy.body}</p>
                {selected.message && selected.message !== selectedCopy.body && (
                  <div className='muted'>Detalle registrado: {humanizeMeditationDetail(selected)}</div>
                )}
                <div className='notificationMeta'>
                  <span>{formatDate(selected.created_at)}</span>
                  <span>{selected.read_at ? 'Leída' : 'Sin leer'}</span>
                </div>
                {missionDetail && (
                  <button className='primary' onClick={() => {
                    setOpen(false);
                    setSelected(null);
                  }}>Abrir misión completa</button>
                )}
              </div>
            )}

            <div className='notificationList'>
              {items.length ? items.map(item => {
                const copy = humanizeMeditationNotification(item);
                return (
                  <button
                    key={item.notification_id}
                    className={'notificationRow ' + (item.read_at ? 'read' : 'unread')}
                    onClick={() => void openNotification(item)}
                  >
                    <span className={'notificationDot ' + item.severity} />
                    <span className='notificationRowText'>
                      <strong>{copy.title}</strong>
                      <small>{copy.body}</small>
                    </span>
                    <span className='notificationArrow'>›</span>
                  </button>
                );
              }) : (
                <div className='emptyState'>Todavía no hay notificaciones de ARIA.</div>
              )}
            </div>
          </section>
        </div>
      )}

      {missionDetail && (
        <MissionDetail
          mission={missionDetail}
          events={missionEvents}
          onClose={() => {
            setMissionDetail(null);
            setSelected(null);
          }}
        />
      )}
    </>
  );
}

function Chat({
  session,
  onMeditation,
  onCapabilities,
  onProjects
}: {
  session: Session;
  onMeditation: () => void;
  onCapabilities: () => void;
  onProjects: () => void;
}) {
  const cachedChat = readChatHistory(session.userId);
  const [messages, setMessages] = useState<Message[]>(cachedChat?.messages ?? []);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [system, setSystem] = useState<any>(() => readCached('system', session.userId));
  const [caps, setCaps] = useState<CapabilityCatalog | null>(() => readCached('capabilities', session.userId));
  const [mission, setMission] = useState<Mission | null>(() => readCached('active_mission', session.userId));
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const initialNavigation = navigationFromHash();
  const [showMission, setShowMission] = useState(false);
  const [showNewMission, setShowNewMission] = useState(() => initialNavigation.newMission);
  const [quickView, setQuickView] = useState<{ title: string; items: any[] } | null>(null);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [screen, setScreen] = useState<0 | 1>(() => initialNavigation.screen);
  const [conversationId, setConversationId] = useState<string | null>(cachedChat?.conversationId ?? null);
  const [pendingMissionConfirmation, setPendingMissionConfirmation] = useState<{ goal: string; conversationId: string } | null>(cachedChat?.pendingMission ?? null);
  const fileRef = useRef<HTMLInputElement>(null);
  const processingStartedAtRef = useRef<number | null>(null);
  const [processingElapsedMs, setProcessingElapsedMs] = useState(0);
  const [lastProcessingMs, setLastProcessingMs] = useState<number | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [syncState, setSyncState] = useState<'cached' | 'live' | 'offline'>(
    system || caps || mission ? 'cached' : 'offline'
  );

  const syncSystemAndMission = async () => {
    let fresh = false;
    const [systemResult, overviewResult] = await Promise.all([
      api('/system', session.accessToken).catch(() => null),
      api('/meditation/overview', session.accessToken).catch(() => null)
    ]);
    if (systemResult) {
      setSystem(systemResult.aria);
      writeCached('system', session.userId, systemResult.aria);
      fresh = true;
    }
    if (overviewResult) {
      const active = overviewResult?.active_mission;
      setMission(active ?? null);
      writeCached('active_mission', session.userId, active ?? null);
      if (active?.mission_id) {
        const ev = await api('/missions/' + encodeURIComponent(active.mission_id) + '/events', session.accessToken).catch(() => ({ events: [] }));
        setEvents(ev.events ?? []);
      } else {
        setEvents([]);
      }
      fresh = true;
    }
    setSyncState(fresh ? 'live' : (system || caps || mission ? 'cached' : 'offline'));
  };

  const syncCapabilities = async () => {
    const capabilityResult = await api('/capabilities', session.accessToken).catch(() => null);
    if (capabilityResult?.capabilities) {
      setCaps(capabilityResult.capabilities);
      writeCached('capabilities', session.userId, capabilityResult.capabilities);
      setSyncState('live');
    }
  };

  useEffect(() => {
    const syncNavigation = () => {
      const nav = navigationFromHash();
      if (nav.page !== 'aria') return;
      setScreen(nav.screen);
      setShowNewMission(nav.newMission);
    };
    window.addEventListener('hashchange', syncNavigation);
    return () => window.removeEventListener('hashchange', syncNavigation);
  }, []);

  useEffect(() => {
    writeChatHistory(session.userId, conversationId, messages, pendingMissionConfirmation);
  }, [session.userId, conversationId, messages, pendingMissionConfirmation]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api('/conversation', session.accessToken);
        const restored = Array.isArray(d?.conversation?.messages)
          ? d.conversation.messages
              .map((m: any) => ({
                id: String(m.message_id ?? crypto.randomUUID()),
                role: m.role === 'assistant' ? 'aria' : 'user',
                text: String(m.content ?? '')
              }))
              .filter((m: any) => m.text.trim())
          : [];
        if (cancelled) return;
        const serverConversationId = typeof d?.conversation_id === 'string' ? d.conversation_id : null;
        const localHistory = readChatHistory(session.userId);
        if (restored.length || !localHistory?.messages?.length) {
          setConversationId(serverConversationId ?? localHistory?.conversationId ?? null);
          setMessages(restored);
          if (restored.length) setPendingMissionConfirmation(null);
        } else {
          setConversationId(localHistory?.conversationId ?? serverConversationId);
          setMessages(localHistory.messages);
          if (localHistory.pendingMission) setPendingMissionConfirmation(localHistory.pendingMission);
        }
      } catch {
        // Chat remains usable even when history restoration is temporarily unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, [session.accessToken, session.userId]);

  useLiveSync(syncSystemAndMission, session.accessToken, 8000);
  useLiveSync(syncCapabilities, session.accessToken, 60000);

  useEffect(() => {
    if (!sending) {
      setProcessingElapsedMs(0);
      return;
    }
    const startedAt = processingStartedAtRef.current ?? Date.now();
    processingStartedAtRef.current = startedAt;
    const tick = () => setProcessingElapsedMs(Date.now() - startedAt);
    tick();
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [sending]);

  useEffect(() => {
    const onBefore = (e: Event) => e.preventDefault();
    window.addEventListener('beforeinstallprompt', onBefore);
    return () => window.removeEventListener('beforeinstallprompt', onBefore);
  }, []);

  async function send() {
    const clean = text.trim();
    if ((!clean && !file) || sending) return;
    setSending(true); setError('');
    processingStartedAtRef.current = Date.now();
    setProcessingElapsedMs(0);
    setLastProcessingMs(null);
    setMessages(m => [...m, { id: crypto.randomUUID(), role: 'user', text: clean + (file ? '\\n[' + file.name + ']' : '') }]);
    setText('');
    try {
      const parts: any[] = [];
      if (clean) parts.push({ type: 'text', text: clean });
      if (file) {
        const up = await api('/media/upload-url', session.accessToken, { method: 'POST', body: JSON.stringify({ fileName: file.name, contentType: file.type || 'application/octet-stream' }) });
        const signed = up.signedUrl ?? up.upload?.signed_url;
        const path = up.path ?? up.upload?.path;
        const put = await fetch(signed, { method: 'PUT', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file });
        if (!put.ok) throw new Error('No se pudo subir el archivo.');
        parts.push({ type: 'file', fileId: path, path, mimeType: file.type || 'application/octet-stream', filename: file.name });
      }
      setFile(null);
      const activeConversationId = conversationId ?? crypto.randomUUID();
      setConversationId(activeConversationId);
      const d = await api('/conversation', session.accessToken, { method: 'POST', body: JSON.stringify({ parts, clientMessageId: crypto.randomUUID(), conversationId: activeConversationId }) });
      const p = d.parts?.find((x: any) => x.type === 'text');
      const serverProcessingMs = Number(d?.cognitive?.processing_ms);
      if (Number.isFinite(serverProcessingMs) && serverProcessingMs >= 0) setLastProcessingMs(serverProcessingMs);
      else if (processingStartedAtRef.current) setLastProcessingMs(Date.now() - processingStartedAtRef.current);
      if (p?.text) setMessages(m => [...m, { id: crypto.randomUUID(), role: 'aria', text: p.text, processingMs: Number.isFinite(serverProcessingMs) ? serverProcessingMs : undefined }]);
      if (d?.mission_confirmation_required && d?.pending_mission?.goal) {
        setPendingMissionConfirmation({
          goal: String(d.pending_mission.goal),
          conversationId: String(d.conversationId || activeConversationId)
        });
      } else {
        setPendingMissionConfirmation(null);
        if (d.mission?.mission_id) void trackMission(d.mission.mission_id);
      }
    } catch (x) {
      setError(x instanceof Error ? x.message : 'Error comunicando con ARIA.');
    } finally {
      setSending(false);
      window.setTimeout(() => chatInputRef.current?.focus(), 0);
    }
  }

  async function confirmPendingMission() {
    const pending = pendingMissionConfirmation;
    if (!pending || sending) return;
    setSending(true);
    setError('');
    const startedAt = Date.now();
    processingStartedAtRef.current = startedAt;
    setProcessingElapsedMs(0);
    setMessages(m => [...m, { id: crypto.randomUUID(), role: 'user', text: 'Sí, comenzar la misión.' }]);
    try {
      const d = await api('/conversation', session.accessToken, {
        method: 'POST',
        body: JSON.stringify({
          parts: [{ type: 'text', text: 'Sí, comenzar la misión.' }],
          clientMessageId: crypto.randomUUID(),
          conversationId: pending.conversationId || conversationId || undefined,
          mission_action: 'confirm_mission',
          mission_goal: pending.goal
        })
      });
      const p = d.parts?.find((x: any) => x.type === 'text');
      const processingMs = Date.now() - startedAt;
      if (p?.text) setMessages(m => [...m, { id: crypto.randomUUID(), role: 'aria', text: p.text, processingMs }]);
      setConversationId(typeof d?.conversationId === 'string' ? d.conversationId : pending.conversationId || conversationId);
      setPendingMissionConfirmation(null);
      if (d?.mission?.mission_id) void trackMission(String(d.mission.mission_id));
    } catch (x) {
      setError(x instanceof Error ? x.message : 'No se pudo confirmar la misión.');
    } finally {
      setSending(false);
      window.setTimeout(() => chatInputRef.current?.focus(), 0);
    }
  }

  function dismissPendingMission() {
    setPendingMissionConfirmation(null);
    setMessages(m => [...m, { id: crypto.randomUUID(), role: 'aria', text: 'Entendido. No iniciaré una misión. Seguimos conversando normalmente.' }]);
  }

  async function trackMission(id: string) {
    let delayMs = 1500;
    for (let i = 0; i < 600; i++) {
      try {
        const [md, ev] = await Promise.all([
          api('/missions/' + encodeURIComponent(id), session.accessToken),
          api('/missions/' + encodeURIComponent(id) + '/events', session.accessToken).catch(() => ({ events: [] }))
        ]);
        if (md?.mission) {
          setMission(md.mission);
          setEvents(ev.events ?? []);
          if (['succeeded', 'failed', 'blocked', 'waiting', 'cancelled'].includes(String(md.mission.status))) {
            setShowMission(true);
            return;
          }
        }
      } catch {
        // Background mission tracking must never block the conversational channel.
      }
      await new Promise(r => setTimeout(r, delayMs));
      delayMs = Math.min(5000, Math.round(delayMs * 1.35));
    }
  }

  async function runMission() {
    const clean = goal.trim();
    if (!clean || sending) return;
    setSending(true); setError('');
    try {
      const d = await api('/missions', session.accessToken, { method: 'POST', body: JSON.stringify({ goal: clean }) });
      const missionId = d?.mission?.mission_id;
      if (!missionId) throw new Error('ARIA no confirmó la creación de la misión.');
      setGoal(''); setShowNewMission(false);
      if (window.location.hash === '#mission') window.location.hash = '#home';
      void trackMission(missionId);
    } catch (x) {
      setError(x instanceof Error ? x.message : 'No se pudo iniciar la misión.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className='appShell pwaShell'>
      <header className='topBar'>
        <div className='brandLine'>
          <div className='brandOrb'>A</div>
          <div>
            <div className='eyebrow'>ARIA · COGNITIVE CORE</div>
            <h1>{screen === 0 ? 'Dashboard' : 'Chat'}</h1>
            <div className='sub'>
              {syncState === 'live'
                ? 'Núcleo conectado'
                : syncState === 'cached'
                  ? 'Núcleo listo'
                  : 'Conectando con el núcleo…'}
            </div>
          </div>
        </div>
        <div className='topActions'>
          <InstallButton />
          <button className='ghost desktopOnly' onClick={onMeditation}>Meditación IA</button>
          <button className='primary desktopOnly' onClick={() => setShowNewMission(true)}>Nueva misión</button>
        </div>
      </header>

      <div className='screenViewport'>
        <div className={'screenTrack screen-' + screen}>
          <section className='appScreen dashboardScreen'>
            <section className='heroPanel'>
              <div className='heroLeft'>
                <div className='heroOrb'>ARIA</div>
                <div>
                  <div className='eyebrow'>ESTADO REAL</div>
                  <h2>{mission ? statusLabel(String(mission.status)) : 'Lista para actuar'}</h2>
                  <p>{mission ? mission.goal : 'Dashboard principal: estado real, capacidades, misiones y acceso rápido al núcleo.'}</p>
                </div>
              </div>
              <div className='statsGrid'>
                <button className='statCard statButton' onClick={() => setQuickView({ title: 'Modelos disponibles', items: (caps?.models ?? []).filter((m:any) => m.enabled && m.status === 'available') })}>
                  <div className='statValue violet'>{caps?.summary.models_available ?? '—'}</div>
                  <div className='statLabel'>Modelos disponibles</div>
                </button>
                <button className='statCard statButton' onClick={() => setQuickView({ title: 'Agentes disponibles', items: (caps?.agents ?? []).filter((a:any) => a.status === 'available') })}>
                  <div className='statValue cyan'>{caps?.summary.agents_available ?? '—'}</div>
                  <div className='statLabel'>Agentes disponibles</div>
                </button>
                <button className='statCard statButton' onClick={() => setQuickView({ title: 'Dispositivos online', items: (caps?.devices ?? []).filter((d:any) => d.status === 'online') })}>
                  <div className='statValue green'>{caps?.summary.devices_online ?? '—'}</div>
                  <div className='statLabel'>Dispositivos online</div>
                </button>
                <button className='statCard statButton' onClick={() => setQuickView({ title: 'Conexiones', items: caps?.connections ?? [] })}>
                  <div className='statValue gold'>{caps?.summary.connections ?? '—'}</div>
                  <div className='statLabel'>Conexiones</div>
                </button>
              </div>
            </section>

            {mission && (
              <section className='panel livePanel'>
                <div className='panelHeading'>
                  <div>
                    <div className='panelTitle'>EJECUCIÓN ACTUAL</div>
                    <h2>{mission.goal}</h2>
                  </div>
                  <button className={'pill ' + tone(String(mission.status))} onClick={() => setShowMission(true)}>
                    {statusLabel(String(mission.status))}
                  </button>
                </div>
                <div className='muted'>{mission.phase?.index ?? 1}/6 · {mission.phase?.label ?? statusLabel(String(mission.status))}</div>
                <div className='progressBar'>
                  <span style={{ width: (Math.max(0, Math.min(100, Number(mission.completed_steps ?? 0) / Math.max(1, Number(mission.total_steps ?? 1)) * 100)) + '%') }} />
                </div>
                <div className='muted'>Paso {mission.completed_steps ?? 0} de {mission.total_steps ?? mission.steps?.length ?? '—'} · {mission.next_action ?? 'sin siguiente acción'}</div>
                <div className='detailTimeline'>
                  <div className='panelTitle'>TRABAJO EN VIVO</div>
                  {events.slice(-6).map((e: any, i: number) => <div className='timelineRow' key={e.event_id ?? String(e.created_at) + '-' + i}><span className='timelineDot' /><div><strong>{String(e.event_type ?? 'evento').replaceAll('_', ' ')}</strong><small>{formatDate(e.created_at)}</small></div></div>)}
                  {!events.length && <div className='muted'>ARIA aún está iniciando la misión…</div>}
                </div>
              </section>
            )}

          </section>

          <section className='appScreen chatScreen'>
            <section className='panel chatPanel'>
              <div className='panelHeading'>
                <div>
                  <div className='panelTitle'>SEGUNDA PANTALLA</div>
                  <h2>CONVERSACIÓN DIRECTA</h2>
                </div>

              </div>
              <div className='chatWindow'>
                {messages.length
                  ? messages.map(m => <div key={m.id} className={'bubble ' + m.role}><div className='markdownBody'>{renderMarkdown(m.text)}</div>{m.role === 'aria' && m.processingMs != null && <small className='messageMeta'>Procesado en {formatProcessingTime(m.processingMs)}</small>}</div>)
                  : <div className='emptyState'>Habla con ARIA. Ella decide si conversa, recuerda, planifica o ejecuta una misión.</div>}
              </div>
              {pendingMissionConfirmation && (
                <div className='missionConfirmation' role='dialog' aria-label='Confirmar inicio de misión'>
                  <div>
                    <div className='panelTitle'>CONFIRMAR MISIÓN</div>
                    <strong>¿Quieres que comience una misión para esto?</strong>
                    <p>{pendingMissionConfirmation.goal}</p>
                    <small>La misión entrará en la cola de Meditación IA. Si solo querías preguntar o conversar, puedes cancelar.</small>
                  </div>
                  <div className='missionConfirmationActions'>
                    <button className='ghost' disabled={sending} onClick={dismissPendingMission}>No, solo conversar</button>
                    <button className='primary' disabled={sending} onClick={() => void confirmPendingMission()}>{sending ? 'Confirmando…' : 'Sí, comenzar misión'}</button>
                  </div>
                </div>
              )}
              {sending && (
                <div className='chatThinking' role='status' aria-live='polite'>
                  <span className='thinkingOrb' aria-hidden='true'>🧠</span>
                  <div className='thinkingCopy'>
                    <strong>{processingLabel(processingElapsedMs)}</strong>
                    <small>Procesamiento en curso · {formatProcessingTime(processingElapsedMs)}</small>
                  </div>
                  <span className='thinkingDots' aria-hidden='true'>•••</span>
                </div>
              )}
              {file && <div className='fileChip'>{file.name}<button aria-label='Quitar archivo adjunto' onClick={() => setFile(null)}>×</button></div>}
              {error && <div className='errorBox'>{error}</div>}
              <div className='composer'>
                <input type='file' ref={fileRef} hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
                <button className='tool attachmentButton' aria-label='Adjuntar archivo' onClick={() => fileRef.current?.click()}>📎<span className='attachmentLabel'>Adjuntar</span></button>
                <textarea
                  ref={chatInputRef}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder='Habla con ARIA…'
                />
                <button className='send' aria-label={sending ? 'Enviando mensaje' : 'Enviar mensaje'} disabled={sending || (!text.trim() && !file)} onClick={send}>{sending ? '…' : '↑'}</button>
                <div className='composerStatus' aria-live='polite'>{sending ? ('Procesando… ' + formatProcessingTime(processingElapsedMs)) : error ? 'Error · revisa el mensaje' : lastProcessingMs != null ? ('Último procesamiento · ' + formatProcessingTime(lastProcessingMs)) : 'Listo para enviar'}</div>
              </div>
            </section>
          </section>
        </div>
      </div>

      {quickView && <QuickCatalogModal title={quickView.title} items={quickView.items} onClose={() => setQuickView(null)} />}
      {showMission && mission && <MissionDetail mission={mission} events={events} onClose={() => setShowMission(false)} />}

      {showNewMission && (
        <div className='modalBackdrop' onClick={() => setShowNewMission(false)}>
          <section className='detailModal compactModal' onClick={e => e.stopPropagation()}>
            <div className='eyebrow'>NUEVA MISIÓN</div>
            <h2>¿Qué debe hacer ARIA?</h2>
            <p className='muted'>La solicitud seguirá el runtime canónico y sus controles de governance.</p>
            <textarea value={goal} onChange={e => setGoal(e.target.value)} placeholder='Ejemplo: revisa el estado de X y dime qué está mal.' />
            <div className='modalActions'>
              <button className='ghost' onClick={() => setShowNewMission(false)}>Cancelar</button>
              <button className='primary' disabled={!goal.trim() || sending} onClick={runMission}>{sending ? 'Enviando…' : 'Crear misión'}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function meditationQueueItems(overview: any, activeMission: any): any[] {
  const all = Array.isArray(overview?.missions) ? overview.missions : [];
  const active = activeMission && ['running','waiting','planning'].includes(String(activeMission.status))
    ? activeMission
    : null;
  const queued = all
    .filter((m: any) => String(m?.status) === 'queued')
    .sort((a: any, b: any) =>
      Number(b?.queue_priority ?? b?.metadata?.queue_priority ?? 0) - Number(a?.queue_priority ?? a?.metadata?.queue_priority ?? 0) ||
      new Date(String(a?.created_at || 0)).getTime() - new Date(String(b?.created_at || 0)).getTime()
    );
  const result = active ? [active] : [];
  for (const item of queued) {
    if (!result.some((x: any) => String(x.mission_id) === String(item.mission_id))) result.push(item);
  }
  return result;
}

function queueLabel(item: any, index: number): string {
  if (index === 0 && ['running','waiting','planning'].includes(String(item?.status))) return '1 · EJECUTÁNDOSE';
  return (index + 1) + ' · PRIORIDAD';
}

function Meditation({ session }: { session: Session }) {
  const [o, setO] = useState<any>(() => readCached('meditation_overview', session.userId));
  const [caps, setCaps] = useState<CapabilityCatalog | null>(() => readCached('capabilities', session.userId));
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [missionDetail, setMissionDetail] = useState<any>(null);
  const [missionEvents, setMissionEvents] = useState<MissionEvent[]>([]);

  async function load() {
    setSyncing(true);
    let successes = 0;
    const [overview, capability] = await Promise.all([
      api('/meditation/overview', session.accessToken).catch(() => null),
      api('/capabilities', session.accessToken).catch(() => null)
    ]);
    if (overview) {
      let nextOverview = overview;
      const liveCandidate = selectLiveMission(overview);
      const activeId = liveCandidate?.mission_id;
      if (activeId) {
        // The overview is only a queue snapshot. Select the highest-priority
        // executable mission (RUNNING before QUEUED), then refresh the
        // canonical mission + real event stream for that mission.
        const [missionResult, eventResult] = await Promise.all([
          api('/missions/' + encodeURIComponent(activeId), session.accessToken).catch(() => null),
          api('/missions/' + encodeURIComponent(activeId) + '/events?live=' + Date.now(), session.accessToken).catch(() => ({ events: [] }))
        ]);
        const liveMission = missionResult?.mission;
        const embeddedEvents = liveMission?.live_events ?? liveCandidate?.live_events ?? [];
        const liveEvents = Array.isArray(eventResult?.events) && eventResult.events.length
          ? eventResult.events
          : embeddedEvents;
        if (liveMission) nextOverview = {
          ...overview,
          active_mission: liveMission,
          live_sync_at: new Date().toISOString(),
          live_event_count: liveEvents.length
        };
        else if (liveCandidate) nextOverview = {
          ...overview,
          active_mission: liveCandidate,
          live_sync_at: new Date().toISOString(),
          live_event_count: liveEvents.length
        };
        setMissionEvents(Array.isArray(liveEvents) ? liveEvents : []);
      } else {
        setMissionEvents([]);
        // Nunca conservar un active_mission terminal/antiguo cuando ya no existe
        // una misión realmente ejecutándose.
        nextOverview = { ...nextOverview, active_mission: null, live_sync_at: new Date().toISOString(), live_event_count: 0 };
      }
      setO(nextOverview);
      writeCached('meditation_overview', session.userId, nextOverview);
      successes++;
    }
    if (capability?.capabilities) {
      setCaps(capability.capabilities);
      writeCached('capabilities', session.userId, capability.capabilities);
      successes++;
    }
    setLastSyncAt(successes ? Date.now() : null);
    setError(successes === 2 ? '' : successes === 1 ? 'Parte de Meditación IA se sincronizó; el resto sigue reintentándose.' : 'No se pudieron sincronizar los datos de Meditación IA. Revisa la conexión y pulsa Reintentar.');
    setSyncing(false);
  }

  async function openMission(missionId: string) {
    try {
      setError('');
      const [missionResult, eventsResult] = await Promise.all([
        api('/missions/' + encodeURIComponent(missionId), session.accessToken),
        api('/missions/' + encodeURIComponent(missionId) + '/events', session.accessToken).catch(() => ({ events: [] }))
      ]);
      if (!missionResult?.mission) throw new Error('No se pudo recuperar la información de la misión.');

      const freshMission = missionResult.mission;
      const freshEvents = Array.isArray(eventsResult?.events) ? eventsResult.events : [];
      setMissionDetail(freshMission);
      setMissionEvents(freshEvents);

      // El modal y el panel en vivo deben compartir inmediatamente la misma
      // misión canónica para no mostrar "Completada" dentro y "Ejecutándose" detrás.
      setO(prev => {
        if (!prev) return prev;
        const previousActiveId = String(prev?.active_mission?.mission_id ?? '');
        const isCurrentActive = previousActiveId === String(missionId);
        const missions = Array.isArray(prev?.missions)
          ? prev.missions.map((item: any) =>
              String(item?.mission_id) === String(missionId)
                ? { ...item, ...freshMission, live_events: freshEvents }
                : item
            )
          : prev.missions;
        if (!isCurrentActive) return { ...prev, missions };
        return {
          ...prev,
          missions,
          active_mission: { ...freshMission, live_events: freshEvents },
          live_sync_at: new Date().toISOString(),
          live_event_count: freshEvents.length,
        };
      });
    } catch (x) {
      setError(x instanceof Error ? x.message : 'No se pudo abrir la misión.');
    }
  }

  useLiveSync(load, session.accessToken, MEDITATION_LIVE_POLL_MS);

  async function retryMission(missionId: string) {
    const data = await api('/missions/' + encodeURIComponent(missionId) + '/retry', session.accessToken, { method: 'POST' });
    const newId = data?.mission?.mission_id;
    if (!newId) throw new Error('ARIA no confirmó el reintento de la misión.');
    await openMission(String(newId));
  }

  async function cancelMission(missionId: string) {
    const data = await api('/missions/' + encodeURIComponent(missionId) + '/cancel', session.accessToken, { method: 'POST' });
    if (!data?.mission?.mission_id || data?.cancelled !== true) throw new Error('ARIA no confirmó la cancelación de la misión.');
    setMissionDetail(null);
    setMissionEvents([]);
    await load();
  }

  async function control(action: string) {
    setBusy(true); setError('');
    try { await api('/meditation/control', session.accessToken, { method: 'POST', body: JSON.stringify({ action }) }); await load(); }
    catch (x) { setError(x instanceof Error ? x.message : 'No se pudo cambiar el estado.'); }
    finally { setBusy(false); }
  }

  const m = o?.active_mission;

  return (
    <main className='appShell'>
      
      <div className='pageBodyViewport meditationViewport'>
      <section className='statePanel'><div><div className='panelTitle'>ESTADO CLOUD</div><div className='bigStatus'>{syncing && !o ? 'Sincronizando…' : o?.mode ? statusLabel(String(o.mode)) : 'Sin datos LIVE'}</div><div className='muted'>Misión activa: {m ? m.goal : 'ninguna'}{lastSyncAt ? ' · actualizado ' + new Date(lastSyncAt).toLocaleTimeString('es') : ''}</div></div><div className='actions'><button className='primary' disabled={busy} onClick={() => control('activate')}>Activar</button><button className='ghost' disabled={busy || !m || ['paused','succeeded','failed','blocked','cancelled'].includes(String(m?.status))} onClick={() => control('pause')}>Pausar</button><button className='ghost' disabled={busy || !m || ['succeeded','failed','blocked','cancelled'].includes(String(m?.status))} onClick={() => control('stop')}>Detener</button></div></section>
      {m
        ? <MeditationLiveExecution mission={m} events={missionEvents} lastSyncAt={lastSyncAt} syncing={syncing} onOpen={() => void openMission(String(m.mission_id))} onCancel={() => cancelMission(String(m.mission_id))} />
        : <section className='panel livePanel noActiveMissionPanel'>
            <div className='panelTitle'>EJECUCIÓN EN TIEMPO REAL</div>
            <div className='emptyState'>
              <strong>Ninguna misión se está ejecutando</strong>
              <span>ARIA está disponible y la ejecución en tiempo real aparecerá aquí cuando una misión pase a ejecución.</span>
            </div>
          </section>}
      {error && <div className='errorBox'><div>{error}</div>{error.includes('sincronizar') && <button className='ghost' disabled={syncing} onClick={() => void load()}>{syncing ? 'Sincronizando…' : 'Reintentar ahora'}</button>}</div>}
      <section className='statsGrid'><StatCard value={o ? (o?.counts?.missions ?? 0) : '—'} label='Misiones visibles' /><StatCard value={o ? (o?.counts?.human_gates ?? 0) : '—'} label='Human Gates' /><StatCard value={o ? (o?.counts?.blocked ?? 0) : '—'} label='Bloqueadas' /><StatCard value={caps ? (caps?.summary.executors ?? 0) : '—'} label='Executors' /></section>
      <details className='panel collapsiblePanel'>
        <summary><span>HUMAN GATES</span><b>{(o?.human_gates ?? []).length}</b></summary>
        {(o?.human_gates ?? []).slice(0, 8).map((g: any) => <div className='row live' key={g.id}><span className='dot warning' /><div><strong>{g.risk}</strong><small>{g.mission_goal}</small></div></div>)}
        {!(o?.human_gates?.length) && <div className='muted'>No hay Human Gates pendientes.</div>}
      </details>

      <details className='panel collapsiblePanel'>
        <summary><span>ESPERANDO VERIFICACIÓN</span><b>{(o?.verification_pending ?? []).length}</b></summary>
        {(o?.verification_pending ?? []).slice(0, 8).map((b: any) => <button className='row live' key={b.mission_id} onClick={() => void openMission(b.mission_id)}><span className='dot warning' /><div><strong>{b.goal}</strong><small>{b.reason} · Abrir diagnóstico</small></div><span className='rowArrow'>›</span></button>)}
        {!(o?.verification_pending?.length) && <div className='muted'>No hay verificaciones externas pendientes.</div>}
      </details>

      <details className='panel collapsiblePanel'>
        <summary><span>BLOQUEADAS</span><b>{(o?.blocked ?? []).length}</b></summary>
        {(o?.blocked ?? []).slice(0, 8).map((b: any) => <button className='row bad' key={b.mission_id} onClick={() => void openMission(b.mission_id)}><span className='dot bad' /><div><strong>{b.reason_type}</strong><small>{b.reason} · Abrir diagnóstico</small></div><span className='rowArrow'>›</span></button>)}
        {!(o?.blocked?.length) && <div className='muted'>No hay misiones bloqueadas visibles.</div>}
      </details>

      {(() => {
        const queue = meditationQueueItems(o, m);
        const reorderable = queue.filter((item: any, index: number) => index > 0 || !['running','waiting','planning'].includes(String(item?.status)));
        const moveQueue = async (missionId: string, direction: -1 | 1) => {
          const queued = queue.filter((item: any) => String(item?.status) === 'queued').map((item: any) => String(item.mission_id));
          const index = queued.indexOf(String(missionId));
          if (index < 0) return;
          const nextIndex = Math.max(0, Math.min(queued.length - 1, index + direction));
          if (nextIndex === index) return;
          const next = queued.slice();
          const [item] = next.splice(index, 1);
          next.splice(nextIndex, 0, item);
          setError('');
          try {
            await api('/meditation/queue/reorder', session.accessToken, {
              method: 'POST',
              body: JSON.stringify({ ordered_mission_ids: next })
            });
            await load();
          } catch (x) {
            setError(x instanceof Error ? x.message : 'No se pudo reorganizar la cola.');
          }
        };
        return <details className='panel collapsiblePanel' open={false}>
          <summary><span>EN COLA</span><b>{queue.length}</b></summary>
          {queue.length ? queue.slice(0, 20).map((r: any, index: number) => (
            <div className={'queueMissionRow ' + tone(String(r.status))} key={r.mission_id}>
              <button className='queueMissionMain' onClick={() => void openMission(r.mission_id)} aria-label={'Abrir ' + queueLabel(r,index)}>
                <span className={'dot ' + tone(String(r.status))} />
                <div>
                  <strong>{queueLabel(r, index)}</strong>
                  <small>{missionHumanTitle(r)} · {statusLabel(String(r.status))} · {missionActivityLabel(r)} · {formatDate(r.updated_at)}</small>
                  <small>{missionGoalPreview(r, 110)}</small>
                </div>
              </button>
              {String(r.status) === 'queued' && (
                <div className='queueMissionControls' aria-label='Reordenar prioridad'>
                  <button className='queueMoveButton' disabled={index <= 1 || queue.filter((x: any) => String(x.status) === 'queued').length < 2} title='Subir prioridad' aria-label='Subir prioridad' onClick={() => void moveQueue(String(r.mission_id), -1)}>↑</button>
                  <button className='queueMoveButton' disabled={index >= queue.length - 1} title='Bajar prioridad' aria-label='Bajar prioridad' onClick={() => void moveQueue(String(r.mission_id), 1)}>↓</button>
                </div>
              )}
            </div>
          )) : <div className='muted'>No hay misiones en cola.</div>}
          {queue.length > 1 && <div className='muted queueHint'>La misión ejecutándose permanece en prioridad 1. Las demás prioridades se ejecutarán en el orden mostrado.</div>}
        </details>;
      })()}

      <details className='panel collapsiblePanel'>
        <summary><span>HISTORIAL</span><b>{(o?.missions ?? []).filter((r: any) => !['queued','planning','running','waiting'].includes(String(r.status))).length}</b></summary>
        {(o?.missions ?? []).filter((r: any) => !['queued','planning','running','waiting'].includes(String(r.status))).slice(0, 12).map((r: any, index: number) => <button className={'row ' + tone(String(r.status))} key={r.mission_id} onClick={() => void openMission(r.mission_id)}><span className={'dot ' + tone(String(r.status))} /><div><strong>{missionListLabel(r, index)}</strong><small>{missionHumanTitle(r)} · {statusLabel(String(r.status))} · {missionActivityLabel(r)} · {formatDate(r.updated_at)}</small><small>{missionGoalPreview(r, 90)}</small></div><span className='rowArrow'>›</span></button>)}
      </details>
      {missionDetail && <MissionDetail mission={missionDetail} events={missionEvents} onRetry={() => retryMission(String(missionDetail.mission_id))} onCancel={() => cancelMission(String(missionDetail.mission_id))} onClose={() => { setMissionDetail(null); setMissionEvents([]); }} />}
      </div>
    </main>
  );
}

function executionEventTitle(event: any): string {
  const type = String(event?.event_type ?? 'evento').toLowerCase();
  const map: Record<string, string> = {
    step_started: 'ARIA comenzó este paso',
    step_succeeded: 'Paso completado y verificado',
    step_failed: 'El paso encontró un fallo',
    checkpoint_saved: 'ARIA guardó evidencia de ejecución',
    mission_replanned: 'ARIA replanteó la estrategia',
    mission_verified: 'ARIA verificó el resultado',
    mission_completed: 'Misión completada',
    mission_started: 'Misión iniciada',
    human_gate_requested: 'ARIA necesita una decisión humana',
    executor_error: 'El executor no pudo completar el paso',
    step_batch_started: 'ARIA inició el lote de ejecución',
    cognitive_recall_completed: 'ARIA recuperó contexto antes de continuar'
  };
  if (map[type]) return map[type];
  return type.replaceAll('_', ' ').replace(/^./, x => x.toUpperCase());
}

function executionEventDetail(event: any): string {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const type = String(event?.event_type ?? '').toLowerCase();
  if (type === 'cognitive_recall_completed') {
    const count = Number(payload?.recall_count ?? 0);
    return count > 0
      ? 'ARIA recuperó ' + count + ' recuerdos autorizados antes de continuar con la estrategia.'
      : 'ARIA completó la recuperación de contexto antes de continuar.';
  }
  if (type === 'step_failed') {
    const step = String(payload?.step_id ?? '').trim();
    const attempt = Number(payload?.attempt ?? 0);
    const reason = String(payload?.reason ?? 'fallo del executor').trim();
    return 'El paso ' + (step || 'actual') + ' falló' + (attempt ? ' en el intento ' + attempt : '') + '. Motivo: ' + reason + '.';
  }
  const message = String(payload?.message ?? payload?.detail ?? payload?.error?.message ?? '').trim();
  if (message) return message.length > 180 ? message.slice(0, 179).trimEnd() + '…' : message;
  const parts = [
    payload?.operation ? 'Operación: ' + String(payload.operation) : '',
    payload?.executor_type ? 'Ejecutor: ' + String(payload.executor_type) : '',
    payload?.model_id ? 'Modelo: ' + String(payload.model_id) : '',
    payload?.step_id ? 'Paso: ' + String(payload.step_id) : '',
    payload?.attempt != null ? 'Intento: ' + String(payload.attempt) : ''
  ].filter(Boolean);
  return parts.join(' · ') || 'El runtime registró actividad real para esta misión.';
}

function executionResource(event: any, step: any): string {
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const target = step?.target ?? payload?.target ?? {};
  const candidate = [
    target?.path,
    target?.file_path,
    target?.repository_path,
    target?.repo_path,
    payload?.path,
    payload?.file_path,
    payload?.repository_path,
    payload?.resource,
    payload?.url
  ].find((value: any) => typeof value === 'string' && value.trim());
  return candidate ? String(candidate).trim() : '';
}

function executionNarrative(mission: any, step: any, latest: any): { headline: string; subject: string; evidence: string; next: string } {
  const status = String(mission?.status ?? '').toLowerCase();
  const payload = latest?.payload && typeof latest.payload === 'object' ? latest.payload : {};
  const op = String(step?.operation ?? payload?.operation ?? '').trim();
  const executor = String(step?.executor_type ?? payload?.executor_type ?? '').trim();
  const eventType = String(latest?.event_type ?? '').toLowerCase();
  const latestStepId = String(latest?.payload?.step_id ?? latest?.step_id ?? '').trim();
  const resource = executionResource(latest, step);
  const opHuman = humanOperation(op, executor);

  const latestStepIndex = latest?.step_index != null ? Number(latest.step_index) : null;
  const currentStepIndex = step?.index != null ? Number(step.index) : null;
  const totalSteps = Number(mission?.total_steps ?? mission?.step_count ?? (Array.isArray(mission?.steps) ? mission.steps.length : 0)) || null;
  const attemptNumber = Number(step?.attempt ?? payload?.attempt ?? 0) || null;
  const processLabel = currentStepIndex != null
    ? (totalSteps ? 'paso ' + currentStepIndex + ' de ' + totalSteps : 'paso ' + currentStepIndex)
    : 'paso actual';

  const latestBelongsToCurrentStep =
    latest &&
    (
      (latestStepId && step?.id != null && latestStepId === String(step.id)) ||
      (latest?.step_id != null && step?.id != null && String(latest.step_id) === String(step.id)) ||
      (latestStepIndex != null && currentStepIndex != null && latestStepIndex === currentStepIndex)
    );

  if (eventType === 'step_succeeded' && latestBelongsToCurrentStep) {
    return {
      headline: 'ARIA acaba de completar este paso',
      subject: resource ? opHuman + ' · ' + resource : opHuman,
      evidence: 'El runtime registró el éxito y la misión conserva la evidencia verificada del paso.',
      next: humanNextAction(mission?.next_action, status)
    };
  }

  if (eventType === 'step_failed' || status === 'failed') {
    return {
      headline: 'ARIA encontró un fallo y ya está siguiendo la recuperación gobernada',
      subject: resource ? opHuman + ' · ' + resource : opHuman,
      evidence: executionEventDetail(latest),
      next: humanNextAction(mission?.next_action, status)
    };
  }

  if (eventType === 'mission_replanned') {
    return {
      headline: 'ARIA detectó que la estrategia anterior no bastaba y la cambió',
      subject: executionEventDetail(latest),
      evidence: 'La misión conserva la evidencia que provocó el replanteamiento para evitar repetir el mismo camino sin cambios.',
      next: humanNextAction(mission?.next_action, status)
    };
  }

  if (eventType === 'checkpoint_saved') {
    return {
      headline: 'ARIA guardó un punto real de avance',
      subject: executionEventDetail(latest),
      evidence: 'El estado quedó persistido y puede usarse como base para continuar sin perder lo ya comprobado.',
      next: humanNextAction(mission?.next_action, status)
    };
  }

  if (status === 'queued') {
    return {
      headline: 'ARIA tiene esta misión preparada para ejecución',
      subject: 'El runner todavía no la ha tomado; no se inventará actividad.',
      evidence: 'Todavía no existe una ejecución activa ni eventos de runtime para este intento.',
      next: humanNextAction(mission?.next_action, status)
    };
  }

  if (status === 'planning') {
    return {
      headline: 'ARIA está preparando cómo resolver la misión',
      subject: 'Está separando el objetivo en pasos gobernados.',
      evidence: latest ? executionEventDetail(latest) : 'El plan aparecerá cuando quede persistido.',
      next: humanNextAction(mission?.next_action, status)
    };
  }

  if (status === 'waiting') {
    return {
      headline: 'ARIA llegó a una espera verificable antes de continuar',
      subject: executionEventDetail(latest),
      evidence: 'La misión permanece persistida y no se marcará como terminada hasta comprobar la condición pendiente.',
      next: humanNextAction(mission?.next_action, status)
    };
  }

  const attemptText = attemptNumber ? 'Intento ' + attemptNumber : '';
  const subjectParts = [opHuman, resource ? String(resource) : '', attemptText].filter(Boolean);

  return {
    headline: status === 'succeeded'
      ? 'ARIA terminó esta misión'
      : status === 'running'
        ? 'ARIA está ejecutando el ' + processLabel
        : 'ARIA está trabajando en esta misión',
    subject: subjectParts.join(' · '),
    evidence: latest
      ? executionEventDetail(latest)
      : status === 'running'
        ? 'El runtime mantiene este paso activo; ARIA espera la siguiente evidencia real antes de avanzar.'
        : 'No hay un evento reciente que permita describir una actividad nueva.',
    next: humanNextAction(mission?.next_action, status)
  };
}
function elapsedFrom(timestamp: any): string {
  const value = new Date(String(timestamp || '')).getTime();
  if (!Number.isFinite(value)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return seconds + ' s';
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return minutes + ' min ' + rem + ' s';
}

function MeditationLiveExecution({ mission, events, lastSyncAt, syncing, onOpen, onCancel }: {
  mission: any;
  events: MissionEvent[];
  lastSyncAt: number | null;
  syncing: boolean;
  onOpen: () => void;
  onCancel?: () => Promise<void>;
}) {
  if (!mission) {
    return (
      <section className='executionHero executionHeroEmpty'>
        <div className='executionHeroTop'>
          <div>
            <div className='panelTitle'>EJECUCIÓN EN TIEMPO REAL</div>
            <div className='executionHeroTitle'>La cola está lista</div>
            <div className='muted'>Cuando ARIA tome una misión, aquí verás el paso exacto, qué está haciendo y la evidencia más reciente.</div>
          </div>
          <span className='pill neutral'>SIN MISIÓN ACTIVA</span>
        </div>
        <div className='executionEmptyHint'>No uses “esperar” como señal de progreso: esta vista solo mostrará actividad cuando exista actividad real del runtime.</div>
      </section>
    );
  }

  const status = String(mission.status ?? 'unknown');
  const terminal = ['succeeded', 'failed', 'blocked', 'cancelled'].includes(status);
  const latest = events.length ? events[events.length - 1] : null;
  const latestEventTime = latest ? new Date(String(latest.created_at || '')).getTime() : NaN;
  const latestEventAgeMs = Number.isFinite(latestEventTime) ? Math.max(0, Date.now() - latestEventTime) : Number.POSITIVE_INFINITY;
  const latestEventFresh = latestEventAgeMs <= 7000;
  const latestType = String(latest?.event_type ?? '').toLowerCase();
  const liveEventStepId = String(latest?.payload?.step_id ?? '').trim();
  const activeEventTypes = new Set(['step_started', 'step_batch_started', 'cognitive_recall_completed']);
  const currentStep =
    (mission.steps ?? []).find((s: any) => String(s.status) === 'running') ??
    (activeEventTypes.has(latestType) && liveEventStepId
      ? (mission.steps ?? []).find((s: any) => String(s.id) === liveEventStepId)
      : null) ??
    (mission.steps ?? []).find((s: any) => Number(s.index) === Number(mission.current_step) + 1) ??
    (mission.steps ?? []).find((s: any) => !['succeeded', 'skipped'].includes(String(s.status))) ??
    null;
  const progress = Number(mission.progress_percent ?? 0);
  const completed = Number(mission.completed_steps ?? 0);
  const total = Number(mission.total_steps ?? mission.step_count ?? 0);
  const narrativeEvent = latestEventFresh ? latest : null;
  const nowText = status === 'queued'
    ? 'Esperando que el runner tome la misión'
    : currentStep
      ? String(currentStep.title)
      : latestEventFresh
        ? 'Procesando el siguiente movimiento'
        : 'Sin evento nuevo: estado persistido';
  const doingText = status === 'queued'
    ? 'El runner todavía no ha tomado esta misión.'
    : currentStep
      ? humanOperation(currentStep.operation, currentStep.executor_type)
      : latestEventFresh
        ? executionEventDetail(latest)
        : 'No se inferirá actividad actual sin un evento reciente.';
  const nextText = humanNextAction(mission.next_action, status);

  return (
    <section className={'executionHero ' + (terminal ? 'executionHeroTerminal ' + tone(status) : 'executionHeroRunning')}>
      <div className='executionHeroTop'>
        <div className='executionIdentity'>
          <span className='executionPulse' aria-hidden='true' />
          <div>
            <div className='panelTitle'>EJECUCIÓN EN TIEMPO REAL</div>
            <div className='executionHeroTitle'>{statusLabel(status)}</div>
            <div className='executionGoal'>{mission.goal}</div>
          </div>
        </div>
        <div className='executionHeroActions'>
          <span className={'pill ' + tone(status)}>{syncing ? 'SINCRONIZANDO…' : status === 'queued' ? 'EN COLA' : terminal ? statusLabel(status) : latestEventFresh ? 'ACTIVIDAD REAL' : 'ESTADO PERSISTIDO'}</span>
          <button className='ghost executionDetailsButton' onClick={onOpen}>Ver misión</button>
          {!terminal && onCancel && <button className='ghost executionDetailsButton dangerAction' onClick={async () => { if (!window.confirm('¿Cancelar esta misión? ARIA dejará de continuarla y registrará la cancelación.')) return; try { await onCancel(); } catch {} }}>Cancelar misión</button>}
        </div>
      </div>

      <div className='executionProgressRow'>
        <div className='executionProgressMeta'><strong>{progress.toFixed(1)}%</strong><span>{completed}/{total || '—'} pasos</span></div>
        <div className='progressBar executionProgressBar'><span style={{ width: progress + '%' }} /></div>
      </div>

      <div className='executionTelemetryGrid' aria-label='Telemetría de ejecución'>
        <div className='executionTelemetryCard'>
          <span>PASO EN CURSO</span>
          <strong>{currentStep ? ((Number(currentStep.index) || 1) + ' · ' + String(currentStep.title)) : 'Preparando…'}</strong>
          <small>{status === 'queued' ? 'El runner aún no la ha tomado.' : currentStep ? statusLabel(String(currentStep.status)) : 'Sin paso activo persistido'}</small>
        </div>
        <div className='executionTelemetryCard'>
          <span>INTENTO ACTUAL</span>
          <strong>{Number(currentStep?.attempt ?? currentStep?.attempt_count ?? mission.attempt_count ?? 0) || 1}</strong>
          <small>{currentStep?.executor_type ? 'Executor: ' + String(currentStep.executor_type) : 'Executor aún no identificado'}</small>
        </div>
        <div className='executionTelemetryCard'>
          <span>OPERACIÓN</span>
          <strong>{currentStep?.operation || '—'}</strong>
          <small>{currentStep?.model_id ? 'Modelo: ' + String(currentStep.model_id) : (currentStep?.executor_type ? 'Ejecutor activo' : 'Sin detalle de modelo')}</small>
        </div>
        <div className='executionTelemetryCard'>
          <span>ÚLTIMA ACTIVIDAD</span>
          <strong>{latest ? elapsedFrom(latest.created_at) : '—'}</strong>
          <small>{latest ? (latestEventFresh ? executionEventTitle(latest) : 'Último evento: ' + executionEventTitle(latest)) : 'Sin evento persistido todavía'}</small>
        </div>
      </div>

      <div className='executionNarrative'>
        <div className='executionLabel'>QUÉ ESTÁ PASANDO</div>
        <strong>{executionNarrative(mission, currentStep, narrativeEvent).headline}</strong>
        <div className='executionNarrativeSubject'>{executionNarrative(mission, currentStep, narrativeEvent).subject}</div>
        <div className='executionNarrativeGrid'>
          <div><span>EVIDENCIA</span><small>{executionNarrative(mission, currentStep, narrativeEvent).evidence}</small></div>
          <div><span>DESPUÉS</span><small>{executionNarrative(mission, currentStep, narrativeEvent).next}</small></div>
        </div>
      </div>

      <div className='executionNowGrid'>
        <div className='executionNowCard executionNowMain'>
          <div className='executionLabel'>AHORA MISMO</div>
          {currentStep ? <>
            <strong>{currentStep.title}</strong>
            <small>{statusLabel(String(currentStep.status))} · {currentStep.executor_type || 'ejecución'} · {currentStep.operation || 'operación'}</small>
            <small>{verificationLabel(currentStep)}</small>
          </> : <strong>ARIA está preparando el siguiente movimiento.</strong>}
        </div>
        <div className='executionNowCard'>
          <div className='executionLabel'>QUÉ ESTÁ HACIENDO</div>
          <strong>{doingText}</strong>
          <small>{latestEventFresh && latest ? 'Evento ' + executionEventTitle(latest) + ' hace ' + elapsedFrom(latest.created_at) : status === 'queued' ? 'No se mostrará falsa actividad mientras permanezca en cola.' : 'Esperando un evento nuevo del runtime.'}</small>
        </div>
        <div className='executionNowCard'>
          <div className='executionLabel'>PRÓXIMO MOVIMIENTO</div>
          <strong>{status === 'queued' ? nextText : humanNextAction(mission.next_action, status)}</strong>
          <small>{mission.eta?.eta_seconds != null ? 'ETA estimada: ' + Math.round(Number(mission.eta.eta_seconds)) + ' s' : 'ETA calculándose con el historial disponible.'}</small>
        </div>
      </div>

      <div className='executionEvidence'>
        <div className='executionEvidenceHeader'>
          <div>
            <div className='executionLabel'>ÚLTIMA ACTIVIDAD REAL</div>
            <strong>{latest ? (latestEventFresh ? executionEventTitle(latest) : 'Último evento persistido: ' + executionEventTitle(latest)) : 'Esperando el primer evento del runtime…'}</strong>
          </div>
          <span>{latest ? formatDate(latest.created_at) + ' · hace ' + elapsedFrom(latest.created_at) : lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString('es') : '—'}</span>
        </div>
        <div className='executionEvidenceDetail'>{latest ? executionEventDetail(latest) : 'La pantalla se sincronizará automáticamente y mostrará aquí el primer evento que ARIA registre.'}</div>
      </div>

      <div className='executionTimeline'>
        <div className='executionLabel'>SECUENCIA REAL RECIENTE</div>
        {(events ?? []).slice(-5).reverse().map((event: any) => (
          <div className='timelineRow' key={String(event.event_id)}>
            <span className='timelineDot' aria-hidden='true' />
            <div>
              <strong>{executionEventTitle(event)}</strong>
              <small>{formatDate(event.created_at)}</small>
              <div className='executionEvidenceDetail'>{executionEventDetail(event)}</div>
            </div>
          </div>
        ))}
        {!events.length && <div className='muted'>Todavía no hay eventos persistidos para esta misión.</div>}
      </div>

      <div className='executionStepRail'>
        {(mission.steps ?? []).slice(0, 8).map((step: any) => (
          <div className={'executionStepNode ' + String(step.status)} key={step.id}>
            <span>{step.index}</span>
            <small>{step.title}</small>
          </div>
        ))}
      </div>

      <div className='executionLiveControl'>
        {!terminal && onCancel && <button className='primary dangerAction' onClick={async () => { if (!window.confirm('¿Cancelar esta misión? ARIA dejará de continuarla y registrará la cancelación.')) return; try { await onCancel(); } catch {} }}>Cancelar ejecución</button>}
        <span className='muted'>Sincronización automática cada 2,5 s</span>
      </div>
      <div className='executionFooter'>
        <span>{lastSyncAt ? 'Estado consultado a las ' + new Date(lastSyncAt).toLocaleTimeString('es') : 'Sincronizando estado…'}</span>
        <span>{events.length ? events.length + ' eventos registrados' : 'Sin eventos todavía'}</span>
      </div>
    </section>
  );
}

function Capabilities({ session }: { session: Session }) {
  const [caps, setCaps] = useState<CapabilityCatalog | null>(() => readCached('capabilities', session.userId));
  useLiveSync(async () => {
    const d = await api('/capabilities', session.accessToken);
    if (d?.capabilities) {
      setCaps(d.capabilities);
      writeCached('capabilities', session.userId, d.capabilities);
    }
  }, session.accessToken, 60000);
  return <CapabilityCenter caps={caps} userId={session.userId} />;
}

function MeditationBackgroundSync({ session }: { session: Session }) {
  useLiveSync(async () => {
    const [overview, capability] = await Promise.all([
      api('/meditation/overview', session.accessToken).catch(() => null),
      api('/capabilities', session.accessToken).catch(() => null),
    ]);
    if (overview) writeCached('meditation_overview', session.userId, overview);
    if (capability?.capabilities) writeCached('capabilities', session.userId, capability.capabilities);
  }, session.accessToken, 10000);
  return null;
}


function Settings({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<UiPrefs>(() => readUiPrefs());
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');

  useEffect(() => {
    if ('Notification' in window) setNotificationPermission(Notification.permission);
  }, []);

  async function updateApp() {
    setBusy(true);
    setStatus('Comprobando versión LIVE…');
    try {
      const response = await fetch('/pwa/version.json?settings=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo consultar la versión LIVE.');
      const live = await response.json();
      if (live?.build && live.build !== BUILD && BUILD !== 'dev') {
        setStatus('Actualización encontrada. Recargando…');
        window.location.replace('/pwa/?update=' + String(live.build) + '-' + Date.now());
        return;
      }
      setStatus('ARIA ya está en la versión LIVE actual.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'No se pudo comprobar la actualización.');
    } finally {
      setBusy(false);
    }
  }

  async function clearCache() {
    setBusy(true);
    setStatus('Borrando caché local…');
    try {
      const sessionSnapshot = localStorage.getItem(SESSION_KEY);
      Object.keys(localStorage)
        .filter(key => key.startsWith(CACHE_PREFIX) || key.startsWith('aria_project_') || key.startsWith('aria_project_tab_'))
        .forEach(key => localStorage.removeItem(key));
      if (sessionSnapshot) localStorage.setItem(SESSION_KEY, sessionSnapshot);
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
      }
      setStatus('Caché borrada. Recargando ARIA…');
      window.setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'No se pudo borrar toda la caché local.');
      setBusy(false);
    }
  }

  function togglePref(key: keyof UiPrefs) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    saveUiPrefs(next);
  }

  async function enableNotifications() {
    if (!('Notification' in window)) return;
    setNotificationPermission(await requestPwaNotificationPermission());
  }

  return (
    <main className='appShell'>
      <header className='topBar'>
        <div><div className='eyebrow'>ARIA / CONFIGURACIÓN</div><h1>Configuración</h1><div className='sub'>Ajustes básicos, mantenimiento y control de la PWA.</div></div>
      </header>
      <div className='pageBodyViewport settingsViewport'>
        <section className='panel settingsHero'>
          <div className='panelTitle'>APLICACIÓN</div>
          <h2>Build actual: {shortBuild(BUILD)}</h2>
          <p className='muted'>Cuenta activa: {session.email || session.userId}</p>
          <div className='actions'><button className='primary' disabled={busy} onClick={() => void updateApp()}>Actualizar app</button></div>
          {status && <div className='notice'>{status}</div>}
        </section>

        <section className='panel'>
          <div className='panelTitle'>INTERFAZ</div>
          <div className='settingsOption'><div><strong>Animaciones</strong><small>Controla las transiciones suaves de la interfaz.</small></div><button className={'toggleButton '+(prefs.animations?'on':'')} onClick={() => togglePref('animations')} aria-pressed={prefs.animations}>{prefs.animations?'Activadas':'Desactivadas'}</button></div>
        </section>

        <section className='panel'>
          <div className='panelTitle'>AVISOS</div>
          <div className='settingsOption'><div><strong>Notificaciones de ARIA</strong><small>{notificationPermission==='granted'?'Los avisos están permitidos.':notificationPermission==='unsupported'?'Este dispositivo no expone notificaciones web.':'Activa los avisos para recibir cambios de misiones.'}</small></div><button className='ghost' disabled={notificationPermission==='granted'||notificationPermission==='unsupported'} onClick={() => void enableNotifications()}>{notificationPermission==='granted'?'Activadas':'Activar avisos'}</button></div>
        </section>

        <section className='panel'>
          <div className='panelTitle'>DATOS LOCALES</div>
          <h2>Limpiar caché</h2>
          <p className='muted'>Borra cachés y preferencias de proyecto sin cerrar tu sesión.</p>
          <button className='ghost' disabled={busy} onClick={() => void clearCache()}>Borrar caché y recargar</button>
        </section>

        <section className='panel'>
          <div className='panelTitle'>SESIÓN</div>
          <p className='muted'>{session.email || session.userId}</p>
          <button className='ghost' onClick={onSignOut}>Cerrar sesión</button>
        </section>
      </div>
    </main>
  );
}
export default function App() {
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3500);
    (async () => {
      try {
        const response = await fetch('/pwa/version.json?ts=' + Date.now(), { cache: 'no-store', signal: controller.signal });
        const live = await response.json().catch(() => null);
        if (!cancelled && live?.build && live.build !== BUILD && BUILD !== 'dev') {
          window.location.replace('/pwa/?update=' + live.build + '-' + Date.now());
        }
      } catch {}
      finally { window.clearTimeout(timer); }
    })();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, []);

  const [session, setSession] = useState<Session | null>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return s && s.expiresAt > Date.now() + 60000 ? s : null;
    } catch { return null; }
  });
  const initialNavigation = navigationFromHash();
  const [navigation, setNavigation] = useState<NavigationState>(() => initialNavigation);
  const [uiPrefs, setUiPrefs] = useState<UiPrefs>(() => readUiPrefs());
  const globalSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const globalSwipeTriggeredRef = useRef(false);
  const page = navigation.page;
  const signOut = () => { localStorage.removeItem(SESSION_KEY); setSession(null); };

  useEffect(() => {
    const syncNavigation = () => setNavigation(navigationFromHash());
    const syncPrefs = () => setUiPrefs(readUiPrefs());
    window.addEventListener('hashchange', syncNavigation);
    window.addEventListener('aria-ui-settings-changed', syncPrefs);
    syncNavigation();
    syncPrefs();
    return () => {
      window.removeEventListener('hashchange', syncNavigation);
      window.removeEventListener('aria-ui-settings-changed', syncPrefs);
    };
  }, []);

  useEffect(() => {
    if (!session?.refreshToken) return;
    let cancelled = false;
    let timer: number | null = null;

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      const refreshIn = Math.max(5_000, session.expiresAt - Date.now() - 60_000);
      timer = window.setTimeout(async () => {
        try {
          const next = await refreshSession(session);
          if (cancelled) return;
          localStorage.setItem(SESSION_KEY, JSON.stringify(next));
          setSession(next);
        } catch (error) {
          if (cancelled) return;
          // Keep the current session during transient network failures, then retry.
          timer = window.setTimeout(schedule, 15_000);
        }
      }, refreshIn);
    };

    const refreshIfNeeded = () => {
      if (Date.now() < session.expiresAt - 60_000) return;
      void (async () => {
        try {
          const next = await refreshSession(session);
          if (cancelled) return;
          localStorage.setItem(SESSION_KEY, JSON.stringify(next));
          setSession(next);
        } catch {}
      })();
    };

    const onVisibility = () => { if (document.visibilityState === 'visible') refreshIfNeeded(); };
    window.addEventListener('focus', refreshIfNeeded);
    document.addEventListener('visibilitychange', onVisibility);
    schedule();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('focus', refreshIfNeeded);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [session?.refreshToken, session?.expiresAt]);

  useEffect(() => {
    if (!uiPrefs.swipeNavigation) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      globalSwipeTriggeredRef.current = false;
      beginGlobalSwipe(event.clientX, event.clientY, event.target);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || globalSwipeTriggeredRef.current) return;
      const start = globalSwipeStartRef.current;
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) < 32 || Math.abs(dx) < Math.abs(dy) * 1.08) return;
      globalSwipeTriggeredRef.current = true;
      event.preventDefault();
      finishGlobalSwipe(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      if (!globalSwipeTriggeredRef.current) finishGlobalSwipe(event.clientX, event.clientY);
      else globalSwipeStartRef.current = null;
      globalSwipeTriggeredRef.current = false;
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return;
      globalSwipeStartRef.current = null;
      globalSwipeTriggeredRef.current = false;
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    document.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
    document.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
    };
  }, [uiPrefs.swipeNavigation, navigation.page, navigation.screen]);

  function beginGlobalSwipe(x: number, y: number, target: EventTarget | null) {
    if (!uiPrefs.swipeNavigation) return;
    const element = target as Element | null;
    if (element?.closest?.('input,textarea,[contenteditable="true"],canvas,.noSwipe')) return;
    globalSwipeStartRef.current = { x, y };
  }

  function finishGlobalSwipe(x: number, y: number) {
    const start = globalSwipeStartRef.current;
    globalSwipeStartRef.current = null;
    if (!uiPrefs.swipeNavigation || !start) return;
    const dx = x - start.x;
    const dy = y - start.y;
    if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.08) return;
    const index = navigationSwipeIndex(navigation);
    const nextIndex = dx < 0 ? Math.min(SWIPE_PAGES.length - 1, index + 1) : Math.max(0, index - 1);
    if (nextIndex !== index) {
      window.location.hash = SWIPE_PAGES[nextIndex];
    }
  }

  function handleGlobalPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    beginGlobalSwipe(e.clientX, e.clientY, e.target);
  }

  function handleGlobalPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    finishGlobalSwipe(e.clientX, e.clientY);
  }

  if (!session) return <Auth onSignedIn={setSession} />;
  const openMission = () => {
    window.location.hash = '#home';
    setNavigation(navigationFromHash());
  };
  return (
    <div
      className={'globalPageFrame ' + (uiPrefs.animations ? '' : 'animationsOff')}
      onPointerDown={handleGlobalPointerDown}
      onPointerUp={handleGlobalPointerUp}
      onPointerCancel={() => { globalSwipeStartRef.current = null; }}
    >
      <PwaNotificationCenter session={session} />
      <MeditationBackgroundSync session={session} />
      {page === 'projects'
        ? <ProjectWorkspace session={session} onBack={() => { window.location.hash = '#home'; }} />
        : page === 'meditation'
          ? <Meditation
              session={session}
              onBack={() => { window.location.hash = '#home'; }}
              onCapabilities={() => { window.location.hash = '#capabilities'; }}
            />
          : page === 'capabilities'
            ? <Capabilities
                session={session}
              />
            : page === 'settings'
              ? <Settings
                  session={session}
                  onSignOut={signOut}
                />
              : <Chat
                  session={session}
                  onMeditation={() => { window.location.hash = '#meditation'; }}
                  onCapabilities={() => { window.location.hash = '#capabilities'; }}
                  onProjects={() => { window.location.hash = '#projects'; }}
                />}
      <GlobalBottomNav
        navigation={navigation}
        onProjects={() => { window.location.hash = '#projects'; }}
        onMeditation={() => { window.location.hash = '#meditation'; }}
        onCapabilities={() => { window.location.hash = '#capabilities'; }}
      />
    </div>
  );
}
