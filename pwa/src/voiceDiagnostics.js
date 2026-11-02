const STORAGE_KEY = 'aria_voice_diagnostics_v1';
const MAX_RECORDS = 60;

const EVENTS = new Set([
  'voice_enabled',
  'voice_disabled',
  'api_missing',
  'permission_snapshot',
  'recognition_start_attempt',
  'recognition_started',
  'recognition_start_failed',
  'recognition_error',
  'recognition_end',
  'interim_result',
  'no_final_result',
  'no_match',
  'final_result',
  'wake_match',
  'wake_rejected',
  'turn_submitted',
  'page_hidden',
  'page_visible',
  'page_hide',
  'restart_scheduled',
  'conversation_request_started',
  'conversation_response_received',
  'conversation_request_failed'
]);

const DETAIL_FIELDS = new Set([
  'chars',
  'phrase_chars',
  'command_chars',
  'error',
  'permission_state',
  'restart_delay_ms',
  'language',
  'reason',
  'recognition_api',
  'wake_matched',
  'voice_mode',
  'duration_ms',
  'response_chars',
  'processing',
  'error_code'
]);

function getStorage(host) {
  if (host && Object.prototype.hasOwnProperty.call(host, 'storage')) return host.storage;
  try {
    return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

function getEnvironment(host = {}) {
  const win = host.window || (typeof globalThis.window !== 'undefined' ? globalThis.window : {});
  const nav = host.navigator || (typeof globalThis.navigator !== 'undefined' ? globalThis.navigator : {});
  const doc = host.document || (typeof globalThis.document !== 'undefined' ? globalThis.document : {});
  const recognitionApi = typeof win.SpeechRecognition === 'function'
    ? 'standard'
    : typeof win.webkitSpeechRecognition === 'function'
      ? 'webkit'
      : 'none';

  return {
    secure_context: typeof host.secureContext === 'boolean'
      ? host.secureContext
      : globalThis.isSecureContext === true,
    page_visible: doc.hidden !== true,
    recognition_api: recognitionApi,
    permissions_api: Boolean(nav.permissions && typeof nav.permissions.query === 'function'),
    media_devices_api: Boolean(nav.mediaDevices && typeof nav.mediaDevices.getUserMedia === 'function')
  };
}

function sanitizeDetails(details = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (!DETAIL_FIELDS.has(key)) continue;
    if (typeof value === 'boolean') {
      safe[key] = value;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      safe[key] = Math.max(0, Math.min(1000000, Math.round(value)));
      continue;
    }
    if (typeof value === 'string') {
      const clean = value.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 48);
      if (clean) safe[key] = clean;
    }
  }
  return safe;
}

export function readVoiceDiagnostics(host = {}) {
  const storage = getStorage(host);
  if (!storage || typeof storage.getItem !== 'function') return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && item.schema === 'aria-voice-diagnostic-v1' && EVENTS.has(item.event))
      .slice(-MAX_RECORDS);
  } catch {
    return [];
  }
}

export function appendVoiceDiagnostic(event, details = {}, host = {}) {
  if (!EVENTS.has(event)) return { count: readVoiceDiagnostics(host).length, persisted: false, record: null };
  const storage = getStorage(host);
  const now = Number.isFinite(host.now) ? host.now : Date.now();
  const record = {
    schema: 'aria-voice-diagnostic-v1',
    at: new Date(now).toISOString(),
    event,
    environment: getEnvironment(host),
    details: sanitizeDetails(details)
  };
  if (!storage || typeof storage.setItem !== 'function') {
    return { count: readVoiceDiagnostics(host).length, persisted: false, record };
  }

  const records = readVoiceDiagnostics(host);
  const next = [...records, record].slice(-MAX_RECORDS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
    return { count: next.length, persisted: true, record };
  } catch {
    return { count: records.length, persisted: false, record };
  }
}

export function clearVoiceDiagnostics(host = {}) {
  const storage = getStorage(host);
  if (!storage || typeof storage.removeItem !== 'function') return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
