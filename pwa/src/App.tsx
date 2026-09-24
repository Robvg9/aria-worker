import { useEffect, useRef, useState } from 'react';
import { ProjectWorkspace } from './ProjectWorkspace';
import { getNotificationIdFromHash, humanizeMeditationDetail, humanizeMeditationNotification, requestPwaNotificationPermission, showPwaNotification, type PwaNotificationItem } from './notifications';

const API = '/api';
const CACHE_PREFIX = 'aria-runtime-cache-v3';
const CACHE_TTL_MS: Record<string, number> = { system: 15000, capabilities: 60000, active_mission: 10000, meditation_overview: 10000 };
const ANON = 'sb_publishable_E2AmZNo2hAbOYlytkVbyBQ_X7JH0HPw';
const SESSION_KEY = 'aria_session_v2';
const BUILD = import.meta.env.VITE_BUILD ?? '2026.09.19-pwa-v9';

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
  const direct = [mission?.last_stdout, mission?.last_stderr]
    .map((v: any) => typeof v === 'string' ? v.trim() : '')
    .filter(Boolean);
  if (direct.length) return direct.join('\n\n');
  const results = mission?.checkpoint?.results && typeof mission.checkpoint.results === 'object' ? mission.checkpoint.results : {};
  const texts: string[] = [];
  for (const value of Object.values(results) as any[]) {
    const candidates = [value?.response?.content, value?.response?.text, value?.stdout, value?.output, value?.message, value?.result?.response?.content];
    const found = candidates.find((v: any) => typeof v === 'string' && v.trim());
    if (found) texts.push(String(found).trim());
  }
  return texts.join('\n\n');
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
  return step?.status === 'succeeded' ? 'Verificación registrada' : 'Verificación aún no emitida';
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
        <div className='eyebrow'>DIRECT ARIA · {BUILD}</div>
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
  onBack,
  onMission
}: {
  caps: CapabilityCatalog | null;
  onBack: () => void;
  onMission: () => void;
}) {
  const CAP_TAB_KEY='aria_capabilities_tab_v2:'+session.userId;
  const [tab, setTab] = useState<'overview' | 'models' | 'agents' | 'devices' | 'executors' | 'connections'>(() => {
    try {
      const saved = localStorage.getItem(CAP_TAB_KEY);
      return (saved as any) || 'overview';
    } catch {
      return 'overview';
    }
  });
  const [filter, setFilter] = useState('');
  const source = tab === 'models' ? caps?.models ?? [] : tab === 'agents' ? caps?.agents ?? [] : tab === 'devices' ? caps?.devices ?? [] : tab === 'executors' ? caps?.executors ?? [] : tab === 'connections' ? caps?.connections ?? [] : [];
  const q = filter.trim().toLowerCase();
  const filtered = q ? source.filter((item: any) => JSON.stringify(item).toLowerCase().includes(q)) : source;
  return (
    <main className='appShell'>
      <header className='topBar'>
        <div><div className='eyebrow'>ARIA / UNIVERSO</div><h1>Centro de capacidades</h1><div className='sub'>Inventario real, estado operativo y rutas gobernadas. Sin secretos.</div></div>
        <div className='topActions'><button className='ghost' onClick={onBack}>← Centro</button><button className='primary' onClick={onMission}>Nueva misión</button></div>
      </header>
      <div className='pageBodyViewport capabilitiesViewport'>
      <section className='panel'>
        <div className='capHero'>
          <div className='heroOrb smallOrb'>ARIA</div>
          <div><div className='eyebrow'>INVENTARIO LIVE</div><div className='capHeroText'>{caps ? (caps.summary.models_available ?? 0) + ' modelos disponibles · ' + (caps.summary.agents_available ?? 0) + ' agentes disponibles · ' + (caps.summary.devices_online ?? 0) + ' dispositivos online' : 'Sincronizando inventario…'}</div><div className='muted'>{caps ? 'Actualizado ' + formatDate(caps.generated_at) : 'Esperando al núcleo'}</div></div>
        </div>
        <div className='capTabs'>
          {(['overview','models','agents','devices','executors','connections'] as const).map(t => <button key={t} className={'tabButton ' + (tab === t ? 'selected' : '')} onClick={() => { setTab(t); try { localStorage.setItem(CAP_TAB_KEY,t); } catch {} }}>{t === 'overview' ? 'Resumen' : t === 'models' ? 'Modelos' : t === 'agents' ? 'Agentes' : t === 'devices' ? 'Dispositivos' : t === 'executors' ? 'Executors' : 'Conexiones'}</button>)}
        </div>
        {tab === 'overview' ? (
          caps ? (
            <div className='capGrid'>
              <button className='capTile' onClick={() => setTab('models')}><span>MODELOS</span><strong>{caps.summary.models ?? 0}</strong><small>{caps.summary.models_available ?? 0} disponibles</small></button>
              <button className='capTile' onClick={() => setTab('agents')}><span>AGENTES</span><strong>{caps.summary.agents ?? 0}</strong><small>{caps.summary.agents_available ?? 0} disponibles</small></button>
              <button className='capTile' onClick={() => setTab('devices')}><span>DISPOSITIVOS</span><strong>{caps.summary.devices ?? 0}</strong><small>{caps.summary.devices_online ?? 0} online</small></button>
              <button className='capTile' onClick={() => setTab('executors')}><span>EXECUTORS</span><strong>{caps.summary.executors ?? 0}</strong><small>rutas gobernadas</small></button>
              <button className='capTile' onClick={() => setTab('connections')}><span>CONEXIONES</span><strong>{caps.summary.connections ?? 0}</strong><small>estado no sensible</small></button>
            </div>
          ) : <div className='emptyState'>No se pudo cargar el inventario.</div>
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

function MissionDetail({ mission, events, onClose }: { mission: Mission; events: MissionEvent[]; onClose: () => void }) {
  const status = String(mission.status);
  const terminal = ['succeeded', 'failed', 'blocked', 'cancelled'].includes(status);
  const summary = missionHumanSummary(mission);
  const humanTitle = status === 'succeeded' ? 'Resumen humano' : status === 'failed' ? 'Qué falló' : status === 'blocked' ? 'Diagnóstico del bloqueo' : status === 'waiting' ? 'Verificación en curso' : 'Situación actual';
  return (
    <div className='modalBackdrop' onClick={onClose}>
      <section className='detailModal' onClick={e => e.stopPropagation()}>
        <div className='detailTop'><div><div className='eyebrow'>RESUMEN DE MISIÓN</div><h2>{mission.goal}</h2><span className={'pill ' + tone(status)}>{statusLabel(status)}</span></div><button className='ghost' onClick={onClose}>Cerrar</button></div>
        <div className='detailGrid'>
          <StatCard value={mission.completed_steps ?? 0} label={'Pasos de ' + (mission.total_steps ?? mission.steps?.length ?? '—')} />
          <StatCard value={terminal ? 'Final' : 'En curso'} label='Estado' />
          <StatCard value={formatDate(mission.finished_at)} label='Finalización' />
        </div>
        {mission?.block_details && (status === 'blocked' || status === 'waiting' || mission.block_details.kind === 'replan_required') && (
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
          {summary.result ? <div className='missionAnswer'><div className='panelTitle'>RESPUESTA / RESULTADO DE ARIA</div><div className='markdownBody'>{renderMarkdown(summary.result)}</div></div> : <div className='muted'>ARIA no registró todavía un texto de resultado.</div>}
        </div>
        <section className='technicalDetails technicalDetailsOpen'>
          <div className='technicalDetailsTitle'>EVIDENCIA TÉCNICA</div>
          <div className='detailTimeline'>
            <div className='panelTitle'>TIMELINE REAL</div>
            {events.length ? events.map((e: any, i) => <div className='timelineRow' key={e.event_id ?? String(e.created_at) + '-' + i}><span className='timelineDot' /><div><strong>{String(e.event_type ?? 'evento').replaceAll('_', ' ')}</strong><small>{formatDate(e.created_at)}</small>{e.payload && <pre>{JSON.stringify(e.payload, null, 2)}</pre>}</div></div>) : <div className='muted'>No hay eventos adicionales disponibles.</div>}
          </div>
        </section>
      </section>
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
  const [messages, setMessages] = useState<Message[]>([]);
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
  const [conversationId, setConversationId] = useState<string | null>(null);
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
        setConversationId(typeof d?.conversation_id === 'string' ? d.conversation_id : null);
        setMessages(restored);
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
      if (d.mission?.mission_id) void trackMission(d.mission.mission_id);
    } catch (x) {
      setError(x instanceof Error ? x.message : 'Error comunicando con ARIA.');
    } finally {
      setSending(false);
      window.setTimeout(() => chatInputRef.current?.focus(), 0);
    }
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

  const swipeStart = useRef<{x:number;y:number}|null>(null);
  const onSwipeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as Element | null;
    if (target?.closest?.('button,input,textarea,a,[role="button"]')) return;
    swipeStart.current = { x: e.clientX, y: e.clientY };
  };
  const onSwipeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.25) return;
    if (dx < 0 && screen === 0) window.location.hash = '#chat';
    if (dx > 0 && screen === 1) window.location.hash = '#home';
  };

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
                ? 'Núcleo conectado · sincronización LIVE'
                : syncState === 'cached'
                  ? 'Núcleo listo · datos locales disponibles'
                  : 'Conectando con el núcleo…'} · build {BUILD}
            </div>
          </div>
        </div>
        <div className='topActions'>
          <InstallButton />
          <button className='ghost desktopOnly' onClick={onMeditation}>Meditación IA</button>
          <button className='primary desktopOnly' onClick={() => setShowNewMission(true)}>Nueva misión</button>
        </div>
      </header>

      <div
        className='screenViewport'
        onPointerDown={onSwipeStart}
        onPointerUp={onSwipeEnd}
        onPointerCancel={() => { swipeStart.current = null; }}
      >
        <div className='screenIndicator' aria-label='Navegación entre Dashboard y Chat'>
          <span className={screen === 0 ? 'active' : ''}>1 · Dashboard</span>
          <span className='screenIndicatorArrow'>↔</span>
          <span className={screen === 1 ? 'active' : ''}>2 · Chat</span>
        </div>
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
      setO(overview);
      writeCached('meditation_overview', session.userId, overview);
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

  useLiveSync(load, session.accessToken, 10000);

  async function openMission(missionId: string) {
    try {
      setError('');
      const [missionResult, eventsResult] = await Promise.all([
        api('/missions/' + encodeURIComponent(missionId), session.accessToken),
        api('/missions/' + encodeURIComponent(missionId) + '/events', session.accessToken).catch(() => ({ events: [] }))
      ]);
      if (!missionResult?.mission) throw new Error('No se pudo recuperar la información de la misión.');
      setMissionDetail(missionResult.mission);
      setMissionEvents(eventsResult?.events ?? []);
    } catch (x) {
      setError(x instanceof Error ? x.message : 'No se pudo abrir la misión.');
    }
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
      {error && <div className='errorBox'><div>{error}</div>{error.includes('sincronizar') && <button className='ghost' disabled={syncing} onClick={() => void load()}>{syncing ? 'Sincronizando…' : 'Reintentar ahora'}</button>}</div>}
      <section className='statsGrid'><StatCard value={o ? (o?.counts?.missions ?? 0) : '—'} label='Misiones visibles' /><StatCard value={o ? (o?.counts?.human_gates ?? 0) : '—'} label='Human Gates' /><StatCard value={o ? (o?.counts?.blocked ?? 0) : '—'} label='Bloqueadas' /><StatCard value={caps ? (caps?.summary.executors ?? 0) : '—'} label='Executors' /></section>
      <section className='panel'><div className='panelTitle'>MISIÓN ACTUAL</div>{m ? <><h2>{m.goal}</h2><div className='progressBar'><span style={{ width: (Number(m.progress_percent ?? 0) + '%') }} /></div><div className='muted'>{Number(m.progress_percent ?? 0).toFixed(1)}% · ETA {m.eta?.eta_seconds ? String(Math.round(m.eta.eta_seconds)) + ' s' : '—'}</div>{(m.steps ?? []).map((s: any) => <div className='stepRow' key={s.id}><b>{s.index}</b><div><strong>{s.title}</strong><small>{statusLabel(String(s.status))} · {s.executor_type || 'ejecución'} · {s.operation || 'operación'} · {verificationLabel(s)}</small></div></div>)}</> : <div className='emptyState'>Meditación IA está lista. Las misiones aparecerán aquí cuando el runtime las asigne.</div>}</section>
      <section className='panel'><div className='panelTitle'>HUMAN GATES</div>{(o?.human_gates ?? []).slice(0, 8).map((g: any) => <div className='row' key={g.id}><span className='dot warning' /><div><strong>{g.risk}</strong><small>{g.mission_goal}</small></div></div>)}{!(o?.human_gates?.length) && <div className='muted'>No hay Human Gates pendientes.</div>}</section>
      <section className='panel'><div className='panelTitle'>ESPERANDO VERIFICACIÓN</div>{(o?.verification_pending ?? []).slice(0, 8).map((b: any) => <button className='row' key={b.mission_id} onClick={() => void openMission(b.mission_id)}><span className='dot warning' /><div><strong>{b.goal}</strong><small>{b.reason} · Abrir diagnóstico</small></div><span>›</span></button>)}{!(o?.verification_pending?.length) && <div className='muted'>No hay verificaciones externas pendientes.</div>}</section>
      <section className='panel'><div className='panelTitle'>BLOQUEADAS</div>{(o?.blocked ?? []).slice(0, 8).map((b: any) => <button className='row' key={b.mission_id} onClick={() => void openMission(b.mission_id)}><span className='dot bad' /><div><strong>{b.reason_type}</strong><small>{b.reason} · Abrir diagnóstico</small></div><span>›</span></button>)}{!(o?.blocked?.length) && <div className='muted'>No hay misiones bloqueadas visibles.</div>}</section>
      <section className='panel'><div className='panelTitle'>HISTORIAL</div>{(o?.missions ?? []).slice(0, 10).map((r: any) => <button className='row' key={r.mission_id} onClick={() => void openMission(r.mission_id)}><span className={'dot ' + tone(String(r.status))} /><div><strong>{r.goal}</strong><small>{statusLabel(String(r.status))} · {formatDate(r.updated_at)}</small></div><span>›</span></button>)}</section>
      {missionDetail && <MissionDetail mission={missionDetail} events={missionEvents} onClose={() => { setMissionDetail(null); setMissionEvents([]); }} />}
      </div>
    </main>
  );
}

function Capabilities({ session, onBack, onMeditation, onMission }: { session: Session; onBack: () => void; onMeditation: () => void; onMission: () => void }) {
  const [caps, setCaps] = useState<CapabilityCatalog | null>(() => readCached('capabilities', session.userId));
  useLiveSync(async () => {
    const d = await api('/capabilities', session.accessToken);
    if (d?.capabilities) {
      setCaps(d.capabilities);
      writeCached('capabilities', session.userId, d.capabilities);
    }
  }, session.accessToken, 60000);
  return <CapabilityCenter caps={caps} onBack={onBack} onMission={onMission} />;
}

function Settings({ session, onBack, onSignOut }: { session: Session; onBack: () => void; onSignOut: () => void }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function checkForUpdate(force = false) {
    setBusy(true);
    setStatus('Comprobando versión LIVE…');
    try {
      const response = await fetch('/pwa/version.json?settings=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('No se pudo consultar la versión LIVE.');
      const live = await response.json();
      if (live?.build && live.build !== BUILD && BUILD !== 'dev') {
        setStatus('Hay una actualización disponible. Recargando…');
        window.location.replace('/pwa/?update=' + String(live.build) + '-' + Date.now());
        return;
      }
      if (force) {
        setStatus('Forzando actualización del PWA…');
        window.location.replace('/pwa/?update=manual-' + Date.now());
        return;
      }
      setStatus('Ya tienes la versión LIVE más reciente.');
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

  return (
    <main className='appShell'>
      <header className='topBar'>
        <div><div className='eyebrow'>ARIA / CONFIGURACIÓN</div><h1>Configuración</h1><div className='sub'>Mantenimiento local y control de versión de la PWA.</div></div>
        <div className='topActions'><button className='ghost navBack' onClick={onBack}>← Centro</button></div>
      </header>
      <div className='pageBodyViewport settingsViewport'>
        <section className='panel settingsHero'>
          <div className='panelTitle'>VERSIÓN</div>
          <h2>Build actual: {BUILD}</h2>
          <p className='muted'>Cuenta activa: {session.email || session.userId}</p>
          <div className='actions'>
            <button className='primary' disabled={busy} onClick={() => void checkForUpdate(false)}>Buscar actualización</button>
            <button className='ghost' disabled={busy} onClick={() => void checkForUpdate(true)}>Actualizar app</button>
          </div>
          {status && <div className='notice'>{status}</div>}
        </section>
        <section className='panel'>
          <div className='panelTitle'>DATOS LOCALES</div>
          <h2>Limpiar caché</h2>
          <p className='muted'>Borra cachés y preferencias locales de ARIA sin cerrar tu sesión. Úsalo ante pantallas viejas, recursos atascados o comportamientos extraños después de una actualización.</p>
          <button className='ghost' disabled={busy} onClick={() => void clearCache()}>Borrar caché y recargar</button>
        </section>
        <section className='panel'>
          <div className='panelTitle'>SESIÓN</div>
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
  const page = navigation.page;
  const signOut = () => { localStorage.removeItem(SESSION_KEY); setSession(null); };

  useEffect(() => {
    const syncNavigation = () => setNavigation(navigationFromHash());
    window.addEventListener('hashchange', syncNavigation);
    syncNavigation();
    return () => window.removeEventListener('hashchange', syncNavigation);
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

  if (!session) return <Auth onSignedIn={setSession} />;
  const openMission = () => {
    window.location.hash = '#home';
    setNavigation(navigationFromHash());
  };
  return (
    <>
      <PwaNotificationCenter session={session} />
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
                onBack={() => { window.location.hash = '#home'; }}
                onMeditation={() => { window.location.hash = '#meditation'; }}
                onMission={() => { window.location.hash = '#mission'; }}
              />
            : page === 'settings'
              ? <Settings
                  session={session}
                  onBack={() => { window.location.hash = '#home'; }}
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
    </>
  );
}
