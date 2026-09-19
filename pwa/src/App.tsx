import { useEffect, useRef, useState } from 'react';

const API = '/api';
const CACHE_PREFIX = 'aria-runtime-cache-v2';
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

type Message = { id: string; role: 'user' | 'aria'; text: string };
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

function cacheKey(kind: string, userId: string) {
  return CACHE_PREFIX + ':' + userId + ':' + kind;
}

function readCached<T>(kind: string, userId: string): T | null {
  try {
    const raw = localStorage.getItem(cacheKey(kind, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
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
  conversation_model_execution_failed: 'El modelo que tomó la solicitud no pudo completar la respuesta. ARIA agotó las rutas disponibles; inténtalo de nuevo.',
  conversation_planner_failed: 'El planificador de ARIA no respondió. La interfaz sigue disponible y puedes reintentar.',
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

async function signIn(email: string, password: string) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch('/auth/token?grant_type=password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: ANON },
      body: JSON.stringify({ email: email.trim(), password }),
      cache: 'no-store',
      signal: controller.signal
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok || !d.access_token || !d.user?.id) {
      throw new Error(d.error_description || d.msg || d.error || 'No se pudo iniciar sesión.');
    }
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
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('La autenticación está tardando demasiado. Revisa la conexión e inténtalo de nuevo.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
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
        <input aria-label='Correo' value={email} onChange={e => setEmail(e.target.value)} placeholder='Correo' autoComplete='username' />
        <input aria-label='Contraseña' type='password' value={password} onChange={e => setPassword(e.target.value)} placeholder='Contraseña' autoComplete='current-password' />
        {error && <div className='errorBox'>{error}</div>}
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
  const [tab, setTab] = useState<'overview' | 'models' | 'agents' | 'devices' | 'executors' | 'connections'>('overview');
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
      <section className='panel'>
        <div className='capHero'>
          <div className='heroOrb smallOrb'>ARIA</div>
          <div><div className='eyebrow'>INVENTARIO LIVE</div><div className='capHeroText'>{caps ? (caps.summary.models_available ?? 0) + ' modelos disponibles · ' + (caps.summary.agents_available ?? 0) + ' agentes disponibles · ' + (caps.summary.devices_online ?? 0) + ' dispositivos online' : 'Sincronizando inventario…'}</div><div className='muted'>{caps ? 'Actualizado ' + formatDate(caps.generated_at) : 'Esperando al núcleo'}</div></div>
        </div>
        <div className='capTabs'>
          {(['overview','models','agents','devices','executors','connections'] as const).map(t => <button key={t} className={'tabButton ' + (tab === t ? 'selected' : '')} onClick={() => setTab(t)}>{t === 'overview' ? 'Resumen' : t === 'models' ? 'Modelos' : t === 'agents' ? 'Agentes' : t === 'devices' ? 'Dispositivos' : t === 'executors' ? 'Executors' : 'Conexiones'}</button>)}
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
    </main>
  );
}

function MissionDetail({ mission, events, onClose }: { mission: Mission; events: MissionEvent[]; onClose: () => void }) {
  const status = String(mission.status);
  const terminal = ['succeeded', 'failed', 'blocked', 'cancelled'].includes(status);
  const rawResult = mission.last_stdout || mission.last_stderr || (terminal ? 'La misión terminó sin texto adicional.' : 'La misión continúa.');
  const humanTitle = status === 'succeeded' ? 'Qué hizo ARIA' : status === 'failed' ? 'Qué falló' : 'Situación actual';
  return (
    <div className='modalBackdrop' onClick={onClose}>
      <section className='detailModal' onClick={e => e.stopPropagation()}>
        <div className='detailTop'><div><div className='eyebrow'>RESUMEN DE MISIÓN</div><h2>{mission.goal}</h2><span className={'pill ' + tone(status)}>{statusLabel(status)}</span></div><button className='ghost' onClick={onClose}>Cerrar</button></div>
        <div className='detailGrid'>
          <StatCard value={mission.completed_steps ?? 0} label={'Pasos de ' + (mission.total_steps ?? mission.steps?.length ?? '—')} />
          <StatCard value={terminal ? 'Final' : 'En curso'} label='Estado' />
          <StatCard value={formatDate(mission.finished_at)} label='Finalización' />
        </div>
        <div className='detailResult'><div className='panelTitle'>{humanTitle.toUpperCase()}</div><pre>{String(rawResult)}</pre></div>
        <div className='detailTimeline'>
          <div className='panelTitle'>TIMELINE REAL</div>
          {events.length ? events.map((e: any, i) => <div className='timelineRow' key={e.event_id ?? String(e.created_at) + '-' + i}><span className='timelineDot' /><div><strong>{String(e.event_type ?? 'evento').replaceAll('_', ' ')}</strong><small>{formatDate(e.created_at)}</small>{e.payload && <pre>{JSON.stringify(e.payload, null, 2)}</pre>}</div></div>) : <div className='muted'>No hay eventos adicionales disponibles.</div>}
        </div>
      </section>
    </div>
  );
}

function Chat({
  session,
  onSignOut,
  onMeditation,
  onCapabilities
}: {
  session: Session;
  onSignOut: () => void;
  onMeditation: () => void;
  onCapabilities: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [system, setSystem] = useState<any>(() => readCached('system', session.userId));
  const [caps, setCaps] = useState<CapabilityCatalog | null>(() => readCached('capabilities', session.userId));
  const [mission, setMission] = useState<Mission | null>(() => readCached('active_mission', session.userId));
  const [events, setEvents] = useState<MissionEvent[]>([]);
  const [showMission, setShowMission] = useState(false);
  const [showNewMission, setShowNewMission] = useState(false);
  const [quickView, setQuickView] = useState<{ title: string; items: any[] } | null>(null);
  const [goal, setGoal] = useState('');
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  useLiveSync(syncSystemAndMission, session.accessToken, 8000);
  useLiveSync(syncCapabilities, session.accessToken, 60000);

  useEffect(() => {
    const onBefore = (e: Event) => e.preventDefault();
    window.addEventListener('beforeinstallprompt', onBefore);
    return () => window.removeEventListener('beforeinstallprompt', onBefore);
  }, []);

  async function send() {
    const clean = text.trim();
    if ((!clean && !file) || sending) return;
    setSending(true); setError('');
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
      const d = await api('/conversation', session.accessToken, { method: 'POST', body: JSON.stringify({ parts, clientMessageId: crypto.randomUUID(), conversationId: crypto.randomUUID() }) });
      const p = d.parts?.find((x: any) => x.type === 'text');
      if (p?.text) setMessages(m => [...m, { id: crypto.randomUUID(), role: 'aria', text: p.text }]);
      if (d.mission?.mission_id) await trackMission(d.mission.mission_id);
    } catch (x) {
      setError(x instanceof Error ? x.message : 'Error comunicando con ARIA.');
    } finally {
      setSending(false);
    }
  }

  async function trackMission(id: string) {
    for (let i = 0; i < 90; i++) {
      const [md, ev] = await Promise.all([
        api('/missions/' + encodeURIComponent(id), session.accessToken),
        api('/missions/' + encodeURIComponent(id) + '/events', session.accessToken).catch(() => ({ events: [] }))
      ]);
      setMission(md.mission);
      setEvents(ev.events ?? []);
      if (['succeeded', 'failed', 'blocked', 'cancelled'].includes(String(md.mission.status))) {
        setShowMission(true);
        return;
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  async function runMission() {
    const clean = goal.trim();
    if (!clean || sending) return;
    setSending(true); setError('');
    try {
      const d = await api('/missions', session.accessToken, { method: 'POST', body: JSON.stringify({ goal: clean }) });
      setGoal(''); setShowNewMission(false);
      if (d.mission?.mission_id) await trackMission(d.mission.mission_id);
    } catch (x) {
      setError(x instanceof Error ? x.message : 'No se pudo iniciar la misión.');
    } finally {
      setSending(false);
    }
  }

  return (
    <main className='appShell'>
      <header className='topBar'>
        <div className='brandLine'><div className='brandOrb'>A</div><div><div className='eyebrow'>ARIA · COGNITIVE CORE</div><h1>Centro de Mando</h1><div className='sub'>{syncState === 'live' ? 'Núcleo conectado · sincronización LIVE' : syncState === 'cached' ? 'Núcleo listo · datos locales disponibles' : 'Conectando con el núcleo…'} · build {BUILD}</div></div></div>
        <div className='topActions'><InstallButton /><button className='ghost' onClick={onCapabilities}>Capacidades</button><button className='ghost' onClick={onMeditation}>Meditación IA</button><button className='ghost' onClick={() => setShowNewMission(true)}>Nueva misión</button><button className='ghost' onClick={onSignOut}>Salir</button></div>
      </header>

      <section className='heroPanel'>
        <div className='heroLeft'><div className='heroOrb'>ARIA</div><div><div className='eyebrow'>ESTADO REAL</div><h2>{mission ? statusLabel(String(mission.status)) : 'Lista para actuar'}</h2><p>{mission ? mission.goal : 'Habla con ARIA, lanza una misión o abre el universo completo de capacidades.'}</p></div></div>
        <div className='statsGrid'>
          <button className='statCard statButton' onClick={() => setQuickView({ title: 'Modelos disponibles', items: (caps?.models ?? []).filter((m:any) => m.enabled && m.status === 'available') })}><div className='statValue violet'>{caps?.summary.models_available ?? '—'}</div><div className='statLabel'>Modelos disponibles</div></button>
          <button className='statCard statButton' onClick={() => setQuickView({ title: 'Agentes disponibles', items: (caps?.agents ?? []).filter((a:any) => a.status === 'available') })}><div className='statValue cyan'>{caps?.summary.agents_available ?? '—'}</div><div className='statLabel'>Agentes disponibles</div></button>
          <button className='statCard statButton' onClick={() => setQuickView({ title: 'Dispositivos online', items: (caps?.devices ?? []).filter((d:any) => d.status === 'online') })}><div className='statValue green'>{caps?.summary.devices_online ?? '—'}</div><div className='statLabel'>Dispositivos online</div></button>
          <button className='statCard statButton' onClick={() => setQuickView({ title: 'Conexiones', items: caps?.connections ?? [] })}><div className='statValue gold'>{caps?.summary.connections ?? '—'}</div><div className='statLabel'>Conexiones</div></button>
        </div>
      </section>

      <section className='panel'>
          <div className='panelTitle'>CONVERSACIÓN DIRECTA</div>
          <div className='chatWindow'>{messages.length ? messages.map(m => <div key={m.id} className={'bubble ' + m.role}>{m.text}</div>) : <div className='emptyState'>Habla con ARIA. Ella decide si conversa, recuerda, planifica o ejecuta una misión.</div>}</div>
          {file && <div className='fileChip'>{file.name}<button onClick={() => setFile(null)}>×</button></div>}
          {error && <div className='errorBox'>{error}</div>}
          <div className='composer'>
            <input type='file' ref={fileRef} hidden onChange={e => setFile(e.target.files?.[0] ?? null)} />
            <button className='tool' onClick={() => fileRef.current?.click()}>Adjunto</button>
            <textarea value={text} onChange={e => setText(e.target.value)} placeholder='Habla con ARIA…' />
            <button className='send' disabled={sending || (!text.trim() && !file)} onClick={send}>{sending ? '…' : '↑'}</button>
          </div>
        </div>

        <div className='panel missionPanel'>
          <div className='panelTitle'>ACCIONES GOBERNADAS</div>
          <button className='actionCard' onClick={() => setShowNewMission(true)}><strong>Ejecutar una misión</strong><span>Objetivo → planner → governance → runtime → verificación.</span></button>
          <button className='actionCard' onClick={onCapabilities}><strong>Explorar capacidades</strong><span>Modelos, agentes, dispositivos, executors y conexiones reales.</span></button>
          <button className='actionCard' onClick={onMeditation}><strong>Controlar Meditación IA</strong><span>Continuidad, Human Gates, bloqueos y progreso.</span></button>
          {mission && <button className='actionCard emphasis' onClick={() => setShowMission(true)}><strong>Ver misión actual</strong><span>{statusLabel(String(mission.status))} · abrir resultado y timeline.</span></button>}
        </div>
      </section>

      {quickView && <QuickCatalogModal title={quickView.title} items={quickView.items} onClose={() => setQuickView(null)} />}

      {mission && <section className='panel livePanel'><div className='panelHeading'><div><div className='panelTitle'>EJECUCIÓN ACTUAL</div><h2>{mission.goal}</h2></div><button className={'pill ' + tone(String(mission.status))} onClick={() => setShowMission(true)}>{statusLabel(String(mission.status))}</button></div><div className='progressBar'><span style={{ width: (Math.max(0, Math.min(100, Number(mission.completed_steps ?? 0) / Math.max(1, Number(mission.total_steps ?? 1)) * 100)) + '%') }} /></div><div className='muted'>Paso {mission.completed_steps ?? 0} de {mission.total_steps ?? mission.steps?.length ?? '—'} · {mission.next_action ?? 'sin siguiente acción'}</div></section>}

      {showMission && mission && <MissionDetail mission={mission} events={events} onClose={() => setShowMission(false)} />}

      {showNewMission && <div className='modalBackdrop' onClick={() => setShowNewMission(false)}><section className='detailModal compactModal' onClick={e => e.stopPropagation()}><div className='eyebrow'>NUEVA MISIÓN</div><h2>¿Qué debe hacer ARIA?</h2><p className='muted'>La solicitud seguirá el runtime canónico y sus controles de governance.</p><textarea value={goal} onChange={e => setGoal(e.target.value)} placeholder='Ejemplo: revisa el estado de X y dime qué está mal.' /><div className='modalActions'><button className='ghost' onClick={() => setShowNewMission(false)}>Cancelar</button><button className='primary' disabled={!goal.trim() || sending} onClick={runMission}>{sending ? 'Enviando…' : 'Crear misión'}</button></div></section></div>}
    </main>
  );
}

function Meditation({ session, onBack, onCapabilities }: { session: Session; onBack: () => void; onCapabilities: () => void }) {
  const [o, setO] = useState<any>(() => readCached('meditation_overview', session.userId));
  const [caps, setCaps] = useState<CapabilityCatalog | null>(() => readCached('capabilities', session.userId));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [overview, capability] = await Promise.all([
        api('/meditation/overview', session.accessToken),
        api('/capabilities', session.accessToken)
      ]);
      setO(overview);
      setCaps(capability.capabilities);
      writeCached('meditation_overview', session.userId, overview);
      writeCached('capabilities', session.userId, capability.capabilities);
      setError('');
    } catch (x) {
      if (!o) setError(x instanceof Error ? x.message : 'No se pudo sincronizar Meditación IA.');
    }
  }

  useLiveSync(load, session.accessToken, 10000);

  async function control(action: string) {
    setBusy(true); setError('');
    try { await api('/meditation/control', session.accessToken, { method: 'POST', body: JSON.stringify({ action }) }); await load(); }
    catch (x) { setError(x instanceof Error ? x.message : 'No se pudo cambiar el estado.'); }
    finally { setBusy(false); }
  }

  const m = o?.active_mission;

  return (
    <main className='appShell'>
      <header className='topBar'>
        <div><div className='eyebrow'>ARIA / CONTINUIDAD</div><h1>MEDITACIÓN IA</h1><div className='sub'>Ejecución autónoma, verificación y Human Gates</div></div>
        <div className='topActions'><button className='ghost' onClick={onBack}>← Centro</button><button className='ghost' onClick={onCapabilities}>Capacidades</button></div>
      </header>
      <section className='statePanel'><div><div className='panelTitle'>ESTADO CLOUD</div><div className='bigStatus'>{o?.mode ? statusLabel(String(o.mode)) : 'Sincronizando…'}</div><div className='muted'>Misión activa: {m ? m.goal : 'ninguna'}</div></div><div className='actions'><button className='primary' disabled={busy} onClick={() => control('activate')}>Activar</button><button className='ghost' disabled={busy} onClick={() => control('pause')}>Pausar</button><button className='ghost' disabled={busy} onClick={() => control('stop')}>Detener</button></div></section>
      {error && <div className='errorBox'>{error}</div>}
      <section className='statsGrid'><StatCard value={o?.counts?.missions ?? 0} label='Misiones visibles' /><StatCard value={o?.counts?.human_gates ?? 0} label='Human Gates' /><StatCard value={o?.counts?.blocked ?? 0} label='Bloqueadas' /><StatCard value={caps?.summary.executors ?? 0} label='Executors' /></section>
      <section className='panel'><div className='panelTitle'>MISIÓN ACTUAL</div>{m ? <><h2>{m.goal}</h2><div className='progressBar'><span style={{ width: (Number(m.progress_percent ?? 0) + '%') }} /></div><div className='muted'>{Number(m.progress_percent ?? 0).toFixed(1)}% · ETA {m.eta?.eta_seconds ? String(Math.round(m.eta.eta_seconds)) + ' s' : '—'}</div>{(m.steps ?? []).map((s: any) => <div className='stepRow' key={s.id}><b>{s.index}</b><div><strong>{s.title}</strong><small>{statusLabel(String(s.status))} · {s.executor_type || 'ejecución'} · {s.operation || 'operación'}</small></div></div>)}</> : <div className='emptyState'>Meditación IA está lista. Las misiones aparecerán aquí cuando el runtime las asigne.</div>}</section>
      <section className='panel'><div className='panelTitle'>HUMAN GATES</div>{(o?.human_gates ?? []).slice(0, 8).map((g: any) => <div className='row' key={g.id}><span className='dot warning' /><div><strong>{g.risk}</strong><small>{g.mission_goal}</small></div></div>)}{!(o?.human_gates?.length) && <div className='muted'>No hay Human Gates pendientes.</div>}</section>
      <section className='panel'><div className='panelTitle'>BLOQUEADAS</div>{(o?.blocked ?? []).slice(0, 8).map((b: any) => <div className='row' key={b.mission_id}><span className='dot bad' /><div><strong>{b.reason_type}</strong><small>{b.reason}</small></div></div>)}{!(o?.blocked?.length) && <div className='muted'>No hay misiones bloqueadas visibles.</div>}</section>
      <section className='panel'><div className='panelTitle'>HISTORIAL</div>{(o?.missions ?? []).slice(0, 10).map((r: any) => <div className='row' key={r.mission_id}><span className={'dot ' + tone(String(r.status))} /><div><strong>{r.goal}</strong><small>{statusLabel(String(r.status))} · {formatDate(r.updated_at)}</small></div></div>)}</section>
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

export default function App() {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return s && s.expiresAt > Date.now() + 60000 ? s : null;
    } catch { return null; }
  });
  const [page, setPage] = useState<'aria' | 'meditation' | 'capabilities'>('aria');
  const signOut = () => { localStorage.removeItem(SESSION_KEY); setSession(null); };
  if (!session) return <Auth onSignedIn={setSession} />;
  const openMission = () => setPage('aria');
  if (page === 'meditation') return <Meditation session={session} onBack={() => setPage('aria')} onCapabilities={() => setPage('capabilities')} />;
  if (page === 'capabilities') return <Capabilities session={session} onBack={() => setPage('aria')} onMeditation={() => setPage('meditation')} onMission={openMission} />;
  return <Chat session={session} onSignOut={signOut} onMeditation={() => setPage('meditation')} onCapabilities={() => setPage('capabilities')} />;
}
