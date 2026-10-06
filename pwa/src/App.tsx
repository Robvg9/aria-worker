import { useEffect, useRef, useState } from 'react';
import { ProjectWorkspace } from './ProjectWorkspace';
import { mergeRestoredChatMessages } from './chatHistory';
import { missionActivityLabel, missionGoalPreview, missionHumanTitle, missionListLabel } from './missionPresentation';
import { TEST_CATALOG, TEST_CATALOG_STATS, TEST_CATALOG_VERSION, filterTestCatalog } from './testCatalog';
import { getNotificationIdFromHash, humanizeMeditationDetail, humanizeMeditationNotification, requestPwaNotificationPermission, showPwaNotification, type PwaNotificationItem } from './notifications';

const API = '/api';
const CACHE_PREFIX = 'aria-runtime-cache-v3';
const CACHE_TTL_MS: Record<string, number> = { system: 15000, capabilities: 21600000, active_mission: 10000, meditation_overview: 15000 };
const ANON = 'sb_publishable_E2AmZNo2hAbOYlytkVbyBQ_X7JH0HPw';
const SESSION_KEY = 'aria_session_v2';
const UI_PREFS_KEY = 'aria_ui_preferences_v1';
const BUILD = import.meta.env.VITE_BUILD || '2026.09.24-pwa-v10';
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
type AbsorptionRecord = any;
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

function tryParseJson(value: any): any | null {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || !(text.startsWith('{') || text.startsWith('['))) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function humanizeStructuredMissionResult(value: any, mission: any): string {
  const parsed = tryParseJson(value);
  if (!parsed) return String(value ?? '').trim();

  if (Array.isArray(parsed)) {
    return parsed.map((item: any) => humanizeStructuredMissionResult(item, mission)).filter(Boolean).slice(0, 8).join('\n\n');
  }

  const status = String(parsed?.status ?? parsed?.runtime_status ?? '').toLowerCase();
  const goal = String(mission?.goal ?? '').toLowerCase();
  const diagnosticsGoal = /(diagnostica|diagnóstico|diagnostico|causa raíz|causa raiz|computer\.use\.autonomous|windows device)/.test(goal);

  if (diagnosticsGoal && (parsed?.ref || parsed?.recoveredexistingbranch || parsed?.existingbasemismatch) && !parsed?.root_cause && !parsed?.diagnosis) {
    const details: string[] = [];
    if (parsed?.ref) details.push('ARIA verificó una referencia de trabajo en GitHub: ' + String(parsed.ref) + '.');
    if (parsed?.recoveredexistingbranch === true) details.push('La referencia ya existía; ARIA no demuestra que haya creado una nueva rama.');
    if (parsed?.existingbasemismatch === true) details.push('La rama existente no coincidía con la base solicitada.');
    return [
      'ARIA NO DEMOSTRÓ EL DIAGNÓSTICO SOLICITADO.',
      details.join(' '),
      'Esta evidencia corresponde a la capa de GitHub y no demuestra heartbeat, capacidades, gateway, reclamación del trabajo ni disponibilidad real de Computer Use en Windows.',
      'Objetivo no demostrado: la misión debe volver a ejecutarse con un plan que investigue directamente el dispositivo Windows y el ejecutor Computer Use.'
    ].join('\n\n');
  }

  if (parsed?.finished_reason || parsed?.coverage_ratio != null || parsed?.actions_verified != null) {
    const parts = [
      parsed.verified === true || status === 'succeeded' ? 'ARIA terminó con verificación.' : 'ARIA terminó sin verificación completa.',
      parsed.actions_verified != null ? 'Acciones verificadas: ' + Number(parsed.actions_verified) + '.' : '',
      parsed.screens_seen != null ? 'Pantallas observadas: ' + Number(parsed.screens_seen) + '.' : '',
      parsed.coverage_ratio != null ? 'Cobertura registrada: ' + Math.round(Number(parsed.coverage_ratio) * 100) + '%.' : '',
      parsed.finished_reason ? 'Motivo de finalización: ' + humanizeTechnicalText(String(parsed.finished_reason)) + '.' : '',
    ].filter(Boolean);
    return parts.join(' ');
  }

  if (typeof parsed?.message === 'string' && parsed.message.trim()) return parsed.message.trim();
  if (parsed?.response?.content || parsed?.response?.text || parsed?.output_text) {
    return humanizeStructuredMissionResult(parsed.response?.content ?? parsed.response?.text ?? parsed.output_text, mission);
  }
  if (parsed?.data && typeof parsed.data === 'object') {
    const nested = humanizeStructuredMissionResult(parsed.data, mission);
    if (nested) return nested;
  }
  if (status === 'succeeded') {
    const operation = parsed?.operation ? humanOperation(parsed.operation, parsed.executor_type) : '';
    return operation
      ? 'ARIA completó ' + operation + ', pero el resultado no contiene una explicación humana suficiente del objetivo.'
      : 'ARIA completó el paso, pero el resultado no contiene una explicación humana suficiente del objetivo.';
  }
  return 'ARIA devolvió un resultado estructurado, pero no contiene información suficiente para explicar el objetivo en lenguaje humano.';
}

function missionResultText(mission: any): string {
  const results = mission?.checkpoint?.results && typeof mission.checkpoint.results === 'object' ? mission.checkpoint.results : {};
  const preferredKeys = ['summary_1', 'crosscheck_1', 'facts_1'];
  for (const key of preferredKeys) {
    const value = results[key];
    const found = [value?.response?.content, value?.response?.text, value?.stdout, value?.output, value?.message, value?.result?.response?.content]
      .find((v: any) => typeof v === 'string' && v.trim());
    if (found) return humanizeStructuredMissionResult(found, mission);
    if (value && typeof value === 'object' && Object.keys(value).length) {
      const human = humanizeStructuredMissionResult(value, mission);
      if (human) return human;
    }
  }
  const structured: string[] = [];
  for (const value of Object.values(results) as any[]) {
    const found = [value?.response?.content, value?.response?.text, value?.stdout, value?.output, value?.message, value?.result?.response?.content]
      .find((v: any) => typeof v === 'string' && v.trim());
    if (found) structured.push(humanizeStructuredMissionResult(found, mission));
    else if (value && typeof value === 'object' && Object.keys(value).length) {
      const human = humanizeStructuredMissionResult(value, mission);
      if (human) structured.push(human);
    }
  }
  if (structured.length) return structured[structured.length - 1];

  const direct = [mission?.last_stdout, mission?.last_stderr]
    .map((v: any) => typeof v === 'string' ? v.trim() : '')
    .filter(Boolean)
    .filter((v: string) => !/^(retry[_-]?exhausted|retryexhaustedreplanned|executor_error|verification_failed|device_enqueue_\d+|human_gate_required)$/i.test(v));
  if (direct.length) return humanizeStructuredMissionResult(direct[direct.length - 1], mission);

  const internal = String(mission?.last_stderr || mission?.next_action || '').trim().toLowerCase();
  const human: Record<string,string> = {
    retryexhaustedreplanned: 'ARIA tuvo que descartar una estrategia que agotó sus reintentos, generó una alternativa y continuó con ella. El detalle verificable de la misión aparece en su respuesta y evidencia.',
    retry_exhausted_replanned: 'ARIA tuvo que descartar una estrategia que agotó sus reintentos, generó una alternativa y continuó con ella. El detalle verificable de la misión aparece en su respuesta y evidencia.',
    retry_exhausted_all_strategies: 'ARIA agotó las estrategias gobernadas disponibles para esta misión y necesita una nueva intervención antes de continuar.',
    executor_error: 'Uno de los ejecutores de ARIA no pudo completar su paso. La misión conserva la evidencia para diagnosticarlo.',
    verification_failed: 'La comprobación del resultado no fue válida. La misión conserva la evidencia necesaria para corregir el problema.'
  };
  return human[internal] || '';
}

function missionObjectivePresentation(mission: any, result: string) {
  const text = String(result || '').toLowerCase();
  const goal = String(mission?.goal || '').toLowerCase();
  if (/(diagnostica|diagnóstico|diagnostico|causa raíz|causa raiz|computer\.use\.autonomous|windows device)/.test(goal) &&
      /(no demostró|objetivo no demostrado|no obtuvo el diagnóstico|no quedó determinado|no contiene.*objetivo)/.test(text)) {
    return {
      verified: false,
      label: 'Objetivo no demostrado',
      note: 'Los pasos de ejecución terminaron, pero la evidencia no demuestra que se haya resuelto el objetivo de la misión.'
    };
  }
  return {
    verified: true,
    label: 'Objetivo con evidencia disponible',
    note: 'La respuesta contiene evidencia utilizable; la verificación final depende de las reglas persistidas de la misión.'
  };
}

function humanOperation(operation: any, executorType: any): string {
  const op = String(operation || '').trim().toLowerCase();
  const ex = String(executorType || '').trim().toLowerCase();
  const map: Record<string, string> = {
    'text_generation': 'analizar la información y generar una respuesta',
    'shell.execute': 'ejecutar una instrucción controlada en Windows',
    'file.read': 'leer información de un archivo',
    'file.write': 'escribir información controlada en un archivo',
    'file_read': 'leer información de un archivo',
    'file_write': 'escribir información controlada en un archivo',
    'database.query': 'consultar información de la base de datos',
    'database.write': 'actualizar información de la base de datos',
    'cloud.deploy': 'desplegar cambios en la nube',
    'github.create_branch': 'preparar una rama de trabajo',
    'create_branch': 'preparar una rama de trabajo',
    'computer.use.autonomous': 'observar la interfaz, ejecutar una acción segura y comprobar el resultado',
    'computer.use': 'observar la interfaz y ejecutar una acción controlada',
  };
  if (map[op]) return map[op];
  if (ex === 'model') return 'analizar la misión con el motor de IA';
  if (ex === 'device') return 'realizar una acción controlada en el dispositivo';
  if (ex === 'connector') return 'usar un servicio conectado';
  return humanizeTechnicalText(operation || executorType || 'ejecutar un paso gobernado');
}

function humanExecutorLabel(executorType: any): string {
  const ex = String(executorType || '').trim().toLowerCase();
  if (ex === 'device') return 'Dispositivo físico';
  if (ex === 'connector') return 'Servicio conectado';
  if (ex === 'model') return 'Motor de IA';
  if (ex === 'agent') return 'Agente especializado';
  return ex ? humanizeTechnicalText(ex) : 'Ejecutor aún no identificado';
}

function humanizeTechnicalText(value: any): string {
  let text = String(value ?? '').trim();
  if (!text) return '';
  const replacements: Array<[string, string]> = [
    ['computer.use.autonomous', 'control autónomo del dispositivo'],
    ['computer.use', 'control del dispositivo'],
    ['file_write', 'escritura de archivo'],
    ['file_read', 'lectura de archivo'],
    ['file.write', 'escritura de archivo'],
    ['file.read', 'lectura de archivo'],
    ['create_branch', 'preparación de rama de trabajo'],
    ['github_create_branch', 'preparación de rama de trabajo'],
    ['executor_error', 'error del ejecutor'],
    ['retry_exhausted_replanned', 'reintentos agotados y estrategia replanteada'],
    ['retry_exhausted', 'reintentos agotados'],
    ['replan_required', 'replanteamiento requerido'],
    ['connector', 'servicio conectado'],
    ['executor', 'ejecutor'],
    ['runner', 'motor de misiones'],
    ['pending', 'pendiente'],
    ['running', 'ejecutándose'],
    ['succeeded', 'completado'],
    ['failed', 'fallido'],
    ['blocked', 'bloqueado'],
    ['identical_replan_strategy_blocked', 'la recuperación detectó una estrategia idéntica y la bloqueó'],
  ];
  for (const [from, to] of replacements) text = text.replaceAll(from, to);
  return text;
}

function humanStepTitle(step: any, fallbackIndex = 1): string {
  const raw = String(step?.title ?? step?.operation ?? '').trim();
  const op = String(step?.operation ?? '').trim().toLowerCase();
  if (op) return humanOperation(op, step?.executor_type);
  if (!raw) return 'Paso ' + fallbackIndex + ' de la misión';
  return humanizeTechnicalText(raw);
}

function executionPlanForMission(mission: any): string[] {
  const steps = Array.isArray(mission?.steps) && mission.steps.length
    ? mission.steps
    : Array.isArray(mission?.checkpoint?.plan) ? mission.checkpoint.plan : [];
  if (steps.length) {
    return steps.map((step: any, index: number) => {
      const id = String(step?.id || '').toLowerCase();
      const specialized: Record<string,string> = {
        'all_for_one_scope_1': 'Definir la cobertura forense y la evidencia que debe obtenerse.',
        'all_for_one_architecture_runtime': 'Auditar arquitectura y runtime.',
        'all_for_one_data_memory_learning': 'Auditar datos, memoria y aprendizaje.',
        'all_for_one_planning_reasoning': 'Auditar planificación y razonamiento.',
        'all_for_one_execution_verification': 'Auditar ejecución, verificación y cierre.',
        'all_for_one_models_routing': 'Auditar modelos, capacidades y routing.',
        'all_for_one_agents_devices_tools': 'Auditar agentes, dispositivos y herramientas conectadas.',
        'all_for_one_security_recovery': 'Auditar seguridad, recuperación y resiliencia.',
        'all_for_one_productivity_ux': 'Auditar velocidad, productividad y experiencia de uso.',
        'all_for_one_arbiter_10': 'Integrar los hallazgos y construir el plan de mejora priorizado.',
      };
      return specialized[id] || humanStepTitle(step, index + 1);
    });
  }
  const goal = String(mission?.goal ?? '').toLowerCase();
  if (/all\s*for\s*one|todos?\s+para\s+uno/.test(goal)) {
    return [
      'Definir la cobertura forense y la evidencia que debe obtenerse.',
      'Auditar arquitectura, ejecución y capacidades de ARIA.',
      'Contrastar hallazgos con modelos y agentes especializados.',
      'Integrar contradicciones, causas raíz y mejoras verificables.'
    ];
  }
  return [
    'Interpretar el objetivo de la misión.',
    'Preparar el plan y los recursos necesarios.',
    'Seleccionar la mejor ruta y el ejecutor disponible.',
    'Ejecutar el siguiente paso de forma controlada.',
    'Comprobar el resultado antes de avanzar.',
    'Guardar evidencia real de lo ocurrido.',
    'Cerrar la misión con un resultado humano en español.'
  ];
}

function executionPlanState(index: number, mission: any, events: any[]): 'done' | 'current' | 'pending' {
  const steps = Array.isArray(mission?.steps) && mission.steps.length
    ? mission.steps
    : Array.isArray(mission?.checkpoint?.plan) ? mission.checkpoint.plan : [];
  if (steps.length) {
    const step = steps[index];
    const stepStatus = String(step?.status || '').toLowerCase();
    if (['succeeded', 'skipped', 'completed'].includes(stepStatus)) return 'done';
    if (['running', 'failed', 'blocked', 'waiting'].includes(stepStatus)) return 'current';
    if (Number(mission?.current_step ?? -1) === index || Number(step?.index ?? -1) === index + 1) return 'current';
    const current = Number(mission?.current_step ?? -1);
    if (current === index) return 'current';
    return 'pending';
  }

  const types = new Set((events ?? []).map((e: any) => String(e?.event_type ?? '').toLowerCase()));
  if (index === 0 && (types.has('cognitive_recall_completed') || types.has('cognitive_planning_context_used'))) return 'done';
  if (index === 1 && types.has('step_batch_started')) return 'done';
  if (index === 2 && String(mission?.status ?? '').toLowerCase() === 'succeeded') return 'done';
  const current = Number(mission?.current_step ?? 0);
  if (index === current) return 'current';
  return 'pending';
}

function directActionText(step: any, latest: any): string {
  const op = String(step?.operation ?? latest?.payload?.operation ?? '').trim().toLowerCase();
  const resource = executionResource(latest, step);
  if (op.includes('file.read') || op === 'file_read') return resource ? 'Estoy leyendo ' + resource + ' para encontrar la información que necesitamos.' : 'Estoy leyendo los archivos necesarios para encontrar la causa.';
  if (op.includes('file.write') || op === 'file_write') return resource ? 'Estoy registrando cambios en ' + resource + ' para preparar la comprobación.' : 'Estoy registrando la información necesaria para la comprobación.';
  if (op.includes('create_branch') || op.includes('github.create_branch')) return 'Estoy preparando una rama de trabajo para aislar el diagnóstico sin mezclar cambios.';
  if (op === 'shell.execute') return 'Estoy ejecutando una instrucción controlada en Windows y revisaré su respuesta.';
  if (op.includes('computer.use')) return 'Estoy observando la interfaz, eligiendo la siguiente acción segura y comprobando el resultado.';
  if (op === 'database.query') return 'Estoy consultando los datos necesarios para comprobar el estado real.';
  if (op === 'database.write') return 'Estoy actualizando información controlada y después comprobaré que quedó correctamente guardada.';
  if (op === 'text_generation') return 'Estoy analizando el contexto y preparando la respuesta de este paso.';
  const fallback = humanOperation(op, step?.executor_type);
  return fallback ? 'Estoy ' + (fallback.startsWith('analizar') ? fallback : fallback.replace(/^realizar /, 'realizando ')) + '.' : 'Estoy ejecutando el paso actual y comprobaré el resultado antes de continuar.';
}

function missionHumanSummary(mission: any) {
  const steps = Array.isArray(mission?.steps) ? mission.steps : (Array.isArray(mission?.checkpoint?.plan) ? mission.checkpoint.plan : []);
  const completed = steps.filter((step: any) => ['succeeded', 'skipped'].includes(String(step?.status)));
  const operations = completed.map((step: any) => humanOperation(step?.operation, step?.executor_type));
  const uniqueOperations = Array.from(new Set(operations));
  const readOnly = steps.length > 0 && steps.every((step: any) => String(step?.risk || '').toUpperCase() === 'READ' && !/(write|create|update|delete|deploy)/i.test(String(step?.operation || '')));
  const result = missionResultText(mission);
  const objective = missionObjectivePresentation(mission, result);
  const hasMemoryRecall = Boolean(mission?.checkpoint?.cognitive_loop?.recalled_before_planning);
  const what = completed.length
    ? 'ARIA verificó ' + completed.length + ' paso' + (completed.length === 1 ? '' : 's') + ', pero ' + (objective.verified ? 'la respuesta disponible contiene evidencia utilizable del objetivo.' : 'la evidencia no demuestra todavía el objetivo de la misión.')
    : 'ARIA todavía no tiene pasos completados para resumir.';
  const how = [hasMemoryRecall ? 'Primero recuperó contexto de su memoria autorizada.' : '', uniqueOperations.length ? 'Después realizó: ' + uniqueOperations.join(', ') + '.' : '', 'Al terminar, comprobó el resultado según las reglas de verificación de la misión.'].filter(Boolean).join(' ');
  const changed = readOnly ? 'No realizó cambios en ARIA ni en sistemas externos; esta misión fue de lectura/análisis.' : 'La misión incluyó operaciones con capacidad de modificar información. Los cambios concretos deben describirse a partir del resultado real de cada paso, nunca suponerse.';
  const improvement = readOnly ? 'No se modificó el sistema. El valor de esta misión es la información o respuesta obtenida y verificada.' : 'La mejora esperada es la definida por el objetivo de la misión y solo se considera realizada cuando el resultado la demuestra.';
  const expected = result
    ? (objective.verified ? 'Resultado obtenido:' : 'Resultado de pasos obtenido, pero objetivo no demostrado:')
    : 'Resultado esperado: la misión debía producir un resultado verificable para el objetivo indicado.';
  return { what, how, changed, improvement, expected, result, objective };
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
  const traceId = (init.headers && new Headers(init.headers).get('x-aria-trace-id')) || crypto.randomUUID();
  const requestId = (init.headers && new Headers(init.headers).get('x-aria-request-id')) || crypto.randomUUID();

  for (let attempt = 0; attempt < attempts; attempt++) {
    const headers = new Headers(init.headers);
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
  if (!response.ok) {
    const error = new Error(d.error_description || d.msg || d.error || 'No se pudo iniciar sesión.');
    (error as any).retryable = response.status >= 500 && response.status <= 599;
    (error as any).status = response.status;
    throw error;
  }
  if (!d.access_token || !d.user?.id) {
    throw new Error('No se pudo iniciar sesión.');
  }
  return d;
}

function isRetryableAuthError(error: unknown) {
  return Boolean((error as any)?.retryable)
    || (error instanceof DOMException && error.name === 'AbortError')
    || error instanceof TypeError;
}

async function signInDirect(email: string, password: string) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
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
  const timer = window.setTimeout(() => controller.abort(), 20000);
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
  const timer = window.setTimeout(() => controller.abort(), 15000);
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
  const timer = window.setTimeout(() => controller.abort(), 65000);
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
  let proxyError: unknown = null;
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
    proxyError = error;
    const retryable = isRetryableAuthError(error);
    if (!retryable) throw error;
  }
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
    if ((error instanceof DOMException && error.name === 'AbortError') || error instanceof TypeError) {
      throw new Error('ARIA no pudo renovar la sesión por ninguna de sus rutas.');
    }
    if (error instanceof Error && error.message) throw error;
    throw proxyError instanceof Error ? proxyError : new Error('No se pudo renovar la sesión.');
  }
}
async function signIn(email: string, password: string) {
  let proxyError: unknown = null;
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
  } catch (error) {
    proxyError = error;
    if (!isRetryableAuthError(error)) throw error;
  }

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
  } catch (directError) {
    if (isRetryableAuthError(directError)) {
      throw new Error('ARIA no pudo alcanzar el servicio de autenticación por ninguna de sus rutas. La red o el servicio de autenticación está tardando demasiado.');
    }
    if (directError instanceof Error && directError.message) throw directError;
    throw proxyError instanceof Error ? proxyError : new Error('No se pudo iniciar sesión.');
  }
}
function activeMissionRank(status: any, leaseOwner?: any, leaseUntil?: any): number {
  const value = String(status ?? '').toLowerCase();
  const leased = Boolean(leaseOwner && leaseUntil && new Date(String(leaseUntil)).getTime() > Date.now());
  if (value === 'running' && leased) return 60;
  if (value === 'waiting' && leased) return 45;
  // Sin lease vigente, running/waiting no se consideran ejecución LIVE.
  if (value === 'planning') return 30;
  if (value === 'queued') return 20;
  if (value === 'paused') return 10;
  if (value === 'succeeded') return 5;
  if (value === 'failed' || value === 'blocked' || value === 'cancelled') return 4;
  return 0;
}

function selectLiveMission(overview: any): any | null {
  const candidates=[...(Array.isArray(overview?.missions)?overview.missions:[]),overview?.active_mission].filter(Boolean);
  const unique=Array.from(new Map(candidates.map((m:any)=>[String(m.mission_id),m])).values());
  return unique
    .filter((m:any)=>activeMissionRank(m.status,m.lease_owner,m.lease_until)>=45)
    .sort((a:any,b:any)=>activeMissionRank(b.status,b.lease_owner,b.lease_until)-activeMissionRank(a.status,a.lease_owner,a.lease_until)||new Date(String(b.updated_at||0)).getTime()-new Date(String(a.updated_at||0)).getTime())[0]??null;
}
function selectForegroundMission(overview: any): any | null {
  const candidates=[...(Array.isArray(overview?.missions)?overview.missions:[]),overview?.foreground_mission,overview?.active_mission].filter(Boolean);
  const unique=Array.from(new Map(candidates.map((m:any)=>[String(m.mission_id),m])).values());
  return unique
    .filter((m:any)=>String(m?.metadata?.goal_source??'').toLowerCase()==='user')
    .sort((a:any,b:any)=>new Date(String(b.updated_at||0)).getTime()-new Date(String(a.updated_at||0)).getTime())[0]??null;
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
      try { await loadRef.current(); } catch {} finally { running = false; }
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

function OperationalHealthPanel({ health }: { health: any }) {
  if(!health)return null;
  const status=String(health.status||'unknown').toLowerCase(), summary=health.summary||{}, dependencies=health.dependencies||{};
  const coreHealthy=dependencies.device_transport?.status==='healthy'&&dependencies.model_runtime?.status==='healthy'&&dependencies.job_queue?.status==='healthy';
  const headline=coreHealthy?'Núcleo operativo activo':status==='unavailable'?'Diagnóstico no disponible':'Hay una incidencia operativa que revisar';
  const detail=coreHealthy&&Number(summary.blocked_missions||0)>0
    ?'Los servicios necesarios para ejecutar están disponibles. Las misiones bloqueadas quedan como trabajo pendiente; no significan que esta ejecución esté fallando.'
    :coreHealthy?'Transporte, modelos y cola disponibles.':'ARIA conserva el diagnóstico y muestra la dependencia que necesita atención.';
  return <details className='panel operationalHealthCompact'><summary><span>ESTADO OPERATIVO</span><b>{coreHealthy?'ACTIVO':status==='unavailable'?'SIN DIAGNÓSTICO':'REVISAR'}</b></summary><div className='operationalHealthSummary'><strong>{headline}</strong><p>{detail}</p><small>{summary.devices_online??0}/{summary.devices_total??0} dispositivos · {summary.models_available??0}/{summary.models_total??0} modelos disponibles · {summary.queued_jobs??0} jobs en cola</small></div>{!coreHealthy&&Array.isArray(health.next_actions)&&health.next_actions.length>0&&<div className='operationalHealthActions'>{health.next_actions.slice(0,3).map((action:string,i:number)=><span key={i}>{action}</span>)}</div>}</details>;
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


function AbsorbCenter({ userId, token }: { userId: string; token: string }) {
  const [records, setRecords] = useState<AbsorptionRecord[]>([]);
  const [sourceUrl, setSourceUrl] = useState('https://github.com/affaan-m/ECC');
  const [ref, setRef] = useState('v2.2.3');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  async function load(attempt = 1) {
    try {
      const d: any = await api('/absorb', token);
      const rows = Array.isArray(d?.absorptions) ? d.absorptions : [];
      setRecords(rows);
      setSelected((current) => current && rows.some((x:any) => x.absorption_id === current) ? current : (rows[0]?.absorption_id ?? null));
    } catch {
      if (attempt < 4) {
        window.setTimeout(() => { void load(attempt + 1); }, attempt * 2500);
      }
    }
  }

  useEffect(() => { void load(); }, [token]);

  async function inspect() {
    setBusy(true);
    setMessage('Inspeccionando fuente sin ejecutar código externo…');