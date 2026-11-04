'use strict';

// This independent coordinator must remain frozen until an explicit reviewed change.
export const MISSION_EXECUTION_PAUSED = true;

// Supabase-independent Cloudflare Worker coordinator.
// Durable Object storage is the single source of truth; Windows workers connect outbound only.
const ALLOWED_OPERATIONS = new Set([
  'workspace.list', 'workspace.read', 'workspace.search', 'workspace.write',
  'workspace.edit', 'tests.run', 'git.status', 'git.diff'
]);
const RISK_BY_OPERATION = Object.freeze({
  'workspace.list': 'low',
  'workspace.read': 'low',
  'workspace.search': 'low',
  'tests.run': 'low',
  'git.status': 'low',
  'git.diff': 'low',
  'workspace.write': 'medium',
  'workspace.edit': 'medium'
});
const ACTIVE_JOB_STATES = new Set(['queued', 'leased']);
const ACTIVE_MISSION_STATES = new Set(['planning', 'queued', 'running']);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const EVIDENCE_FIELDS = Object.freeze({
  'workspace.list': new Set(['operation', 'path', 'entries', 'count', 'truncated']),
  'workspace.read': new Set(['operation', 'path', 'content', 'truncated', 'bytes']),
  'workspace.search': new Set(['operation', 'query', 'matches', 'count', 'scanned_files', 'truncated']),
  'workspace.write': new Set(['operation', 'path', 'backup', 'bytes_written', 'sha256', 'relative_path', 'bytes', 'execution_attempt', 'write_action']),
  'workspace.edit': new Set(['operation', 'path', 'backup', 'bytes_written', 'sha256', 'already_applied']),
  'tests.run': new Set(['operation', 'test_file', 'exit_code', 'stdout', 'stderr']),
  'git.status': new Set(['operation', 'output']),
  'git.diff': new Set(['operation', 'output'])
});
const hasTaskEvidence = task => {
  const allowedFields = EVIDENCE_FIELDS[task && task.operation];
  if (!allowedFields || !Array.isArray(task.evidence)) return false;
  return task.evidence.some(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length === 0 ||
        Object.keys(item).some(key => !allowedFields.has(key))) return false;
    if (task.operation !== 'workspace.write' && item.operation !== task.operation) return false;
    if (task.operation === 'workspace.write' && item.operation !== task.operation && item.operation !== undefined) return false;
    const validPath = value => typeof value === 'string' && value.trim().length > 0 &&
      !/^(?:placeholder|todo|unknown|n\/a|passed_without_detail)$/i.test(value.trim());
    if (task.operation === 'workspace.list') return validPath(item.path) && Array.isArray(item.entries) &&
      Number.isSafeInteger(item.count) && item.count >= item.entries.length && item.count <= 1000 &&
      item.entries.every(entry => entry && validPath(entry.path) && ['file', 'directory'].includes(entry.type)) && typeof item.truncated === 'boolean';
    if (task.operation === 'workspace.read') return validPath(item.path) && typeof item.content === 'string' &&
      Number.isSafeInteger(item.bytes) && item.bytes >= 0 && typeof item.truncated === 'boolean' &&
      (item.truncated || item.content.length <= item.bytes);
    if (task.operation === 'workspace.search') return typeof item.query === 'string' && item.query.trim().length >= 2 &&
      Array.isArray(item.matches) && item.matches.every(match => match && validPath(match.path) && Number.isSafeInteger(match.line) &&
        match.line > 0 && typeof match.text === 'string') && Number.isSafeInteger(item.count) && item.count === item.matches.length &&
      Number.isSafeInteger(item.scanned_files) && item.scanned_files >= 0 && item.scanned_files <= 250 && typeof item.truncated === 'boolean';
    if (task.operation === 'workspace.write' || task.operation === 'workspace.edit') {
      const standardFileEvidence = validPath(item.path) && /^[a-f0-9]{64}$/i.test(String(item.sha256 || '')) &&
        (item.bytes_written === undefined || (Number.isSafeInteger(item.bytes_written) && item.bytes_written >= 0)) &&
        (item.backup === undefined || item.backup === null || typeof item.backup === 'string') &&
        (item.already_applied === undefined || item.already_applied === true);
      const package3WriteEvidence = task.operation === 'workspace.write' && validPath(item.relative_path) &&
        Number.isSafeInteger(item.bytes) && item.bytes > 0 && /^[a-f0-9]{64}$/i.test(String(item.sha256 || '')) &&
        ['created', 'updated', 'already_identical'].includes(item.write_action) &&
        Number.isSafeInteger(item.execution_attempt) && item.execution_attempt > 0 && item.operation === undefined;
      if (item.operation !== task.operation && !package3WriteEvidence) return false;
      return (item.operation === task.operation && standardFileEvidence) || package3WriteEvidence;
    }
    if (item.operation !== task.operation) return false;
    if (task.operation === 'tests.run') return validPath(item.test_file) && Number.isSafeInteger(item.exit_code) && item.exit_code === 0 &&
      typeof item.stdout === 'string' && typeof item.stderr === 'string';
    if (task.operation === 'git.status' || task.operation === 'git.diff') return typeof item.output === 'string';
    return false;
  });
};
function classifyTaskFailure(reason) {
  const value = String(reason || '').toLowerCase();
  if (/capacity|quota|rate.?limit|\b429\b|overload|resource_exhausted/.test(value)) {
    return { category: 'capacity', error_code: 'provider_capacity', retryable: true };
  }
  if (/timeout|temporar|network|econn|\b408\b|\b502\b|\b503\b|\b504\b|unavailable/.test(value)) {
    return { category: 'transient', error_code: 'transient_network_or_timeout', retryable: true };
  }
  if (/unauthori[sz]ed|forbidden|invalid.?credential|configuration/.test(value)) {
    return { category: 'configuration', error_code: 'provider_or_auth_configuration', retryable: false };
  }
  return { category: 'permanent', error_code: 'execution_failed', retryable: false };
}
function safeDiagnosticLabel(value) {
  const label = String(value || '').trim().replace(/[^a-zA-Z0-9_.:/-]/g, '_').slice(0, 80);
  return label || null;
}
const nowIso = () => new Date().toISOString();
const uuid = prefix => prefix + '_' + crypto.randomUUID();
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});
const error = (message, status = 400) => json({ error: message }, status);

const PACKAGE3_PROBE_TTL_MS = 10 * 60 * 1000;
const READONLY_PILOT_TTL_MS = 5 * 60 * 1000;
const PACKAGE3_PROBE_LEASE_MS = 8000;
const PACKAGE3_PROBE_ALLOWED_JOB_OPERATIONS = new Set(['task.execute', 'mission.verify']);
const PACKAGE3_PROBE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,70}$/;
const MISSION_WONDER_2_A3_PRESENCE_TTL_MIN_MS = 60000;
const MISSION_WONDER_2_A3_PRESENCE_TTL_MAX_MS = 180000;
const MISSION_WONDER_2_A3_PRESENCE_ID_PATTERN = /^mw2-a3-[a-z0-9][a-z0-9-]{7,60}$/;
const MISSION_CONTROL_URL = 'https://aria-autonomy-coordinator.robvg9.workers.dev/';

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function semanticNotificationKey(event) {
  const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
  const type = normalize(event && event.type) || 'aria_event';
  const missionId = normalize(event && event.mission_id);
  const taskId = normalize(event && event.task_id);
  const approvalId = normalize(event && event.approval_id);
  const transition = normalize(event && (event.transition_id || event.transition || event.status));
  const reason = transition ? '' : normalize(event && (event.fingerprint || event.error_code || event.reason || (!missionId ? event.details : '')));
  return JSON.stringify([type, missionId, taskId, approvalId, reason, transition]);
}
function constantTimeTextEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ''));
  const b = new TextEncoder().encode(String(right || ''));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
function package3ProbeWorkerIdAllowed(scope, workerId) {
  const prefix = String(scope && scope.worker_id_prefix || '');
  if (!prefix) return false;
  if (scope.probe_type === 'readonly_git_status') return workerId === prefix + 'before';
  return workerId === prefix + 'before' || workerId === prefix + 'after';
}
function package3ProbeJobAllowed(scope, job) {
  if (!scope || !job || job.mission_id !== scope.mission_id ||
      !PACKAGE3_PROBE_ALLOWED_JOB_OPERATIONS.has(String(job.operation)) ||
      !Array.isArray(scope.allowed_job_ids) || !scope.allowed_job_ids.includes(job.job_id)) return false;
  if (job.operation === 'task.execute') {
    const requiredOperation = scope.probe_type === 'readonly_git_status' ? 'git.status' : 'workspace.write';
    return job.task && job.task.operation === requiredOperation;
  }
  return job.operation === 'mission.verify';
}

function authorized(request, token) {
  if (typeof token !== 'string' || token.length < 32) return false;
  return request.headers.get('authorization') === 'Bearer ' + token;
}
function parseRisk(value) {
  return ['low', 'medium', 'high', 'critical'].includes(value) ? value : 'low';
}
function progressOf(mission) {
  if (mission.status === 'succeeded') return 100;
  const tasks = Array.isArray(mission.tasks) ? mission.tasks : [];
  if (!tasks.length) return 0;
  return Math.min(99, Math.round(tasks.filter(task => task.status === 'succeeded').length / tasks.length * 100));
}
function normalizeTasks(rawTasks, priorIds = new Set()) {
  if (!Array.isArray(rawTasks) || rawTasks.length < 1 || rawTasks.length > 6) throw new Error('plan_task_count_invalid');
  const ids = new Set(priorIds);
  const availableIds = new Set();
  const tasks = [];
  for (const raw of rawTasks) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('plan_task_invalid');
    const taskId = String(raw.task_id || '');
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(taskId) || ids.has(taskId)) throw new Error('plan_task_id_invalid');
    const operation = String(raw.operation || '');
    if (!ALLOWED_OPERATIONS.has(operation)) throw new Error('plan_operation_rejected');
    const depends = Array.isArray(raw.depends_on) ? raw.depends_on.map(String) : [];
    if (depends.some(dep => !availableIds.has(dep) && !ids.has(dep))) throw new Error('plan_dependency_invalid');
    const payload = raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload) ? raw.payload : {};
    if (JSON.stringify(payload).length > 512 * 1024) throw new Error('plan_payload_too_large');
    const policyRisk = RISK_BY_OPERATION[operation];
    ids.add(taskId);
    availableIds.add(taskId);
    tasks.push({
      task_id: taskId,
      replaces_task_id: raw.replaces_task_id == null ? null : String(raw.replaces_task_id).slice(0, 100),
      title: String(raw.title || operation).slice(0, 200),
      description: String(raw.description || '').slice(0, 2000),
      operation,
      payload: clone(payload),
      depends_on: depends,
      risk: policyRisk,
      irreversible: raw.irreversible === true,
      approved: false,
      idempotent: raw.idempotent !== false,
      max_attempts: Math.max(1, Math.min(3, Number(raw.max_attempts) || 2)),
      attempts: 0,
      status: 'pending',
      evidence: [],
      last_error: null
    });
  }
  return tasks;
}

export class AriaMissionStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.lock = Promise.resolve();
    this.notificationLock = Promise.resolve();
    this.alarmMs = Math.max(5000, Number(env.ARIA_ALARM_INTERVAL_MS) || 15000);
    this.package3ProbeContext = null;
  }

  isMissionExecutionPaused() {
    return MISSION_EXECUTION_PAUSED;
  }

  assertMissionExecutionEnabled() {
    if (this.isMissionExecutionPaused() && !this.package3ProbeContext) {
      throw new Error('mission_execution_paused');
    }
  }

  pausedResponse() {
    return error('mission_execution_paused', 423);
  }

  async exclusive(fn, options = {}) {
    const requestedProbeId = String(options.probeScope && options.probeScope.probe_id || '');
    if (this.isMissionExecutionPaused() && options.allowFrozen !== true && !requestedProbeId) {
      return this.pausedResponse();
    }
    const previous = this.lock;
    let release;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    const previousProbeContext = this.package3ProbeContext;
    try {
      if (requestedProbeId) {
        const currentScope = await this.ctx.storage.get('package3:probe:' + requestedProbeId);
        if (!currentScope || currentScope.status !== 'active' ||
            Date.parse(currentScope.expires_at) <= Date.now() ||
            currentScope.mission_id !== options.probeScope.mission_id) {
          return this.pausedResponse();
        }
        this.package3ProbeContext = currentScope;
      }
      return await fn();
    } finally {
      this.package3ProbeContext = previousProbeContext;
      release();
    }
  }
  async exclusiveNotification(fn) {
    const result = this.notificationLock.then(fn, fn);
    this.notificationLock = result.then(() => undefined, () => undefined);
    return result;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const controlToken = this.env.ARIA_CONTROL_TOKEN;
    const workerToken = this.env.ARIA_WORKER_TOKEN;
    if (typeof controlToken === 'string' && controlToken.length > 0 && controlToken === workerToken) {
      return error('auth_configuration_invalid', 503);
    }
    if (method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'aria-autonomy-coordinator', storage: 'durable-object', supabase_independent: true, time: nowIso() });
    }

    const presenceRoute = url.pathname === '/api/worker/presence';
    const workerRoute = url.pathname === '/api/worker/claim' || presenceRoute || /^\/api\/worker\/jobs\/[^/]+\/(heartbeat|complete|fail)$/.test(url.pathname);
    if (workerRoute) {
      if (!authorized(request, this.env.ARIA_WORKER_TOKEN)) return error('unauthorized_worker', 401);
      if (this.isMissionExecutionPaused()) {
        if (method !== 'POST') return this.pausedResponse();
        // Preserve the legacy fail-fast contract: normal claims are rejected
        // before parsing their bodies. Only the complete scoped-probe header set
        // proceeds to body parsing and the narrow worker allowlist.
        if (presenceRoute && request.headers.get('x-aria-mw2-a3-probe-id')) {
          const workerIdHint = String(request.headers.get('x-aria-mw2-a3-worker-id') || '');
          const a3Scope = await this.resolveMissionWonder2A3PresenceScope(request, workerIdHint);
          if (!a3Scope) return this.pausedResponse();
          const a3ScopeToken = String(request.headers.get('x-aria-mw2-a3-scope-token') || '');
          return this.exclusive(async () => {
            let body;
            try { body = await request.clone().json(); } catch (_) { return error('invalid_json', 400); }
            if (String(body && body.worker_id || '') !== workerIdHint || body.state !== 'idle') {
              return error('mission_wonder_2_a3_presence_identity_or_state_invalid', 403);
            }
            return this.recordMissionWonder2A3Presence(a3Scope, body, a3ScopeToken);
          }, { allowFrozen: true });
        }
        const workerIdHint = String(request.headers.get('x-aria-package3-worker-id') || '');
        const probeIdHint = String(request.headers.get('x-aria-package3-probe-id') || '');
        const scopeTokenHint = String(request.headers.get('x-aria-package3-scope-token') || '');
        if (!workerIdHint || !probeIdHint || !scopeTokenHint) return this.pausedResponse();
        const match = url.pathname.match(/^\/api\/worker\/jobs\/([^/]+)\/(heartbeat|complete|fail)$/);
        const jobId = match ? decodeURIComponent(match[1]) : null;
        const scope = await this.resolvePackage3ProbeWorkerScope(
          request,
          { worker_id: workerIdHint },
          jobId
        );
        if (!scope) return this.pausedResponse();
        return this.exclusive(async () => {
          let body;
          try { body = await request.clone().json(); } catch (_) { return error('invalid_json', 400); }
          if (String(body && body.worker_id || '') !== workerIdHint) {
            return error('package3_probe_worker_identity_mismatch', 403);
          }
          if (url.pathname === '/api/worker/claim') return this.claim(request);
          if (presenceRoute) return this.presence(request);
          if (!match) return error('method_not_allowed', 405);
          if (match[2] === 'heartbeat') return this.heartbeat(jobId, request);
          if (match[2] === 'complete') return this.complete(jobId, request);
          return this.fail(jobId, request);
        }, { probeScope: scope });
      }
      if (method === 'POST' && url.pathname === '/api/worker/claim') return this.exclusive(() => this.claim(request));
      const match = url.pathname.match(/^\/api\/worker\/jobs\/([^/]+)\/(heartbeat|complete|fail)$/);
      if (method !== 'POST' || !match) return error('method_not_allowed', 405);
      const jobId = decodeURIComponent(match[1]);
      if (match[2] === 'heartbeat') return this.exclusive(() => this.heartbeat(jobId, request));
      if (match[2] === 'complete') return this.exclusive(() => this.complete(jobId, request));
      return this.exclusive(() => this.fail(jobId, request));
    }

    if (!url.pathname.startsWith('/api/')) return error('not_found', 404);
    const producerPlanMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/plan$/);
    if (method === 'POST' && producerPlanMatch) {
      if (!authorized(request, this.env.ARIA_PLAN_PRODUCER_TOKEN)) return error('unauthorized_plan_producer', 401);
      return this.exclusive(() => this.submitPlan(decodeURIComponent(producerPlanMatch[1]), request));
    }
    if (!authorized(request, this.env.ARIA_CONTROL_TOKEN)) return error('unauthorized', 401);
    // Mission Wonder 2 A3 presence-only probe. No mission, queue, lease or task may be created.
    if (method === 'POST' && url.pathname === '/api/mission-wonder-2/a3/presence-probes/start') {
      if (!this.isMissionExecutionPaused()) return error('mission_wonder_2_a3_presence_probe_requires_global_freeze', 409);
      return this.exclusive(() => this.startMissionWonder2A3PresenceProbe(request), { allowFrozen: true });
    }
    if (method === 'POST' && url.pathname === '/api/mission-wonder-2/a3/presence-probes/close') {
      return this.exclusive(() => this.closeMissionWonder2A3PresenceProbe(request), { allowFrozen: true });
    }
    const a3PresenceReadbackMatch = url.pathname.match(/^\/api\/mission-wonder-2\/a3\/presence-probes\/([a-z0-9-]{8,71})$/);
    if (method === 'GET' && a3PresenceReadbackMatch) {
      return this.missionWonder2A3PresenceProbeReadback(decodeURIComponent(a3PresenceReadbackMatch[1]));
    }
    // A single exact-scope Package 3 probe may run while every general mutation stays frozen.
    if (method === 'POST' && url.pathname === '/api/package3/probe/start') {
      if (!this.isMissionExecutionPaused()) return error('package3_probe_requires_global_freeze', 409);
      return this.exclusive(() => this.startPackage3Probe(request), { allowFrozen: true });
    }
    if (method === 'POST' && url.pathname === '/api/package3/probe/close') {
      return this.exclusive(() => this.closePackage3Probe(request), { allowFrozen: true });
    }
    if (method === 'POST' && url.pathname === '/api/plan-preview') return this.previewWorkspacePlan(request);
    const package3ReadbackMatch = url.pathname.match(/^\/api\/package3\/probes\/([a-z0-9-]{8,71})$/);
    if (method === 'GET' && package3ReadbackMatch) {
      return this.package3ProbeReadback(decodeURIComponent(package3ReadbackMatch[1]));
    }
    // The only other mutation permitted during the global freeze is the one-shot Telegram probe.
    if (method === 'POST' && url.pathname === '/api/notifications/test') {
      return this.sendTelegramTest(request);
    }
    if (method !== 'GET' && this.isMissionExecutionPaused()) return this.pausedResponse();

    if (method === 'GET' && url.pathname === '/api/missions') {
      const records = await this.ctx.storage.list({ prefix: 'mission:' });
      const missions = Array.from(records.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
      return json({ missions });
    }
    if (method === 'POST' && url.pathname === '/api/missions') return this.exclusive(() => this.createMission(request));
    if (method === 'GET' && url.pathname === '/api/notifications') {
      const records = await this.ctx.storage.list({ prefix: 'notification:' });
      return json({ notifications: Array.from(records.values()).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100) });
    }
    const missionMatch = url.pathname.match(/^\/api\/missions\/([^/]+)(?:\/(events|resume|plan))?$/);
    if (missionMatch) {
      const missionId = decodeURIComponent(missionMatch[1]);
      if (method === 'GET' && !missionMatch[2]) {
        const mission = await this.getMission(missionId);
        return mission ? json({ mission }) : error('mission_not_found', 404);
      }
      if (method === 'GET' && missionMatch[2] === 'events') {
        const events = await this.ctx.storage.list({ prefix: 'event:' + missionId + ':' });
        return json({ events: Array.from(events.values()).sort((a, b) => a.sequence - b.sequence) });
      }
      if (method === 'POST' && missionMatch[2] === 'resume') return this.exclusive(() => this.resume(missionId, request));
    }
    const approvalMatch = url.pathname.match(/^\/api\/approvals\/([^/]+)$/);
    if (method === 'POST' && approvalMatch) return this.exclusive(() => this.decideApproval(decodeURIComponent(approvalMatch[1]), request));
    return error('not_found', 404);
  }

  async resolveMissionWonder2A3PresenceScope(request, workerId) {
    const probeId = String(request.headers.get('x-aria-mw2-a3-probe-id') || '');
    const token = String(request.headers.get('x-aria-mw2-a3-scope-token') || '');
    if (!MISSION_WONDER_2_A3_PRESENCE_ID_PATTERN.test(probeId) || token.length < 32 || token.length > 200 ||
        !String(workerId || '').trim() || String(workerId).length > 200) return null;
    const scope = await this.ctx.storage.get('mw2:a3:presence:' + probeId);
    if (!scope || scope.status !== 'active' || Date.parse(scope.expires_at) <= Date.now()) return null;
    const tokenHash = await sha256Hex(token);
    if (!constantTimeTextEqual(tokenHash, scope.scope_token_sha256)) return null;
    if (scope.worker_id && scope.worker_id !== workerId) {
      const lastPresenceAt = Date.parse(scope.last_presence_at || scope.created_at);
      if (!Number.isFinite(lastPresenceAt) || Date.now() - lastPresenceAt < Number(scope.stale_after_ms)) return null;
    }
    return scope;
  }

  async startMissionWonder2A3PresenceProbe(request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const probeId = String(body && body.probe_id || '');
    const scopeToken = String(body && body.scope_token || '');
    const ttlMs = Number(body && body.ttl_ms || 120000);
    const heartbeatIntervalMs = Number(body && body.heartbeat_interval_ms || 5000);
    if (!body || body.confirm !== 'RUN_MISSION_WONDER_2_A3_PRESENCE_ONLY') return error('explicit_mission_wonder_2_a3_presence_confirmation_required', 400);
    if (!MISSION_WONDER_2_A3_PRESENCE_ID_PATTERN.test(probeId)) return error('mission_wonder_2_a3_presence_probe_id_invalid', 400);
    if (scopeToken.length < 32 || scopeToken.length > 200) return error('mission_wonder_2_a3_presence_token_invalid', 400);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < MISSION_WONDER_2_A3_PRESENCE_TTL_MIN_MS || ttlMs > MISSION_WONDER_2_A3_PRESENCE_TTL_MAX_MS) return error('mission_wonder_2_a3_presence_ttl_out_of_bounds', 400);
    if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 2000 || heartbeatIntervalMs > 15000) return error('mission_wonder_2_a3_presence_interval_out_of_bounds', 400);
    const scopeKey = 'mw2:a3:presence:' + probeId;
    if (await this.ctx.storage.get(scopeKey)) return error('mission_wonder_2_a3_presence_probe_id_already_used', 409);
    const activeProbeId = await this.ctx.storage.get('mw2:a3:presence:active-probe');
    if (typeof activeProbeId === 'string' && MISSION_WONDER_2_A3_PRESENCE_ID_PATTERN.test(activeProbeId)) {
      const active = await this.ctx.storage.get('mw2:a3:presence:' + activeProbeId);
      if (active && active.status === 'active' && Date.parse(active.expires_at) > Date.now()) return error('mission_wonder_2_a3_presence_probe_already_active', 409);
      if (active && active.status === 'active') {
        active.status = 'closed'; active.closed_at = nowIso(); active.close_reason = 'expired_scope_reconciled_before_new_probe';
        active.scope_token_sha256 = null; active.scope_token_revoked_at = nowIso();
        await this.ctx.storage.put('mw2:a3:presence:' + activeProbeId, active);
      }
      await this.ctx.storage.put('mw2:a3:presence:active-probe', null);
    }
    const [missionsBefore, jobsBefore] = await Promise.all([
      this.ctx.storage.list({ prefix: 'mission:' }), this.ctx.storage.list({ prefix: 'job:' })
    ]);
    const createdAt = Date.now();
    const scope = {
      version: 'v1', probe_id: probeId, status: 'active', scope_token_sha256: await sha256Hex(scopeToken),
      created_at: new Date(createdAt).toISOString(), expires_at: new Date(createdAt + ttlMs).toISOString(),
      heartbeat_interval_ms: heartbeatIntervalMs, stale_after_ms: heartbeatIntervalMs * 3,
      worker_id: null, worker_ids: [], recovery_count: 0, presence_count: 0,
      last_presence_at: null, last_presence_state: null, stale_detected_at: null,
      alarm_tick_count: 0, last_alarm_at: null,
      mission_count_before: missionsBefore.size, job_count_before: jobsBefore.size,
      closed_at: null, close_reason: null, scope_token_revoked_at: null
    };
    await this.ctx.storage.put(scopeKey, scope);
    await this.ctx.storage.put('mw2:a3:presence:active-probe', probeId);
    await this.ctx.storage.setAlarm(Date.now() + this.alarmMs);
    return json({ ok: true, probe: { probe_id: probeId, status: scope.status, expires_at: scope.expires_at,
      heartbeat_interval_ms: heartbeatIntervalMs, stale_after_ms: scope.stale_after_ms,
      presence_only: true, mission_execution_paused: true } }, 201);
  }

  async recordMissionWonder2A3Presence(scopeHint, body, scopeToken) {
    const scopeKey = 'mw2:a3:presence:' + scopeHint.probe_id;
    const scope = await this.ctx.storage.get(scopeKey);
    if (!scope || scope.status !== 'active' || Date.parse(scope.expires_at) <= Date.now()) return this.pausedResponse();
    if (!constantTimeTextEqual(await sha256Hex(scopeToken), scope.scope_token_sha256)) return this.pausedResponse();
    const requestedWorkerId = String(body && body.worker_id || '');
    if (!requestedWorkerId || requestedWorkerId.length > 200) return error('mission_wonder_2_a3_worker_id_invalid', 400);
    if (scope.worker_id && scope.worker_id !== requestedWorkerId) {
      const lastPresenceAt = Date.parse(scope.last_presence_at || scope.created_at);
      if (!Number.isFinite(lastPresenceAt) || Date.now() - lastPresenceAt < Number(scope.stale_after_ms)) return error('mission_wonder_2_a3_presence_worker_already_active', 409);
      scope.recovery_count = Number(scope.recovery_count || 0) + 1;
      scope.stale_detected_at = scope.stale_detected_at || nowIso();
      scope.worker_id = requestedWorkerId;
    } else if (!scope.worker_id) {
      scope.worker_id = requestedWorkerId;
    }
    scope.worker_ids = Array.from(new Set([...(scope.worker_ids || []), requestedWorkerId]));
    if (scope.worker_ids.length > 2) return error('mission_wonder_2_a3_presence_worker_limit_exceeded', 409);
    scope.presence_count = Number(scope.presence_count || 0) + 1;
    scope.last_presence_at = nowIso(); scope.last_presence_state = 'idle'; scope.stale_detected_at = null;
    await this.ctx.storage.put(scopeKey, scope);
    return json({ ok: true, probe_id: scope.probe_id, worker_id: scope.worker_id,
      presence_count: scope.presence_count, recovery_count: scope.recovery_count, last_presence_at: scope.last_presence_at });
  }

  async missionWonder2A3PresenceProbeReadback(probeId) {
    if (!MISSION_WONDER_2_A3_PRESENCE_ID_PATTERN.test(String(probeId || ''))) return error('mission_wonder_2_a3_presence_probe_id_invalid', 400);
    const scope = await this.ctx.storage.get('mw2:a3:presence:' + probeId);
    if (!scope) return error('mission_wonder_2_a3_presence_probe_not_found', 404);
    const [missionsNow, jobsNow] = await Promise.all([
      this.ctx.storage.list({ prefix: 'mission:' }), this.ctx.storage.list({ prefix: 'job:' })
    ]);
    const lastPresenceMs = Date.parse(scope.last_presence_at || '');
    const stale = scope.status === 'active' && (!Number.isFinite(lastPresenceMs) || Date.now() - lastPresenceMs > Number(scope.stale_after_ms));
    return json({ ok: true, scope: {
      version: scope.version, probe_id: scope.probe_id, status: scope.status,
      created_at: scope.created_at, expires_at: scope.expires_at, expired: Date.parse(scope.expires_at) <= Date.now(),
      heartbeat_interval_ms: scope.heartbeat_interval_ms, stale_after_ms: scope.stale_after_ms,
      worker_id: scope.worker_id, worker_ids: scope.worker_ids || [], recovery_count: Number(scope.recovery_count || 0),
      presence_count: Number(scope.presence_count || 0), last_presence_at: scope.last_presence_at,
      last_presence_state: scope.last_presence_state, stale, stale_detected_at: scope.stale_detected_at,
      alarm_tick_count: Number(scope.alarm_tick_count || 0), last_alarm_at: scope.last_alarm_at,
      closed_at: scope.closed_at, close_reason: scope.close_reason,
      scope_token_revoked: scope.scope_token_sha256 === null && Boolean(scope.scope_token_revoked_at),
      scope_token_revoked_at: scope.scope_token_revoked_at,
      mission_job_storage_unchanged: missionsNow.size === Number(scope.mission_count_before) && jobsNow.size === Number(scope.job_count_before),
      mission_count_before: Number(scope.mission_count_before), mission_count_after: missionsNow.size,
      job_count_before: Number(scope.job_count_before), job_count_after: jobsNow.size
    } });
  }

  async closeMissionWonder2A3PresenceProbe(request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const probeId = String(body && body.probe_id || '');
    if (body.confirm !== 'CLOSE_MISSION_WONDER_2_A3_PRESENCE_ONLY') return error('explicit_mission_wonder_2_a3_presence_close_confirmation_required', 400);
    if (!MISSION_WONDER_2_A3_PRESENCE_ID_PATTERN.test(probeId)) return error('mission_wonder_2_a3_presence_probe_id_invalid', 400);
    const scopeKey = 'mw2:a3:presence:' + probeId;
    const scope = await this.ctx.storage.get(scopeKey);
    if (!scope) return error('mission_wonder_2_a3_presence_probe_not_found', 404);
    if (scope.status !== 'closed') {
      scope.status = 'closed'; scope.closed_at = nowIso();
      scope.close_reason = String(body.reason || 'operator_cleanup').slice(0, 200);
      scope.scope_token_sha256 = null; scope.scope_token_revoked_at = nowIso();
      await this.ctx.storage.put(scopeKey, scope);
      if (await this.ctx.storage.get('mw2:a3:presence:active-probe') === probeId) await this.ctx.storage.put('mw2:a3:presence:active-probe', null);
    }
    return this.missionWonder2A3PresenceProbeReadback(probeId);
  }

  async expireMissionWonder2A3PresenceProbe(probeId, reason) {
    const scopeKey = 'mw2:a3:presence:' + probeId;
    const scope = await this.ctx.storage.get(scopeKey);
    if (!scope || scope.status !== 'active') return;
    scope.status = 'closed'; scope.closed_at = nowIso(); scope.close_reason = String(reason || 'ttl_expired').slice(0, 200);
    scope.scope_token_sha256 = null; scope.scope_token_revoked_at = nowIso();
    await this.ctx.storage.put(scopeKey, scope);
    if (await this.ctx.storage.get('mw2:a3:presence:active-probe') === probeId) await this.ctx.storage.put('mw2:a3:presence:active-probe', null);
  }

  async resolvePackage3ProbeWorkerScope(request, body, jobId) {
    const probeId = String(request.headers.get('x-aria-package3-probe-id') || '');
    const token = String(request.headers.get('x-aria-package3-scope-token') || '');
    if (!PACKAGE3_PROBE_ID_PATTERN.test(probeId) || token.length < 32 || token.length > 200) return null;
    const scope = await this.ctx.storage.get('package3:probe:' + probeId);
    if (!scope || scope.status !== 'active' || Date.parse(scope.expires_at) <= Date.now()) return null;
    const tokenHash = await sha256Hex(token);
    if (!constantTimeTextEqual(tokenHash, scope.scope_token_sha256)) return null;
    const workerId = String(body && body.worker_id || '');
    if (!package3ProbeWorkerIdAllowed(scope, workerId)) return null;
    if (jobId) {
      const job = await this.ctx.storage.get('job:' + jobId);
      if (!package3ProbeJobAllowed(scope, job)) return null;
    }
    return scope;
  }

  async startPackage3Probe(request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const probeType = String(body && body.mode || 'package3_write_recovery');
    const readonlyPilot = probeType === 'readonly_git_status';
    const expectedConfirmation = readonlyPilot
      ? 'RUN_ONE_READONLY_GIT_STATUS_PILOT'
      : 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE';
    if (!body || body.confirm !== expectedConfirmation || !['package3_write_recovery', 'readonly_git_status'].includes(probeType)) {
      return error('explicit_scoped_probe_confirmation_required', 400);
    }
    const probeId = String(body.probe_id || '');
    const scopeToken = String(body.scope_token || '');
    if (!PACKAGE3_PROBE_ID_PATTERN.test(probeId)) return error('package3_probe_id_invalid', 400);
    if (scopeToken.length < 32 || scopeToken.length > 200) return error('package3_probe_scope_token_invalid', 400);
    const scopeKey = 'package3:probe:' + probeId;
    if (await this.ctx.storage.get(scopeKey)) return error('package3_probe_id_already_used', 409);
    const existingScopes = await this.ctx.storage.list({ prefix: 'package3:probe:' });
    for (const existingScope of existingScopes.values()) {
      if (!['preparing', 'active'].includes(existingScope.status)) continue;
      if (Date.parse(existingScope.expires_at) > Date.now()) {
        return error('package3_probe_already_active', 409);
      }
      // A crashed workflow may leave an expired preparing/active scope behind.
      // Reconcile and revoke it before accepting a new one-shot probe.
      const cleanup = await this.closePackage3Probe(new Request('https://aria.internal/api/package3/probe/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          probe_id: existingScope.probe_id,
          reason: 'expired_scope_reconciled_before_new_probe'
        })
      }));
      if (!cleanup.ok) return error('package3_expired_scope_cleanup_failed', 503);
      const cleanupPayload = await cleanup.json().catch(() => ({}));
      if (cleanupPayload.scope?.status !== 'closed') {
        return error('package3_expired_scope_cleanup_incomplete', 503);
      }
    }
    const idempotencyKey = 'mw2p3-' + probeId;
    if (await this.ctx.storage.get('idempotency:mission:' + idempotencyKey)) {
      return error('package3_probe_idempotency_record_already_exists', 409);
    }

    const scope = {
      version: 'v1',
      probe_id: probeId,
      probe_type: probeType,
      status: 'preparing',
      mission_id: null,
      scope_token_sha256: await sha256Hex(scopeToken),
      worker_id_prefix: 'mw2p3-' + probeId + '-',
      allowed_job_ids: [],
      claim_count: 0,
      claimed_worker_ids: [],
      presence_count: 0,
      last_presence_at: null,
      last_presence_state: null,
      last_presence_worker_id: null,
      alarm_tick_count: 0,
      last_alarm_at: null,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + (readonlyPilot ? READONLY_PILOT_TTL_MS : PACKAGE3_PROBE_TTL_MS)).toISOString(),
      lease_ms: PACKAGE3_PROBE_LEASE_MS,
      closed_at: null,
      close_reason: null,
      scope_token_revoked_at: null
    };
    await this.ctx.storage.put(scopeKey, scope);
    const previousProbeContext = this.package3ProbeContext;
    this.package3ProbeContext = scope;
    try {
      const missionRequest = new Request('https://aria.internal/api/missions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey
        },
        body: JSON.stringify({
          goal: readonlyPilot
            ? 'Mission Wonder 2 Step 2 LIVE read-only pilot ' + probeId + ': execute exactly one git.status task on the approved ROBVG workspace, verify its output, demonstrate a lease heartbeat and idle worker presence, then revoke the scope.'
            : 'Mission Wonder 2 Package 3 LIVE synthetic recovery probe ' + probeId + ': write one temporary proof artifact, recover the same job after a process interruption, and verify its SHA-256.',
          metadata: {
            mission: 'Mission Wonder 2',
            package: readonlyPilot ? 2 : 3,
            environment: 'production-live-probe',
            execution_scope: readonlyPilot ? 'one-mission-one-readonly-git-status' : 'one-mission-one-artifact',
            package3_live_probe: !readonlyPilot,
            readonly_scheduler_pilot: readonlyPilot,
            probe_id: probeId
          },
          policy: {
            max_risk: readonlyPilot ? 'low' : 'medium',
            require_human_approval: true,
            max_steps: 1
          }
        })
      });
      const createdResponse = await this.createMission(missionRequest);
      const createdPayload = await createdResponse.json().catch(() => ({}));
      if (!createdResponse.ok || !createdPayload.mission?.mission_id) {
        scope.status = 'failed';
        scope.last_error = String(createdPayload.error || 'package3_probe_mission_create_failed').slice(0, 300);
        scope.scope_token_sha256 = null;
        await this.ctx.storage.put(scopeKey, scope);
        return error(scope.last_error, createdResponse.status || 500);
      }

      scope.mission_id = String(createdPayload.mission.mission_id);
      scope.status = 'active';
      await this.ctx.storage.put(scopeKey, scope);
      if (readonlyPilot) await this.ctx.storage.put('package3:readonly-pilot:active-probe', probeId);

      // Both probes use a fixed, exact one-task plan. The Windows worker remains
      // execution-only; the read-only pilot is restricted to git.status (no writes).
      const relativePath = 'package3-proof-' + probeId + '.txt';
      const proofContent = 'Mission Wonder 2 Package 3 LIVE proof ' + probeId + '\n';
      const readonlyTask = {
        task_id: 'readonly-pilot-git-status',
        title: 'One read-only Git status check on ROBVG',
        operation: 'git.status',
        payload: {},
        idempotent: true,
        max_attempts: 1,
        depends_on: []
      };
      const package3Task = {
        task_id: 'package3-live-write-proof',
        title: 'Create one isolated temporary Package 3 proof artifact',
        operation: 'workspace.write',
        payload: { relative_path: relativePath, content: proofContent },
        idempotent: true,
        max_attempts: 2,
        depends_on: []
      };
      const planTask = readonlyPilot ? readonlyTask : package3Task;
      const planResponse = await this.submitPlan(
        scope.mission_id,
        new Request('https://aria.internal/api/missions/' + encodeURIComponent(scope.mission_id) + '/plan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tasks: [planTask] })
        }),
        { source: readonlyPilot ? 'readonly_git_status_scoped_plan' : 'package3_scoped_static_plan' }
      );
      const planPayload = await planResponse.json().catch(() => ({}));
      const plannedMission = planPayload.mission;
      if (!planResponse.ok || !plannedMission || plannedMission.status !== 'running' ||
          !Array.isArray(plannedMission.tasks) || plannedMission.tasks.length !== 1 ||
          plannedMission.tasks[0]?.operation !== planTask.operation ||
          (readonlyPilot && (Object.keys(plannedMission.tasks[0]?.payload || {}).length !== 0 || plannedMission.tasks[0]?.task_id !== readonlyTask.task_id)) ||
          (!readonlyPilot && (plannedMission.tasks[0]?.payload?.relative_path !== relativePath || plannedMission.tasks[0]?.payload?.content !== proofContent)) ||
          plannedMission.tasks[0]?.status !== 'running') {
        const cleanup = await this.closePackage3Probe(new Request('https://aria.internal/api/package3/probe/close', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ probe_id: probeId, reason: 'package3_static_plan_initialization_failed' })
        }));
        const cleanupPayload = await cleanup.json().catch(() => ({}));
        if (!cleanup.ok || cleanupPayload.scope?.status !== 'closed') {
          throw new Error('package3_probe_plan_initialization_failed_cleanup_incomplete');
        }
        return error('package3_probe_plan_initialization_failed', 503);
      }

      if (readonlyPilot) {
        const persistedScope = await this.ctx.storage.get(scopeKey);
        const scopedJobs = await Promise.all((persistedScope && persistedScope.allowed_job_ids || []).map(jobId => this.ctx.storage.get('job:' + jobId)));
        scope.allowed_job_ids = scopedJobs.filter(job => job && package3ProbeJobAllowed({ ...scope, allowed_job_ids: [job.job_id] }, job) &&
          (job.status === 'queued' || job.status === 'leased')).map(job => String(job.job_id));
      } else {
        const records = await this.ctx.storage.list({ prefix: 'job:' });
        scope.allowed_job_ids = Array.from(records.values())
          .filter(job => job.mission_id === scope.mission_id &&
            PACKAGE3_PROBE_ALLOWED_JOB_OPERATIONS.has(String(job.operation)) &&
            (job.status === 'queued' || job.status === 'leased'))
          .map(job => String(job.job_id));
      }
      await this.ctx.storage.put(scopeKey, scope);
      if (scope.allowed_job_ids.length !== 1) {
        const cleanup = await this.closePackage3Probe(new Request('https://aria.internal/api/package3/probe/close', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ probe_id: probeId, reason: 'package3_initial_job_scope_invalid' })
        }));
        const cleanupPayload = await cleanup.json().catch(() => ({}));
        if (!cleanup.ok || cleanupPayload.scope?.status !== 'closed') {
          throw new Error('package3_initial_job_scope_invalid_cleanup_incomplete');
        }
        return error('package3_initial_job_scope_invalid', 503);
      }

      return json({
        ok: true,
        probe: {
          probe_id: probeId,
          status: scope.status,
          mission_id: scope.mission_id,
          expires_at: scope.expires_at,
          lease_ms: scope.lease_ms,
          probe_type: scope.probe_type,
          allowed_job_operations: Array.from(PACKAGE3_PROBE_ALLOWED_JOB_OPERATIONS)
        },
        mission: plannedMission
      }, 201);
    } catch (cause) {
      scope.status = 'failed';
      scope.last_error = String(cause && cause.message || cause || 'package3_probe_start_failed').slice(0, 300);
      scope.scope_token_sha256 = null;
      await this.ctx.storage.put(scopeKey, scope);
      return error('package3_probe_start_failed:' + scope.last_error, 500);
    } finally {
      this.package3ProbeContext = previousProbeContext;
    }
  }

  async package3ProbeReadback(probeId) {
    if (!PACKAGE3_PROBE_ID_PATTERN.test(String(probeId || ''))) return error('package3_probe_id_invalid', 400);
    const scope = await this.ctx.storage.get('package3:probe:' + probeId);
    if (!scope) return error('package3_probe_not_found', 404);
    const mission = scope.mission_id ? await this.getMission(scope.mission_id) : null;
    const readonlyPilot = scope.probe_type === 'readonly_git_status';
    const [jobRecords, eventRecords, notificationRecords] = await Promise.all([
      readonlyPilot
        ? Promise.all((scope.allowed_job_ids || []).map(jobId => this.ctx.storage.get('job:' + jobId)))
        : this.ctx.storage.list({ prefix: 'job:' }),
      scope.mission_id
        ? this.ctx.storage.list({ prefix: 'event:' + scope.mission_id + ':' })
        : Promise.resolve(new Map()),
      readonlyPilot ? Promise.resolve(new Map()) : this.ctx.storage.list({ prefix: 'notification:' })
    ]);
    const jobValues = readonlyPilot ? jobRecords.filter(Boolean) : Array.from(jobRecords.values());
    const jobs = jobValues
      .filter(job => job.mission_id === scope.mission_id)
      .map(job => ({
        job_id: job.job_id,
        mission_id: job.mission_id,
        task_id: job.task_id,
        operation: job.operation,
        task_operation: job.task?.operation || null,
        status: job.status,
        worker_id: job.worker_id,
        attempts: job.attempts,
        heartbeat_count: Number(job.heartbeat_count || 0),
        last_heartbeat_at: job.last_heartbeat_at || null,
        lease_until: job.lease_until,
        created_at: job.created_at,
        updated_at: job.updated_at,
        last_error: job.last_error,
        result: clone(job.result)
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const events = Array.from(eventRecords.values()).sort((a, b) => a.sequence - b.sequence);
    const notifications = Array.from(notificationRecords.values())
      .filter(item => item.event?.mission_id === scope.mission_id)
      .map(item => ({
        notification_id: item.notification_id,
        status: item.status,
        attempts: item.attempts,
        delivered_at: item.delivered_at,
        last_error: item.last_error,
        event: clone(item.event)
      }));
    return json({
      ok: true,
      scope: {
        version: scope.version,
        probe_id: scope.probe_id,
        probe_type: scope.probe_type || 'package3_write_recovery',
        status: scope.status,
        mission_id: scope.mission_id,
        worker_id_prefix: scope.worker_id_prefix,
        allowed_job_ids: scope.allowed_job_ids,
        claim_count: scope.claim_count,
        claimed_worker_ids: scope.claimed_worker_ids,
        presence_count: Number(scope.presence_count || 0),
        last_presence_at: scope.last_presence_at || null,
        last_presence_state: scope.last_presence_state || null,
        last_presence_worker_id: scope.last_presence_worker_id || null,
        alarm_tick_count: Number(scope.alarm_tick_count || 0),
        last_alarm_at: scope.last_alarm_at || null,
        created_at: scope.created_at,
        expires_at: scope.expires_at,
        lease_ms: scope.lease_ms,
        closed_at: scope.closed_at,
        close_reason: scope.close_reason,
        scope_token_revoked_at: scope.scope_token_revoked_at
      },
      mission,
      jobs,
      events,
      notifications
    });
  }

  async closePackage3Probe(request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const probeId = String(body && body.probe_id || '');
    if (!PACKAGE3_PROBE_ID_PATTERN.test(probeId)) return error('package3_probe_id_invalid', 400);
    const scopeKey = 'package3:probe:' + probeId;
    const scope = await this.ctx.storage.get(scopeKey);
    if (!scope) return error('package3_probe_not_found', 404);
    if (scope.status === 'closed') return this.package3ProbeReadback(probeId);
    // Recover mission identity if an isolate restarted after createMission
    // committed its idempotency record but before the probe scope stored mission_id.
    if (!scope.mission_id) {
      const creation = await this.ctx.storage.get('idempotency:mission:mw2p3-' + probeId);
      if (creation && creation.mission_id) scope.mission_id = String(creation.mission_id);
    }
    const previousProbeContext = this.package3ProbeContext;
    this.package3ProbeContext = scope;
    try {
      const jobs = scope.probe_type === 'readonly_git_status'
        ? await Promise.all((scope.allowed_job_ids || []).map(jobId => this.ctx.storage.get('job:' + jobId)))
        : Array.from((await this.ctx.storage.list({ prefix: 'job:' })).values());
      for (const job of jobs) {
        if (!job || job.mission_id !== scope.mission_id || !ACTIVE_JOB_STATES.has(job.status)) continue;
        job.status = 'cancelled';
        job.last_error = 'package3_probe_scope_closed';
        job.worker_id = null;
        job.lease_token = null;
        job.lease_until = null;
        job.updated_at = nowIso();
        await this.ctx.storage.put('job:' + job.job_id, job);
      }
      const mission = scope.mission_id ? await this.getMission(scope.mission_id) : null;
      if (scope.probe_type === 'readonly_git_status' && await this.ctx.storage.get('package3:readonly-pilot:active-probe') === probeId) {
        await this.ctx.storage.put('package3:readonly-pilot:active-probe', null);
      }
      if (mission && !['succeeded', 'failed', 'cancelled'].includes(mission.status)) {
        mission.status = 'cancelled';
        mission.current_task_id = null;
        mission.last_error = 'package3_probe_scope_closed';
        await this.saveMission(mission, 'package3_probe_closed', {
          probe_id: probeId,
          reason: String(body.reason || 'operator_cleanup').slice(0, 200)
        });
      }
      scope.status = 'closed';
      scope.closed_at = nowIso();
      scope.close_reason = String(body.reason || 'operator_cleanup').slice(0, 200);
      scope.scope_token_sha256 = null;
      scope.scope_token_revoked_at = nowIso();
      await this.ctx.storage.put(scopeKey, scope);
      return this.package3ProbeReadback(probeId);
    } finally {
      this.package3ProbeContext = previousProbeContext;
    }
  }

  async getMission(missionId) {
    return this.ctx.storage.get('mission:' + missionId);
  }
  async saveMission(mission, eventType, details = {}) {
    this.assertMissionExecutionEnabled();
    mission.updated_at = nowIso();
    mission.progress_percent = progressOf(mission);
    mission.event_sequence = (mission.event_sequence || 0) + 1;
    await this.ctx.storage.put('mission:' + mission.mission_id, mission);
    await this.ctx.storage.put('event:' + mission.mission_id + ':' + String(mission.event_sequence).padStart(8, '0'), {
      event_id: uuid('event'),
      mission_id: mission.mission_id,
      sequence: mission.event_sequence,
      type: eventType,
      created_at: mission.updated_at,
      details: clone(details)
    });
  }
  async sendTelegramTest(request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    if (!body || body.confirm !== 'SEND_TELEGRAM_TEST_ONCE') {
      return error('explicit_telegram_test_confirmation_required', 400);
    }
    if (!this.env.ARIA_TELEGRAM_BOT_TOKEN || !this.env.ARIA_TELEGRAM_CHAT_ID) {
      return error('telegram_configuration_incomplete', 409);
    }

    const throttleKey = 'internal:telegram-test:last-attempt';
    const priorAttempt = await this.ctx.storage.get(throttleKey);
    if (priorAttempt && Date.now() - Date.parse(priorAttempt.created_at) < 60000) {
      return error('telegram_test_rate_limited', 429);
    }
    await this.ctx.storage.put(throttleKey, { created_at: nowIso() });

    const record = {
      notification_id: uuid('notification'),
      created_at: nowIso(),
      updated_at: nowIso(),
      status: 'pending',
      attempts: 0,
      delivered_at: null,
      last_error: null,
      event: {
        type: 'telegram_connection_test',
        details: 'Prueba de conexión: ARIA puede enviarte avisos por Telegram.'
      }
    };
    await this.ctx.storage.put('notification:' + record.notification_id, record);
    await this.deliverNotification(record.notification_id, { allowWhilePaused: true });

    const delivered = await this.ctx.storage.get('notification:' + record.notification_id);
    if (delivered && delivered.status === 'pending') {
      delivered.status = 'failed';
      delivered.last_error = delivered.last_error || 'telegram_test_not_delivered';
      delivered.updated_at = nowIso();
      await this.ctx.storage.put('notification:' + record.notification_id, delivered);
    }
    const result = await this.ctx.storage.get('notification:' + record.notification_id);
    const notification = {
      notification_id: result.notification_id,
      status: result.status,
      attempts: result.attempts,
      delivered_at: result.delivered_at,
      last_error: result.last_error
    };
    return json({ notification }, result.status === 'delivered' ? 200 : 502);
  }

  async notify(event) {
    this.assertMissionExecutionEnabled();
    return this.exclusiveNotification(() => this.persistNotification(event));
  }
  async persistNotification(event) {
    const semanticKey = semanticNotificationKey(event);
    const dedupeKey = await sha256Hex(semanticKey);
    const notificationId = 'notification_' + dedupeKey.slice(0, 32);
    const existing = await this.ctx.storage.get('notification:' + notificationId);
    if (existing) return existing;
    const telegramRequested = Boolean(this.env.ARIA_TELEGRAM_BOT_TOKEN || this.env.ARIA_TELEGRAM_CHAT_ID);
    const telegramConfigured = Boolean(this.env.ARIA_TELEGRAM_BOT_TOKEN && this.env.ARIA_TELEGRAM_CHAT_ID);
    const webhookConfigured = Boolean(this.env.ARIA_NOTIFICATION_WEBHOOK_URL);
    const configured = telegramRequested ? telegramConfigured : webhookConfigured;
    const isPackage3Probe = Boolean(this.package3ProbeContext);
    const mission = event.mission_id ? await this.getMission(String(event.mission_id)) : null;
    const approvalPending = ['human_intervention_required', 'human_approval_required'].includes(event.type) && Boolean(event.approval_id);
    const rejected = event.type === 'mission_rejected' || event.type === 'human_approval_rejected';
    const ambiguous = event.type === 'ambiguous_result' || event.reason === 'ambiguous_non_idempotent_result';
    const dependencyBlocked = event.reason === 'task_dependency_blocked' || event.type === 'dependency_blocked';
    const configurationIssue = event.type === 'configuration_issue' || /configuration|provider|credential|capacity|quota/i.test(String(event.reason || event.error_code || ''));
    const intervention = approvalPending || rejected || ambiguous || dependencyBlocked || configurationIssue || event.type === 'human_intervention_required';
    const resolutionSteps = approvalPending
      ? ['Abre ARIA Mission Control y localiza la misión y la aprobación indicadas.', 'Revisa el objetivo, el paso y sus efectos.', 'Aprueba o rechaza explícitamente esta aprobación; ARIA no puede aprobarla por sí misma.']
      : rejected
        ? ['El rechazo ya quedó registrado.', 'Revisa la decisión y el paso afectado en ARIA Mission Control.', 'Si el objetivo sigue autorizado, solicita una nueva planificación que sustituya el paso; no uses Reanudar para repetirlo.']
        : ambiguous
          ? ['Comprueba en el sistema destino si la operación llegó a aplicarse.', 'Registra el resultado reconciliado y su evidencia para esta tarea en ARIA Mission Control, o autoriza explícitamente el replay de esta tarea.', 'ARIA continuará desde el checkpoint reconciliado; sin esa decisión no repetirá la operación.']
          : dependencyBlocked
            ? ['Abre ARIA Mission Control y revisa las dependencias y tareas bloqueadas.', 'Corrige la dependencia o aporta el resultado/evidencia que falta.', 'ARIA reanudará las tareas desbloqueadas y conservará el trabajo independiente.']
            : configurationIssue
              ? ['Revisa el diagnóstico y el proveedor/modelo asociado en ARIA Mission Control.', 'Corrige la cuota, credencial o configuración mediante el canal operativo autorizado.', 'ARIA reintentará o replanificará solo cuando la configuración esté disponible.']
              : intervention
                ? ['Abre ARIA Mission Control y localiza la misión y la tarea indicadas.', 'Revisa el diagnóstico y resuelve el requisito humano específico.', 'ARIA continuará desde el checkpoint seguro y volverá a verificar antes de declarar éxito.']
                : [];
    const record = {
      notification_id: notificationId,
      dedupe_key: dedupeKey,
      created_at: nowIso(),
      updated_at: nowIso(),
      status: isPackage3Probe ? 'suppressed_package3_probe' : (configured ? 'pending' : 'waiting_config'),
      attempts: 0,
      delivered_at: null,
      last_error: isPackage3Probe
        ? 'external_delivery_disabled_for_package3_probe'
        : (configured ? null : (telegramRequested ? 'telegram_configuration_incomplete' : 'notification_webhook_not_configured')),
      event: clone({
        ...event,
        mission_goal: mission && mission.goal || event.mission_goal || null,
        mission_control_url: MISSION_CONTROL_URL,
        resolution_steps: resolutionSteps,
        after_resolution: intervention
          ? ambiguous
            ? 'ARIA aplicará la reconciliación o replay autorizado solo a esta tarea y continuará con el resto sin duplicar trabajo confirmado.'
            : rejected
              ? 'ARIA conservará el rechazo y solo continuará con tareas independientes o con un plan sustituto validado.'
              : 'ARIA continúa desde el checkpoint persistido, procesa el trabajo independiente restante y vuelve a verificar antes de declarar éxito.'
          : null
      })
    };
    await this.ctx.storage.put('notification:' + record.notification_id, record);
    if (!isPackage3Probe) {
      this.ctx.waitUntil((async () => {
        try {
          if (configured) await this.exclusive(() => this.deliverNotification(record.notification_id));
        } finally {
          await this.exclusive(() => this.scheduleAlarm());
        }
      })());
    }
    return record;
  }
  async deliverNotification(notificationId, { allowWhilePaused = false } = {}) {
    if (!allowWhilePaused) this.assertMissionExecutionEnabled();
    const record = await this.ctx.storage.get('notification:' + notificationId);
    if (!record || !['pending', 'waiting_config'].includes(record.status)) return;

    const telegramRequested = Boolean(this.env.ARIA_TELEGRAM_BOT_TOKEN || this.env.ARIA_TELEGRAM_CHAT_ID);
    const useTelegram = telegramRequested;
    let endpoint;
    let telegramChatId = null;
    try {
      if (useTelegram) {
        const botToken = String(this.env.ARIA_TELEGRAM_BOT_TOKEN || '').trim();
        telegramChatId = String(this.env.ARIA_TELEGRAM_CHAT_ID || '').trim();
        if (!botToken || !telegramChatId) throw new Error('telegram_configuration_incomplete');
        if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) throw new Error('telegram_bot_token_invalid');
        if (!/^-?\d{1,25}$/.test(telegramChatId)) throw new Error('telegram_chat_id_invalid');
        endpoint = new URL('https://api.telegram.org/bot' + botToken + '/sendMessage');
      } else {
        endpoint = new URL(this.env.ARIA_NOTIFICATION_WEBHOOK_URL || '');
        if (endpoint.username || endpoint.password) throw new Error('notification_webhook_credentials_in_url_rejected');
      }
      if (endpoint.protocol !== 'https:') throw new Error('notification_webhook_must_use_https');
      const configuredHosts = String(this.env.ARIA_NOTIFICATION_ALLOWED_HOSTS || '')
        .split(',')
        .map(host => host.trim().toLowerCase())
        .filter(Boolean);
      const allowedHosts = new Set(configuredHosts);
      if (useTelegram) allowedHosts.add('api.telegram.org');
      if (!allowedHosts.has(endpoint.host.toLowerCase())) throw new Error(useTelegram ? 'telegram_api_host_not_allowlisted' : 'notification_webhook_host_not_allowlisted');
    } catch (err) {
      const message = String(err && err.message || err);
      const normalizedError = /^(telegram_|notification_webhook_)/.test(message) ? message : 'notification_webhook_url_invalid';
      record.status = /configuration|incomplete|invalid/.test(normalizedError) ? 'waiting_config' : 'failed';
      record.last_error = normalizedError;
      record.updated_at = nowIso();
      await this.ctx.storage.put('notification:' + notificationId, record);
      return;
    }

    const maxAttempts = 5;
    record.attempts = Number.isSafeInteger(record.attempts) && record.attempts >= 0 ? record.attempts : 0;
    if (record.attempts >= maxAttempts) {
      record.status = 'failed';
      record.last_error = 'notification_retry_limit_reached';
      record.updated_at = nowIso();
      await this.ctx.storage.put('notification:' + notificationId, record);
      return;
    }

    const event = record.event && typeof record.event === 'object' && !Array.isArray(record.event) ? record.event : {};
    const payload = {
      source: 'ARIA Mission Control',
      notification_id: String(record.notification_id || '').slice(0, 128),
      type: event.type == null ? 'aria_event' : String(event.type).slice(0, 80),
      mission_id: event.mission_id == null ? null : String(event.mission_id).slice(0, 128),
      task_id: event.task_id == null ? null : String(event.task_id).slice(0, 128),
      approval_id: event.approval_id == null ? null : String(event.approval_id).slice(0, 128),
      reason: event.reason == null ? null : String(event.reason).slice(0, 1000),
      details: event.details == null ? null : String(event.details).slice(0, 1000),
      mission_goal: event.mission_goal == null ? null : String(event.mission_goal).slice(0, 1000),
      mission_control_url: event.mission_control_url == null ? null : String(event.mission_control_url),
      resolution_steps: Array.isArray(event.resolution_steps) ? event.resolution_steps.map(step => String(step).slice(0, 300)).slice(0, 5) : [],
      after_resolution: event.after_resolution == null ? null : String(event.after_resolution).slice(0, 500),
      created_at: record.created_at
    };
    const telegramText = [
      'ARIA · ' + payload.type,
      payload.mission_id ? 'Misión: ' + payload.mission_id : null,
      payload.task_id ? 'Tarea: ' + payload.task_id : null,
      payload.approval_id ? 'Aprobación: ' + payload.approval_id : null,
      payload.mission_goal ? 'Objetivo: ' + payload.mission_goal : null,
      payload.reason ? 'Motivo: ' + payload.reason : null,
      payload.details ? 'Detalles: ' + payload.details : null,
      ...payload.resolution_steps.map((step, index) => (index + 1) + '. ' + step),
      payload.mission_control_url ? 'Mission Control: ' + payload.mission_control_url : null,
      payload.after_resolution ? 'Después: ' + payload.after_resolution : null,
      'Aviso: ' + payload.notification_id,
      'Fecha: ' + payload.created_at
    ].filter(Boolean).join('\n').slice(0, 4096);

    const requestBody = useTelegram
      ? { chat_id: telegramChatId, text: telegramText }
      : payload;
    const headers = { 'content-type': 'application/json' };
    if (!useTelegram && this.env.ARIA_NOTIFICATION_TOKEN) {
      headers.authorization = 'Bearer ' + this.env.ARIA_NOTIFICATION_TOKEN;
    }

    record.attempts += 1;
    try {
      const response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
        redirect: 'manual',
        signal: AbortSignal.timeout(10000)
      });
      let telegramAccepted = true;
      if (useTelegram && response.ok) {
        try {
          const telegramResult = await response.clone().json();
          telegramAccepted = telegramResult && telegramResult.ok === true;
        } catch (_) {
          telegramAccepted = false;
        }
      }
      if (response.ok && telegramAccepted) {
        record.status = 'delivered';
        record.delivered_at = nowIso();
        record.last_error = null;
      } else {
        const status = Number(response.status) || 0;
        const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
        record.status = retryable && record.attempts < maxAttempts ? 'pending' : 'failed';
        record.last_error = useTelegram
          ? (status ? 'telegram_http_' + status : 'telegram_response_not_accepted')
          : 'webhook_http_' + status;
      }
    } catch (err) {
      record.status = record.attempts < maxAttempts ? 'pending' : 'failed';
      // Do not persist fetch errors for Telegram: some runtimes include the bot-token URL.
      record.last_error = useTelegram ? 'telegram_network_error' : String(err && err.message || err).slice(0, 500);
    }
    record.updated_at = nowIso();
    await this.ctx.storage.put('notification:' + notificationId, record);
  }
  async scheduleAlarm() {
    const scope = this.package3ProbeContext;
    const scopedReadonlyPilot = this.isMissionExecutionPaused() && scope?.probe_type === 'readonly_git_status' && scope.status === 'active';
    if (this.isMissionExecutionPaused() && !scopedReadonlyPilot) return false;
    let hasActive = false;
    let hasJobs = false;
    if (scopedReadonlyPilot) {
      const mission = await this.ctx.storage.get('mission:' + scope.mission_id);
      hasActive = Boolean(mission && ACTIVE_MISSION_STATES.has(mission.status));
      const jobs = await Promise.all((scope.allowed_job_ids || []).map(jobId => this.ctx.storage.get('job:' + jobId)));
      hasJobs = jobs.some(job => job && package3ProbeJobAllowed(scope, job) && ACTIVE_JOB_STATES.has(job.status));
    } else {
      const missions = await this.ctx.storage.list({ prefix: 'mission:' });
      hasActive = Array.from(missions.values()).some(m => ACTIVE_MISSION_STATES.has(m.status));
      const jobs = await this.ctx.storage.list({ prefix: 'job:' });
      hasJobs = Array.from(jobs.values()).some(job => ACTIVE_JOB_STATES.has(job.status));
    }
    let hasPendingNotifications = false;
    if (!scopedReadonlyPilot) {
      const notices = await this.ctx.storage.list({ prefix: 'notification:' });
      hasPendingNotifications = Array.from(notices.values()).some(item => ['pending', 'waiting_config'].includes(item.status));
    }
    if (hasActive || hasJobs || hasPendingNotifications) {
      await this.ctx.storage.setAlarm(Date.now() + this.alarmMs);
      return true;
    }
    return false;
  }
  async createJob(mission, operation, task, context = {}) {
    this.assertMissionExecutionEnabled();
    const currentProbeScope = this.package3ProbeContext;
    const scope = currentProbeScope && (
      currentProbeScope.mission_id === mission.mission_id ||
      (currentProbeScope.status === 'preparing' && mission.metadata?.probe_id === currentProbeScope.probe_id)
    ) ? currentProbeScope : null;
    const jobs = scope
      ? await Promise.all((scope.allowed_job_ids || []).map(jobId => this.ctx.storage.get('job:' + jobId)))
      : Array.from((await this.ctx.storage.list({ prefix: 'job:' })).values());
    const existing = jobs.find(job => job && job.mission_id === mission.mission_id &&
      job.operation === operation && ACTIVE_JOB_STATES.has(job.status) &&
      (!task || job.task_id === task.task_id));
    if (existing) return existing;
    const job = {
      job_id: uuid('job'),
      mission_id: mission.mission_id,
      task_id: task ? task.task_id : null,
      operation,
      task: task ? clone(task) : { operation, payload: {} },
      context: {
        goal: mission.goal,
        metadata: clone(mission.metadata || {}),
        policy: clone(mission.policy || {}),
        reason: context.reason || null,
        mission: clone(mission)
      },
      status: 'queued',
      worker_id: null,
      lease_token: null,
      lease_until: null,
      attempts: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
      result: null,
      last_error: null
    };
    await this.ctx.storage.put('job:' + job.job_id, job);
    if (scope) {
      const scopeKey = 'package3:probe:' + scope.probe_id;
      const currentScope = await this.ctx.storage.get(scopeKey);
      if (currentScope && ['preparing', 'active'].includes(currentScope.status) &&
          (!currentScope.mission_id || currentScope.mission_id === mission.mission_id)) {
        currentScope.mission_id = mission.mission_id;
        currentScope.allowed_job_ids = Array.from(new Set([...(currentScope.allowed_job_ids || []), job.job_id]));
        scope.mission_id = mission.mission_id;
        scope.allowed_job_ids = Array.from(new Set([...(scope.allowed_job_ids || []), job.job_id]));
        await this.ctx.storage.put(scopeKey, currentScope);
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + this.alarmMs);
    return job;
  }
  async createMission(request) {
    this.assertMissionExecutionEnabled();
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const goal = String(body.goal || '').trim();
    if (!goal || goal.length > 10000) return error('goal_required_or_too_long', 400);
    const policyInput = body.policy && typeof body.policy === 'object' ? body.policy : {};
    const metadata = body.metadata && typeof body.metadata === 'object' ? clone(body.metadata) : {};
    const workspaceRequest = metadata.cloudflare_workspace_request;
    const workspaceMutationRequested = Boolean(
      workspaceRequest && workspaceRequest.allow_mutations === true &&
      Array.isArray(workspaceRequest.tasks) &&
      workspaceRequest.tasks.some(task => task && ['workspace.write', 'workspace.edit'].includes(String(task.operation || '')))
    );
    const policy = {
      // Mutating workspace plans are forced behind a human gate regardless of
      // a caller-supplied max_risk/require_human_approval override.
      max_risk: workspaceMutationRequested ? 'low' : parseRisk(policyInput.max_risk || 'medium'),
      require_human_approval: workspaceMutationRequested ? true : policyInput.require_human_approval !== false,
      allow_background: true,
      max_steps: Math.max(1, Math.min(50, Number(policyInput.max_steps) || 20))
    };

    // Idempotency-Key is scoped to mission creation. Reserve the mission ID
    // before writing the mission so a retry can recover the same ID even if
    // the first request is interrupted between durable writes.
    let missionId = uuid('mission');
    const rawIdempotencyKey = request.headers.get('idempotency-key');
    if (rawIdempotencyKey !== null) {
      const idempotencyKey = rawIdempotencyKey.trim();
      if (!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) {
        return error('idempotency_key_invalid', 400);
      }
      const storageKey = 'idempotency:mission:' + idempotencyKey;
      const fingerprint = JSON.stringify({ goal, metadata, policy });
      const priorRecord = await this.ctx.storage.get(storageKey);
      if (priorRecord) {
        if (priorRecord.request_fingerprint !== fingerprint) {
          return error('idempotency_key_conflict', 409);
        }
        missionId = String(priorRecord.mission_id || '');
        if (!/^mission_[A-Za-z0-9_-]{1,160}$/.test(missionId)) {
          return error('idempotency_record_invalid', 500);
        }
        const priorMission = await this.getMission(missionId);
        if (priorMission) {
          if (priorMission.status === 'planning') {
            const jobs = await this.ctx.storage.list({ prefix: 'job:' });
            const hasPlanJob = Array.from(jobs.values()).some(job =>
              job.mission_id === missionId &&
              (job.operation === 'mission.plan' || job.operation === 'mission.replan')
            );
            if (!hasPlanJob) {
              await this.createJob(
                priorMission,
                priorMission.plan_kind === 'replan' ? 'mission.replan' : 'mission.plan',
                null,
                { reason: 'idempotent_create_recovery' }
              );
            }
            if (metadata.cloudflare_workspace_request) {
              const produced = await this.produceWorkspacePlanForMission(priorMission, metadata.cloudflare_workspace_request);
              if (produced.ok) return produced.response;
              return json({ mission: priorMission, remote_plan_pending: true, reason: produced.reason }, 202);
            }
          }
          await this.scheduleAlarm();
          return json({ mission: priorMission, idempotent_replay: true }, 200);
        }
      } else {
        await this.ctx.storage.put(storageKey, {
          mission_id: missionId,
          request_fingerprint: fingerprint,
          created_at: nowIso()
        });
      }
    }

    const mission = {
      mission_id: missionId,
      goal,
      status: 'planning',
      tasks: [],
      progress_percent: 0,
      current_task_id: null,
      created_at: nowIso(),
      updated_at: nowIso(),
      event_sequence: 0,
      plan_kind: 'plan',
      replans: 0,
      metadata,
      policy,
      approval: null,
      verification: null,
      last_error: null
    };
    await this.saveMission(mission, 'mission_created', { goal });
    await this.createJob(mission, 'mission.plan', null);
    if (metadata.cloudflare_workspace_request) {
      const produced = await this.produceWorkspacePlanForMission(mission, metadata.cloudflare_workspace_request);
      if (produced.ok) return produced.response;
      mission.last_error = produced.reason || 'remote_plan_producer_unavailable';
      await this.saveMission(mission, 'mission_plan_producer_failed', {
        source: 'supabase:aria-planner-v11',
        reason: mission.last_error
      });
      await this.scheduleAlarm();
      return json({ mission, remote_plan_pending: true, reason: mission.last_error }, 202);
    }
    await this.scheduleAlarm();
    return json({ mission }, 201);
  }

  async requestCanonicalWorkspacePlan(goal, workspaceRequest) {
    const rawUrl = String(this.env.ARIA_PLAN_PRODUCER_URL || '').trim();
    const producerToken = String(this.env.ARIA_PLAN_PRODUCER_TOKEN || '');
    if (producerToken.length !== 64 || !/^[a-f0-9]{64}$/.test(producerToken)) {
      return { ok: false, status: 503, reason: 'remote_plan_producer_not_configured' };
    }
    let endpoint;
    try {
      endpoint = new URL(rawUrl);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
          !endpoint.pathname.endsWith('/functions/v1/aria-planner-v11')) {
        return { ok: false, status: 503, reason: 'remote_plan_producer_url_invalid' };
      }
    } catch (_) {
      return { ok: false, status: 503, reason: 'remote_plan_producer_url_invalid' };
    }

    let response;
    try {
      response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-aria-plan-producer': 'cloudflare-workspace-v1',
          'x-aria-plan-producer-token': producerToken
        },
        body: JSON.stringify({
          goal: String(goal || ''),
          context: { cloudflare_workspace_request: workspaceRequest }
        }),
        // Keep redirects visible so the bridge reports a safe HTTP status instead of a generic TypeError.
        // Never follow a redirect with the producer credential.
        redirect: 'manual',
        signal: AbortSignal.timeout(20000)
      });
    } catch (cause) {
      const causeName = String(cause && cause.name || 'Error').toLowerCase();
      const safeName = ['aborterror', 'timeouterror', 'typeerror', 'error'].includes(causeName)
        ? causeName
        : 'unknown';
      const rawCode = String(cause && cause.cause && cause.cause.code || cause && cause.code || '').toUpperCase();
      const safeCodes = new Set([
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EHOSTUNREACH',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_SOCKET',
        'ERR_CERT_AUTHORITY_INVALID'
      ]);
      const safeCode = safeCodes.has(rawCode) ? '_' + rawCode.toLowerCase() : '';
      return {
        ok: false,
        status: 503,
        reason: 'remote_plan_producer_unreachable_' + safeName + safeCode
      };
    }
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: 503, reason: 'remote_plan_producer_redirect_' + response.status };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = String(payload && (payload.reason || payload.error) || 'remote_plan_producer_rejected').slice(0, 160);
      return { ok: false, status: response.status, reason };
    }
    const model = payload && payload.model;
    if (!payload || payload.ok !== true || !Array.isArray(payload.plan && payload.plan.tasks) ||
        model?.provider_id !== 'openrouter' ||
        model?.account_id !== 'acct_openrouter_primary' ||
        model?.model_id !== 'nvidia/nemotron-3.5-lightning:free' ||
        model?.executor !== 'aria-execution-runtime-v1') {
      return { ok: false, status: 502, reason: 'remote_plan_producer_response_invalid' };
    }
    return {
      ok: true,
      tasks: payload.plan.tasks,
      planner_version: String(payload.planner_version || 'unknown'),
      contract_version: String(payload.contract_version || 'unknown'),
      model: {
        provider_id: model.provider_id,
        account_id: model.account_id,
        model_id: model.model_id,
        executor: model.executor
      },
      requires_human_approval_for_mutations: payload.requires_human_approval_for_mutations === true
    };
  }

  async previewWorkspacePlan(request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const goal = String(body && body.goal || '').trim();
    if (!goal || goal.length > 10000) return error('goal_required_or_too_long', 400);
    const workspaceRequest = body && body.cloudflare_workspace_request;
    const result = await this.requestCanonicalWorkspacePlan(goal, workspaceRequest);
    if (!result.ok) {
      return error(result.reason || 'remote_plan_producer_unavailable', result.status || 503);
    }
    return json({
      ok: true,
      source: 'supabase:aria-planner-v11',
      planner_version: result.planner_version,
      contract_version: result.contract_version,
      model: result.model,
      requires_human_approval_for_mutations: result.requires_human_approval_for_mutations === true,
      tasks: result.tasks,
      durable_state_mutated: false
    });
  }

  async produceWorkspacePlanForMission(mission, workspaceRequest) {
    const result = await this.requestCanonicalWorkspacePlan(mission.goal, workspaceRequest);
    if (!result.ok) return result;
    const submitted = await this.submitPlan(
      mission.mission_id,
      new Request('https://aria.internal/api/missions/' + encodeURIComponent(mission.mission_id) + '/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tasks: result.tasks })
      })
    );
    if (!submitted.ok) {
      const failure = await submitted.json().catch(() => ({}));
      return {
        ok: false,
        status: submitted.status,
        reason: String(failure.error || 'remote_plan_submit_rejected').slice(0, 160)
      };
    }
    return { ok: true, response: submitted, planner_version: result.planner_version };
  }

  async submitPlan(missionId, request, options = {}) {
    this.assertMissionExecutionEnabled();
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    if (!body || !Array.isArray(body.tasks)) return error('plan_tasks_required', 400);
    const mission = await this.getMission(missionId);
    if (!mission) return error('mission_not_found', 404);
    if (mission.status !== 'planning') return error('mission_not_waiting_for_plan', 409);

    const replan = mission.plan_kind === 'replan';
    let tasks;
    try {
      const priorIds = replan ? new Set((mission.tasks || []).map(task => task.task_id)) : new Set();
      tasks = normalizeTasks(body.tasks, priorIds);
    } catch (cause) {
      return error(String(cause && cause.message || cause || 'plan_invalid'), 422);
    }
    const maxSteps = Math.max(1, Number(mission.policy && mission.policy.max_steps) || 20);
    const totalSteps = (replan ? (mission.tasks || []).length : 0) + tasks.length;
    if (totalSteps > maxSteps) return error('plan_exceeds_mission_max_steps', 422);
    if (replan) {
      const failedTasks = (mission.tasks || []).filter(task => task.status === 'failed');
      const replacements = new Map();
      for (const replacement of tasks) {
        if (!replacement.replaces_task_id) continue;
        const target = failedTasks.find(task => task.task_id === replacement.replaces_task_id);
        if (!target || replacements.has(target.task_id)) return error('replan_replacement_target_invalid', 422);
        replacements.set(target.task_id, replacement.task_id);
      }
      if (failedTasks.some(task => !replacements.has(task.task_id))) return error('replan_failed_task_replacement_required', 422);
      for (const [taskId, replacementId] of replacements) {
        const task = mission.tasks.find(item => item.task_id === taskId);
        task.replacement_task_id = replacementId;
      }
    }

    if (options.source === 'package3_scoped_static_plan') {
      const scope = this.package3ProbeContext;
      const probeId = String(scope && scope.probe_id || '');
      const expectedPath = 'package3-proof-' + probeId + '.txt';
      const expectedContent = 'Mission Wonder 2 Package 3 LIVE proof ' + probeId + '\n';
      if (!scope || scope.probe_type === 'readonly_git_status' || scope.status !== 'active' || scope.mission_id !== missionId ||
          tasks.length !== 1 || tasks[0].operation !== 'workspace.write' ||
          tasks[0].payload.relative_path !== expectedPath ||
          tasks[0].payload.content !== expectedContent ||
          tasks[0].idempotent !== true || tasks[0].max_attempts !== 2 ||
          tasks[0].depends_on.length !== 0) {
        return error('package3_probe_plan_scope_violation', 403);
      }
    }
    if (options.source === 'readonly_git_status_scoped_plan') {
      const scope = this.package3ProbeContext;
      if (!scope || scope.probe_type !== 'readonly_git_status' || scope.status !== 'active' || scope.mission_id !== missionId ||
          tasks.length !== 1 || tasks[0].task_id !== 'readonly-pilot-git-status' ||
          tasks[0].operation !== 'git.status' || Object.keys(tasks[0].payload || {}).length !== 0 ||
          tasks[0].idempotent !== true || tasks[0].max_attempts !== 1 || tasks[0].depends_on.length !== 0) {
        return error('readonly_git_status_plan_scope_violation', 403);
      }
    }

    // The cloud planner supplies structured tasks; the Windows executor never
    // receives an LLM planning job and never needs a local model credential.
    const readonlyPilotScope = options.source === 'readonly_git_status_scoped_plan' &&
      this.package3ProbeContext?.probe_type === 'readonly_git_status' &&
      this.package3ProbeContext.mission_id === missionId ? this.package3ProbeContext : null;
    const jobRecords = readonlyPilotScope
      ? await Promise.all((readonlyPilotScope.allowed_job_ids || []).map(jobId => this.ctx.storage.get('job:' + jobId)))
      : Array.from((await this.ctx.storage.list({ prefix: 'job:' })).values());
    for (const job of jobRecords) {
      if (!job || job.mission_id !== missionId ||
          !['mission.plan', 'mission.replan'].includes(job.operation) ||
          !ACTIVE_JOB_STATES.has(job.status)) continue;
      job.status = 'cancelled';
      job.worker_id = null;
      job.lease_token = null;
      job.lease_until = null;
      job.updated_at = nowIso();
      job.last_error = options.source === 'package3_scoped_static_plan'
        ? 'superseded_by_package3_scoped_static_plan'
        : options.source === 'readonly_git_status_scoped_plan'
          ? 'superseded_by_readonly_git_status_static_plan'
          : 'superseded_by_authenticated_remote_plan';
      await this.ctx.storage.put('job:' + job.job_id, job);
    }

    if (replan) {
      mission.tasks.push(...tasks);
      mission.replans = (mission.replans || 0) + 1;
    } else {
      mission.tasks = tasks;
    }
    mission.status = 'running';
    mission.plan_kind = null;
    mission.current_task_id = null;
    mission.last_error = null;
    await this.saveMission(mission, 'mission_plan_submitted', {
      source: String(options.source || 'authenticated_remote_planner'),
      task_count: tasks.length,
      total_task_count: mission.tasks.length,
      plan_kind: replan ? 'replan' : 'plan'
    });
    await this.scheduleNext(mission);
    await this.scheduleAlarm();
    return json({ ok: true, mission }, 201);
  }

  async claim(request) {
    this.assertMissionExecutionEnabled();
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const workerId = String(body.worker_id || '').slice(0, 200);
    if (!workerId) return error('worker_id_required', 400);
    const claimedCapabilities = new Set(
      Array.isArray(body.capabilities) ? body.capabilities.map(String).slice(0, 100) : []
    );
    const now = Date.now();
    const probeScope = this.package3ProbeContext;
    if (probeScope && !package3ProbeWorkerIdAllowed(probeScope, workerId)) {
      return error('package3_probe_worker_not_allowed', 403);
    }
    const records = probeScope
      ? new Map((await Promise.all((probeScope.allowed_job_ids || []).map(async jobId => [jobId, await this.ctx.storage.get('job:' + jobId)]))).filter(([, job]) => Boolean(job)))
      : await this.ctx.storage.list({ prefix: 'job:' });
    const candidate = Array.from(records.values())
      .filter(job => {
        if (probeScope && !package3ProbeJobAllowed(probeScope, job)) return false;
        if (job.operation === 'mission.plan' && !claimedCapabilities.has('mission.plan')) return false;
        if (job.operation === 'mission.replan' && !claimedCapabilities.has('mission.replan')) return false;
        if (job.operation === 'task.execute') {
          const requiredCapability = String(job.task && job.task.operation || '');
          if (!claimedCapabilities.has(requiredCapability) && !claimedCapabilities.has('workspace')) return false;
        }
        if (job.operation === 'mission.verify' && !claimedCapabilities.has('mission.verify')) return false;
        return job.status === 'queued' ||
          (job.status === 'leased' && job.lease_until && Date.parse(job.lease_until) <= now);
      })
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (!candidate) return json({ job: null });
    const job = await this.ctx.storage.get('job:' + candidate.job_id);
    if (!job || !(job.status === 'queued' || (job.status === 'leased' && job.lease_until && Date.parse(job.lease_until) <= Date.now()))) return json({ job: null });
    job.status = 'leased';
    job.worker_id = workerId;
    job.lease_token = crypto.randomUUID();
    const leaseMs = this.package3ProbeContext
      ? PACKAGE3_PROBE_LEASE_MS
      : Math.max(5000, Number(this.env.ARIA_WORKER_LEASE_MS) || 60000);
    job.lease_until = new Date(Date.now() + leaseMs).toISOString();
    job.updated_at = nowIso();
    job.attempts += 1;
    job.claimed_capabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String).slice(0, 50) : [];
    await this.ctx.storage.put('job:' + job.job_id, job);
    if (probeScope) {
      const currentScope = await this.ctx.storage.get('package3:probe:' + probeScope.probe_id);
      if (currentScope && currentScope.status === 'active') {
        currentScope.claim_count = Number(currentScope.claim_count || 0) + 1;
        currentScope.allowed_job_ids = Array.from(new Set([...(currentScope.allowed_job_ids || []), job.job_id]));
        currentScope.claimed_worker_ids = Array.from(new Set([...(currentScope.claimed_worker_ids || []), workerId]));
        await this.ctx.storage.put('package3:probe:' + probeScope.probe_id, currentScope);
      }
    }
    await this.scheduleAlarm();
    const mission = await this.getMission(job.mission_id);
    return json({ job: { ...job, context: { ...job.context, mission } } });
  }

  async presence(request) {
    this.assertMissionExecutionEnabled();
    const scope = this.package3ProbeContext;
    if (!scope || scope.probe_type !== 'readonly_git_status' || scope.status !== 'active') {
      return error('worker_presence_requires_readonly_pilot_scope', 403);
    }
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const workerId = String(body && body.worker_id || '');
    if (!package3ProbeWorkerIdAllowed(scope, workerId) || !['idle', 'working'].includes(String(body && body.state || ''))) {
      return error('worker_presence_scope_mismatch', 403);
    }
    const scopeKey = 'package3:probe:' + scope.probe_id;
    const current = await this.ctx.storage.get(scopeKey);
    if (!current || current.status !== 'active' || Date.parse(current.expires_at) <= Date.now() ||
        current.mission_id !== scope.mission_id) return this.pausedResponse();
    current.presence_count = Number(current.presence_count || 0) + 1;
    current.last_presence_at = nowIso();
    current.last_presence_state = String(body.state);
    current.last_presence_worker_id = workerId;
    await this.ctx.storage.put(scopeKey, current);
    return json({ ok: true, presence_count: current.presence_count, last_presence_at: current.last_presence_at });
  }

  async heartbeat(jobId, request) {
    this.assertMissionExecutionEnabled();
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const job = await this.ctx.storage.get('job:' + jobId);
    if (!job) return error('job_not_found', 404);
    if (job.status !== 'leased' || job.worker_id !== body.worker_id || job.lease_token !== body.lease_token) return error('lease_mismatch', 409);
    const leaseMs = this.package3ProbeContext
      ? PACKAGE3_PROBE_LEASE_MS
      : Math.max(5000, Number(this.env.ARIA_WORKER_LEASE_MS) || 60000);
    job.lease_until = new Date(Date.now() + leaseMs).toISOString();
    job.heartbeat_count = Number(job.heartbeat_count || 0) + 1;
    job.last_heartbeat_at = nowIso();
    job.updated_at = job.last_heartbeat_at;
    await this.ctx.storage.put('job:' + jobId, job);
    await this.ctx.storage.setAlarm(Date.now() + this.alarmMs);
    return json({ ok: true, lease_until: job.lease_until });
  }

  async complete(jobId, request) {
    this.assertMissionExecutionEnabled();
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const job = await this.ctx.storage.get('job:' + jobId);
    if (!job) return error('job_not_found', 404);
    if (job.status !== 'leased' || job.worker_id !== body.worker_id || job.lease_token !== body.lease_token) return error('lease_mismatch', 409);
    const mission = await this.getMission(job.mission_id);
    if (!mission) return error('mission_not_found', 404);
    const result = body.result && typeof body.result === 'object' ? body.result : {};
    job.status = 'completed';
    job.result = result.passed === false
      ? { passed: false, error_code: classifyTaskFailure(result.error).error_code }
      : clone(result);
    job.updated_at = nowIso();
    await this.ctx.storage.put('job:' + jobId, job);

    if (job.operation === 'mission.plan' || job.operation === 'mission.replan') {
      const planned = result.evidence && result.evidence.tasks;
      if (result.passed !== true || !Array.isArray(planned)) return this.failAfterResult(job, mission, 'planner_result_invalid');
      let tasks;
      try {
        const priorIds = job.operation === 'mission.replan' ? new Set(mission.tasks.map(task => task.task_id)) : new Set();
        tasks = normalizeTasks(planned, priorIds);
      } catch (err) {
        return this.failAfterResult(job, mission, String(err.message || err));
      }
      if (this.package3ProbeContext && job.operation === 'mission.plan') {
        const expectedPath = 'package3-proof-' + this.package3ProbeContext.probe_id + '.txt';
        if (planned.length !== 1 ||
            planned[0]?.operation !== 'workspace.write' ||
            planned[0]?.payload?.relative_path !== expectedPath ||
            typeof planned[0]?.payload?.content !== 'string' ||
            planned[0].payload.content.length < 1 ||
            planned[0].payload.content.length > 200) {
          return this.failAfterResult(job, mission, 'package3_probe_plan_scope_violation');
        }
      }
      if (job.operation === 'mission.replan') {
        const failedTasks = mission.tasks.filter(task => task.status === 'failed');
        const replacements = new Map();
        for (const replacement of tasks) {
          if (!replacement.replaces_task_id) continue;
          const target = failedTasks.find(task => task.task_id === replacement.replaces_task_id);
          if (!target || replacements.has(target.task_id)) return this.failAfterResult(job, mission, 'replan_replacement_target_invalid');
          replacements.set(target.task_id, replacement.task_id);
        }
        if (failedTasks.some(task => !replacements.has(task.task_id))) return this.failAfterResult(job, mission, 'replan_failed_task_replacement_required');
        for (const [taskId, replacementId] of replacements) {
          const task = mission.tasks.find(item => item.task_id === taskId);
          task.replacement_task_id = replacementId;
        }
        mission.tasks.push(...tasks);
        mission.replans = (mission.replans || 0) + 1;
      } else {
        mission.tasks = tasks;
      }
      mission.status = 'running';
      mission.plan_kind = null;
      mission.current_task_id = null;
      mission.last_error = null;
      await this.saveMission(mission, job.operation === 'mission.plan' ? 'mission_planned' : 'mission_replanned', { task_count: tasks.length, job_id: job.job_id });
      await this.scheduleNext(mission);
      await this.scheduleAlarm();
      return json({ ok: true, mission });
    }

    if (job.operation === 'task.execute') {
      const task = mission.tasks.find(item => item.task_id === job.task_id);
      if (!task) return this.failAfterResult(job, mission, 'task_not_found');
      if (result.passed !== true) return this.handleTaskFailure(job, mission, task, String(result.error || 'task_result_not_passed'));
      if (this.package3ProbeContext) {
        const evidence = result.evidence && typeof result.evidence === 'object' ? result.evidence : {};
        if (this.package3ProbeContext.probe_type === 'readonly_git_status') {
          if (job.task?.operation !== 'git.status' || evidence.operation !== 'git.status' ||
              typeof evidence.output !== 'string' || !hasTaskEvidence({ operation: 'git.status', evidence: [evidence] })) {
            return this.failAfterResult(job, mission, 'readonly_git_status_evidence_invalid');
          }
        } else {
          const expectedPath = 'package3-proof-' + this.package3ProbeContext.probe_id + '.txt';
          if (job.task?.operation !== 'workspace.write' ||
              evidence.relative_path !== expectedPath ||
              !/^[a-f0-9]{64}$/.test(String(evidence.sha256 || '')) ||
              evidence.execution_attempt !== 2 ||
              evidence.write_action !== 'already_identical') {
            return this.failAfterResult(job, mission, 'package3_probe_artifact_evidence_invalid');
          }
        }
      }
      task.status = 'succeeded';
      task.completed_at = nowIso();
      task.completed_event_sequence = (Number(mission.event_sequence) || 0) + 1;
      task.completed_job_id = job.job_id;
      task.evidence = [clone(result.evidence == null ? { result: 'passed_without_detail' } : result.evidence)];
      task.last_error = null;
      if (hasTaskEvidence(task)) {
        for (const replaced of mission.tasks.filter(item => item.status === 'failed' && item.replacement_task_id === task.task_id)) {
          replaced.status = 'skipped';
          replaced.superseded_by_task_id = task.task_id;
          replaced.last_error = null;
        }
      }
      mission.current_task_id = null;
      mission.last_error = null;
      await this.saveMission(mission, 'task_succeeded', { task_id: task.task_id, evidence: task.evidence });
      await this.scheduleNext(mission);
      await this.scheduleAlarm();
      return json({ ok: true, mission });
    }

    if (job.operation === 'mission.verify') {
      const verification = result.evidence && result.evidence.verification;
      const unresolvedTaskIds = mission.tasks
        .filter(task => !['succeeded', 'skipped'].includes(task.status) ||
          (task.status === 'skipped' && task.superseded_by_task_id &&
            !mission.tasks.some(replacement => replacement.task_id === task.superseded_by_task_id && replacement.status === 'succeeded')))
        .map(task => task.task_id);
      const missingEvidenceTaskIds = mission.tasks
        .filter(task => task.status === 'succeeded' && !hasTaskEvidence(task))
        .map(task => task.task_id);
      const readonlyPilotScope = this.package3ProbeContext?.probe_type === 'readonly_git_status' &&
        this.package3ProbeContext.mission_id === mission.mission_id ? this.package3ProbeContext : null;
      const verificationJobs = readonlyPilotScope
        ? await Promise.all((readonlyPilotScope.allowed_job_ids || []).map(jobId => this.ctx.storage.get('job:' + jobId)))
        : Array.from((await this.ctx.storage.list({ prefix: 'job:' })).values());
      const activeJobIds = verificationJobs.filter(item => item && item.mission_id === mission.mission_id && ACTIVE_JOB_STATES.has(item.status))
        .map(item => item.job_id);
      const completionInvariantFailures = {
        unresolved_task_ids: unresolvedTaskIds,
        missing_evidence_task_ids: missingEvidenceTaskIds,
        active_job_ids: activeJobIds
      };
      const completionInvariantsPassed = unresolvedTaskIds.length === 0 &&
        missingEvidenceTaskIds.length === 0 && activeJobIds.length === 0;
      mission.verification = clone(verification || { passed: false, reason: 'verification_result_missing' });
      let package3ProofVerified = true;
      if (this.package3ProbeContext?.probe_type === 'readonly_git_status') {
        const task = mission.tasks.find(item => item.task_id === 'readonly-pilot-git-status');
        const evidence = task?.evidence?.[0];
        package3ProofVerified = Boolean(
          task && task.operation === 'git.status' && task.status === 'succeeded' &&
          hasTaskEvidence({ operation: 'git.status', evidence: [evidence] }) && typeof evidence.output === 'string'
        );
        if (package3ProofVerified) {
          const completedJob = await this.ctx.storage.get('job:' + task.completed_job_id);
          mission.verification = clone({
            ...verification,
            pilot_operation: 'git.status',
            read_only: true,
            heartbeat_count: Number(completedJob && completedJob.heartbeat_count || 0)
          });
        }
      } else if (this.package3ProbeContext) {
        const task = mission.tasks.find(item => item.operation === 'workspace.write');
        const taskEvidence = task?.evidence?.[0];
        const artifact = verification?.artifact;
        package3ProofVerified = Boolean(
          taskEvidence &&
          artifact &&
          artifact.independent_read === true &&
          artifact.relative_path === 'package3-proof-' + this.package3ProbeContext.probe_id + '.txt' &&
          artifact.sha256 === taskEvidence.sha256
        );
      }
      if (result.passed === true && verification && verification.passed === true && package3ProofVerified && completionInvariantsPassed) {
        mission.status = 'succeeded';
        mission.progress_percent = 100;
        mission.last_error = null;
        await this.saveMission(mission, 'mission_verified_complete', { verification: mission.verification });
        await this.notify({ type: 'mission_completed', mission_id: mission.mission_id, details: String(verification.reason || 'verified') });
      } else {
        mission.status = 'waiting_human';
        mission.last_error = !completionInvariantsPassed
          ? 'mission_completion_invariants_failed'
          : String(verification && verification.reason || 'final_verification_failed');
        await this.saveMission(mission, 'mission_verification_failed', {
          verification: mission.verification,
          completion_invariants: completionInvariantFailures
        });
        await this.notify({
          type: 'human_intervention_required',
          mission_id: mission.mission_id,
          reason: !completionInvariantsPassed ? 'mission_completion_invariants_failed' : 'final_verification_failed',
          details: !completionInvariantsPassed ? JSON.stringify(completionInvariantFailures) : mission.last_error
        });
      }
      await this.scheduleAlarm();
      return json({ ok: true, mission });
    }
    return this.failAfterResult(job, mission, 'unsupported_job_operation');
  }

  async failAfterResult(job, mission, reason) {
    this.assertMissionExecutionEnabled();
    const errorCode = classifyTaskFailure(reason).error_code;
    job.status = 'failed';
    job.last_error = errorCode;
    job.result = { passed: false, error_code: errorCode };
    job.updated_at = nowIso();
    await this.ctx.storage.put('job:' + job.job_id, job);
    mission.last_error = errorCode;
    mission.status = 'waiting_human';
    mission.current_task_id = null;
    await this.saveMission(mission, 'mission_worker_result_rejected', { job_id: job.job_id, reason: errorCode });
    await this.notify({ type: 'human_intervention_required', mission_id: mission.mission_id, reason: errorCode, details: errorCode });
    await this.scheduleAlarm();
    return error(reason, 422);
  }

  async handleTaskFailure(job, mission, task, reason) {
    this.assertMissionExecutionEnabled();
    const classification = classifyTaskFailure(reason);
    const fingerprint = [task.operation, classification.category, classification.error_code].map(value => safeDiagnosticLabel(value) || 'unknown').join(':');
    task.failure_fingerprint_counts = task.failure_fingerprint_counts && typeof task.failure_fingerprint_counts === 'object'
      ? task.failure_fingerprint_counts
      : {};
    const fingerprintAttempts = (Number(task.failure_fingerprint_counts[fingerprint]) || 0) + 1;
    task.failure_fingerprint_counts[fingerprint] = fingerprintAttempts;
    const recovery = task.idempotent === true && classification.retryable && task.attempts < task.max_attempts && fingerprintAttempts < task.max_attempts
      ? 'retry'
      : task.idempotent === true && (mission.replans || 0) < 2
        ? 'bounded_replan'
        : 'human_intervention';
    const diagnostic = {
      phase: 'task_execution',
      agent: safeDiagnosticLabel(job.worker_id),
      provider: safeDiagnosticLabel(job.provider || job.result && job.result.provider),
      model: safeDiagnosticLabel(job.model || job.result && job.result.model),
      error_category: classification.category,
      error_code: classification.error_code,
      attempts: task.attempts,
      fingerprint_attempts: fingerprintAttempts,
      recovery,
      fingerprint
    };
    task.last_error = classification.error_code;
    task.last_attempt_finished_at = nowIso();
    task.failure_event_sequence = (Number(mission.event_sequence) || 0) + 1;
    task.failure_transition_id = [task.task_id, task.attempts, fingerprint].map(value => safeDiagnosticLabel(value) || 'unknown').join(':');
    task.failure_diagnostics = [...(Array.isArray(task.failure_diagnostics) ? task.failure_diagnostics : []), diagnostic].slice(-5);
    mission.current_task_id = null;
    job.status = 'failed';
    job.last_error = task.last_error;
    job.result = { passed: false, error_code: classification.error_code };
    job.updated_at = nowIso();
    await this.ctx.storage.put('job:' + job.job_id, job);
    if (recovery === 'retry') {
      task.status = 'pending';
      await this.saveMission(mission, 'task_retrying', { task_id: task.task_id, diagnostic });
      await this.scheduleNext(mission);
      await this.scheduleAlarm();
      return json({ ok: true, retrying: true, mission });
    }
    task.status = 'failed';
    if (recovery === 'bounded_replan') {
      task.status = 'failed';
      task.last_error = classification.error_code;
      mission.status = 'planning';
      mission.plan_kind = 'replan';
      mission.last_error = classification.error_code;
      await this.saveMission(mission, 'mission_replan_started', { task_id: task.task_id, diagnostic });
      await this.createJob(mission, 'mission.replan', null, { reason: classification.error_code });
      await this.scheduleAlarm();
      return json({ ok: true, replanning: true, mission });
    }
    task.status = task.idempotent === false && classification.retryable ? 'waiting_human' : 'failed';
    task.ambiguous_result = task.idempotent === false && classification.retryable;
    if (task.ambiguous_result) task.ambiguous_transition_id = task.failure_transition_id;
    mission.status = 'running';
    mission.last_error = classification.error_code;
    await this.saveMission(mission, 'task_failed_human_gate', { task_id: task.task_id, diagnostic });
    await this.notify({
      type: task.ambiguous_result ? 'ambiguous_result' :
        ['configuration', 'capacity'].includes(classification.category) ? 'configuration_issue' : 'human_intervention_required',
      mission_id: mission.mission_id,
      task_id: task.task_id,
      reason: task.ambiguous_result ? 'ambiguous_non_idempotent_result' : classification.error_code,
      error_code: classification.error_code,
      fingerprint,
      transition_id: task.ambiguous_result ? task.ambiguous_transition_id : task.failure_transition_id,
      details: JSON.stringify(diagnostic)
    });
    await this.scheduleNext(mission);
    await this.scheduleAlarm();
    return json({ ok: true, waiting_human: true, mission });
  }

  async fail(jobId, request) {
    this.assertMissionExecutionEnabled();
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const job = await this.ctx.storage.get('job:' + jobId);
    if (!job) return error('job_not_found', 404);
    if (job.status !== 'leased' || job.worker_id !== body.worker_id || job.lease_token !== body.lease_token) return error('lease_mismatch', 409);
    const mission = await this.getMission(job.mission_id);
    if (!mission) return error('mission_not_found', 404);
    const failureReason = String(body.error || 'worker_execution_failed').slice(0, 1000);
    const failureCode = classifyTaskFailure(failureReason).error_code;
    job.status = 'failed';
    job.last_error = failureCode;
    job.result = { passed: false, error_code: failureCode };
    job.updated_at = nowIso();
    await this.ctx.storage.put('job:' + jobId, job);
    if (job.operation === 'task.execute') {
      const task = mission.tasks.find(item => item.task_id === job.task_id);
      if (!task) return error('task_not_found', 404);
      return this.handleTaskFailure(job, mission, task, failureReason);
    }
    mission.status = 'waiting_human';
    mission.current_task_id = null;
    mission.last_error = failureCode;
    await this.saveMission(mission, 'worker_job_failed_human_gate', { job_id: job.job_id, error: failureCode });
    await this.notify({
      type: ['provider_or_auth_configuration', 'provider_capacity'].includes(failureCode) ? 'configuration_issue' : 'human_intervention_required',
      mission_id: mission.mission_id,
      reason: failureCode,
      error_code: failureCode,
      details: failureCode
    });
    await this.scheduleAlarm();
    return json({ ok: true, waiting_human: true, mission });
  }

  async scheduleNext(mission) {
    this.assertMissionExecutionEnabled();
    if (mission.status !== 'running') return;
    if (mission.current_task_id) {
      const current = mission.tasks.find(task => task.task_id === mission.current_task_id);
      if (current && ['running', 'pending'].includes(current.status)) return;
      mission.current_task_id = null;
    }
    const dependencySatisfied = dep => {
      const parent = mission.tasks.find(item => item.task_id === dep);
      return parent && (parent.status === 'succeeded' ||
        (parent.status === 'skipped' && parent.superseded_by_task_id &&
          mission.tasks.some(replacement => replacement.task_id === parent.superseded_by_task_id && replacement.status === 'succeeded')));
    };
    const ready = mission.tasks.filter(task => task.status === 'pending' && task.depends_on.every(dependencySatisfied));
    const dependencyGateStillOpen = mission.tasks.some(task => task.status === 'pending' && !task.depends_on.every(dependencySatisfied));
    if (!dependencyGateStillOpen) mission.dependency_gate_transition_id = null;
    const requiresApproval = task => {
      const risk = parseRisk(task.risk);
      const maxRisk = parseRisk(mission.policy && mission.policy.max_risk || 'medium');
      const riskRank = { low: 0, medium: 1, high: 2, critical: 3 };
      return task.approved !== true && (task.irreversible || riskRank[risk] >= riskRank.high || (mission.policy && mission.policy.require_human_approval !== false && riskRank[risk] > riskRank[maxRisk]));
    };
    const pending = ready.find(task => !requiresApproval(task));
    const approvalTask = ready.find(requiresApproval);
    if (approvalTask && !(mission.approval && mission.approval.status === 'pending')) {
      approvalTask.status = 'waiting_human';
      mission.approval = {
        approval_id: uuid('approval'),
        status: 'pending',
        task_id: approvalTask.task_id,
        task_title: approvalTask.title,
        reason: approvalTask.irreversible ? 'Irreversible action requires approval.' : 'Task risk exceeds mission policy.',
        created_at: nowIso()
      };
      await this.saveMission(mission, 'human_approval_required', { approval: mission.approval });
      await this.notify({ type: 'human_approval_required', mission_id: mission.mission_id, task_id: approvalTask.task_id, approval_id: mission.approval.approval_id, reason: mission.approval.reason, transition_id: mission.approval.approval_id });
      if (pending) return this.scheduleNext(mission);
      mission.status = 'waiting_human';
      return this.saveMission(mission, 'mission_waiting_for_human_gate', { task_id: approvalTask.task_id, approval_id: mission.approval.approval_id });
    }
    if (pending) {
      pending.status = 'running';
      pending.attempts += 1;
      mission.current_task_id = pending.task_id;
      await this.saveMission(mission, 'task_started', { task_id: pending.task_id, attempts: pending.attempts });
      await this.createJob(mission, 'task.execute', pending);
      return;
    }
    const unresolved = mission.tasks.filter(task => !['succeeded', 'skipped'].includes(task.status));
    if (!unresolved.length) {
      mission.current_task_id = null;
      await this.createJob(mission, 'mission.verify', null);
    } else {
      const blocked = mission.tasks.filter(task => task.status === 'pending');
      const failed = mission.tasks.filter(task => task.status === 'failed');
      if (blocked.length) {
        mission.status = 'waiting_human';
        mission.last_error = 'Task dependency graph is blocked.';
        if (!mission.dependency_gate_transition_id) mission.dependency_gate_transition_id = uuid('dependency_transition');
        await this.saveMission(mission, 'mission_dependency_blocked', { task_ids: blocked.map(task => task.task_id) });
        await this.notify({ type: 'human_intervention_required', mission_id: mission.mission_id, reason: 'task_dependency_blocked', transition_id: mission.dependency_gate_transition_id, details: mission.last_error });
      } else if (failed.length) {
        mission.status = 'waiting_human';
        mission.last_error = 'Failed tasks require replanning or intervention.';
        await this.saveMission(mission, 'mission_failed_tasks_need_intervention', { task_ids: failed.map(task => task.task_id) });
        await this.notify({ type: 'human_intervention_required', mission_id: mission.mission_id, reason: 'failed_tasks_need_intervention', details: failed.map(task => task.task_id).join(', ') });
      } else if (mission.tasks.some(task => task.status === 'waiting_human')) {
        mission.status = 'waiting_human';
        await this.saveMission(mission, 'mission_waiting_for_human_gate', {
          task_ids: mission.tasks.filter(task => task.status === 'waiting_human').map(task => task.task_id),
          approval_id: mission.approval && mission.approval.approval_id || null
        });
      }
    }
  }

  async decideApproval(approvalId, request) {
    this.assertMissionExecutionEnabled();
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    if (!['approved', 'rejected'].includes(body.decision)) return error('approval_decision_invalid', 400);
    const records = await this.ctx.storage.list({ prefix: 'mission:' });
    const mission = Array.from(records.values()).find(item => item.approval && item.approval.approval_id === approvalId);
    if (!mission) return error('approval_not_found', 404);
    if (mission.approval.status !== 'pending' || !['running', 'waiting_human'].includes(mission.status)) return error('approval_not_pending', 409);
    mission.approval.status = body.decision;
    mission.approval.decided_at = nowIso();
    mission.approval.decided_by = String(body.actor || 'dashboard-operator').slice(0, 200);
    const approvalDecision = clone(mission.approval);
    const task = mission.tasks.find(item => item.task_id === mission.approval.task_id);
    if (body.decision === 'rejected') {
      if (task) { task.status = 'failed'; task.human_rejected = true; task.last_error = 'Human approval rejected.'; }
      mission.approval = null;
      mission.status = 'running';
      mission.last_error = null;
      await this.saveMission(mission, 'human_approval_rejected', { approval: approvalDecision });
      await this.notify({ type: 'mission_rejected', mission_id: mission.mission_id, task_id: task && task.task_id || null, approval_id: approvalId, reason: 'Human approval rejected.', transition_id: approvalId });
      await this.scheduleNext(mission);
      await this.scheduleAlarm();
      return json({ ok: true, mission });
    }
    if (task) { task.status = 'pending'; task.last_error = null; task.approved = true; }
    mission.status = 'running';
    mission.last_error = null;
    await this.saveMission(mission, 'human_approval_granted', { approval: mission.approval });
    mission.approval = null;
    await this.scheduleNext(mission);
    await this.scheduleAlarm();
    return json({ ok: true, mission });
  }

  async verifyAmbiguousWriteReadback(mission, task, readbackTaskId) {
    if (task.operation !== 'workspace.write' || typeof task.payload?.path !== 'string' || typeof task.payload?.content !== 'string' ||
        !readbackTaskId || readbackTaskId === task.task_id) return null;
    const readbackTask = mission.tasks.find(candidate => candidate.task_id === String(readbackTaskId));
    if (!readbackTask || readbackTask.operation !== 'workspace.read' || readbackTask.idempotent !== true ||
        readbackTask.status !== 'succeeded' || readbackTask.payload?.path !== task.payload.path || !hasTaskEvidence(readbackTask)) return null;
    const evidence = readbackTask.evidence[readbackTask.evidence.length - 1];
    const canonicalPath = value => String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (canonicalPath(evidence.path) !== canonicalPath(task.payload.path) || evidence.truncated === true ||
        evidence.content !== task.payload.content || evidence.bytes !== new TextEncoder().encode(task.payload.content).length) return null;

    const jobRecords = await this.ctx.storage.list({ prefix: 'job:' });
    const readbackJobs = Array.from(jobRecords.values())
      .filter(job => job.mission_id === mission.mission_id && job.operation === 'task.execute' && job.task_id === readbackTask.task_id)
      .sort((left, right) => String(right.updated_at || right.created_at).localeCompare(String(left.updated_at || left.created_at)));
    const readbackJob = readbackJobs.find(job => job.status === 'completed' && job.result?.passed === true);
    const failureEventSequence = Number(task.failure_event_sequence);
    const readbackEventSequence = Number(readbackTask.completed_event_sequence);
    if (!readbackJob || !Number.isSafeInteger(failureEventSequence) || !Number.isSafeInteger(readbackEventSequence) ||
        readbackEventSequence <= failureEventSequence || readbackTask.completed_job_id !== readbackJob.job_id ||
        readbackJob.result.evidence?.operation !== 'workspace.read' ||
        canonicalPath(readbackJob.result.evidence.path) !== canonicalPath(task.payload.path) ||
        readbackJob.result.evidence.content !== evidence.content ||
        readbackJob.result.evidence.bytes !== evidence.bytes || readbackJob.result.evidence.truncated !== evidence.truncated) return null;
    return {
      task_id: readbackTask.task_id,
      job_id: readbackJob.job_id,
      path: canonicalPath(task.payload.path),
      bytes: evidence.bytes,
      sha256: await sha256Hex(task.payload.content)
    };
  }

  async resume(missionId, request) {
    this.assertMissionExecutionEnabled();
    const mission = await this.getMission(missionId);
    if (!mission) return error('mission_not_found', 404);
    if (mission.status !== 'waiting_human' || (mission.approval && mission.approval.status === 'pending')) return error('mission_not_resumable', 409);
    let body = {};
    try { body = await request.json(); } catch (_) {}
    const actor = String(body.actor || 'dashboard-operator').slice(0, 200);
    const explicitReplayActor = typeof body.actor === 'string' && body.actor.trim().length > 0;
    const reconciliations = [];
    for (const item of Array.isArray(body.reconcile_tasks) ? body.reconcile_tasks : []) {
      const task = mission.tasks.find(candidate => candidate.task_id === String(item && item.task_id || ''));
      if (!task || task.ambiguous_result !== true || item.outcome !== 'completed' || !explicitReplayActor) {
        return error('ambiguous_task_reconciliation_invalid', 422);
      }
      const readback = await this.verifyAmbiguousWriteReadback(mission, task, item.readback_task_id);
      if (!readback) return error(item.outcome === 'not_applied' ? 'ambiguous_not_applied_requires_explicit_replay' : 'ambiguous_task_readback_required', 422);
      reconciliations.push({ task, readback });
    }
    for (const { task, readback } of reconciliations) {
      task.ambiguous_result = false;
      task.reconciled_at = nowIso();
      task.reconciled_by = actor;
      task.status = 'succeeded';
      task.evidence = [{
        operation: 'workspace.write',
        path: readback.path,
        backup: null,
        bytes_written: readback.bytes,
        sha256: readback.sha256
      }];
      task.reconciled_via_readback_task_id = readback.task_id;
      task.reconciled_via_readback_job_id = readback.job_id;
      task.ambiguous_transition_id = null;
      task.last_error = null;
    }
    for (const item of Array.isArray(body.replay_authorizations) ? body.replay_authorizations : []) {
      const task = mission.tasks.find(candidate => candidate.task_id === String(item && item.task_id || ''));
      if (!task || task.idempotent !== false || task.ambiguous_result !== true ||
          item.confirmation !== 'REPLAY_THIS_NON_IDEMPOTENT_TASK' || !explicitReplayActor) return error('ambiguous_task_replay_authorization_invalid', 422);
      task.status = 'pending';
      task.ambiguous_result = false;
      task.replay_authorized_at = nowIso();
      task.replay_authorized_by = actor;
      task.replay_authorization = 'explicit_task_scoped_human_confirmation';
      task.ambiguous_transition_id = null;
      task.last_error = null;
    }
    for (const task of mission.tasks) {
      if (task.status === 'waiting_human' || task.status === 'failed') {
        if (task.ambiguous_result === true || task.human_rejected === true) continue;
        if (task.status === 'failed' && task.idempotent !== true) continue;
        task.status = 'pending';
        task.last_error = null;
      }
    }
    mission.status = 'running';
    mission.last_error = null;
    mission.current_task_id = null;
    mission.approval = null;
    mission.manual_resume_at = nowIso();
    mission.manual_resume_by = actor;
    await this.saveMission(mission, 'mission_resumed_after_human_review', {
      actor: mission.manual_resume_by,
      reconciled_task_ids: reconciliations.map(item => item.task.task_id),
      replay_task_ids: (Array.isArray(body.replay_authorizations) ? body.replay_authorizations : []).map(item => String(item && item.task_id || '')).filter(Boolean)
    });
    await this.scheduleNext(mission);
    await this.scheduleAlarm();
    return json({ ok: true, mission });
  }

  async reconcileCurrentTask(mission, scope = null) {
    if (!mission.current_task_id) return false;
    const task = mission.tasks.find(item => item.task_id === mission.current_task_id);
    if (!task || !['running', 'pending'].includes(task.status)) return false;
    const records = scope
      ? new Map((await Promise.all((scope.allowed_job_ids || []).map(async jobId => [jobId, await this.ctx.storage.get('job:' + jobId)]))).filter(([, job]) => Boolean(job)))
      : await this.ctx.storage.list({ prefix: 'job:' });
    const taskJobs = Array.from(records.values())
      .filter(job => job.mission_id === mission.mission_id && job.operation === 'task.execute' && job.task_id === task.task_id)
      .sort((left, right) => String(right.updated_at || right.created_at).localeCompare(String(left.updated_at || left.created_at)));
    if (taskJobs.some(job => ACTIVE_JOB_STATES.has(job.status))) return false;

    const latest = taskJobs[0];
    if (latest && latest.status === 'completed') {
      const result = latest.result && typeof latest.result === 'object' ? latest.result : {};
      if (result.passed === true && hasTaskEvidence({ operation: task.operation, evidence: [result.evidence] })) {
        task.status = 'succeeded';
        task.evidence = [clone(result.evidence)];
        task.last_error = null;
        mission.current_task_id = null;
        mission.last_error = null;
        await this.saveMission(mission, 'task_succeeded_recovered_from_job', {
          task_id: task.task_id,
          job_id: latest.job_id,
          attempts: latest.attempts
        });
        return true;
      }
      await this.handleTaskFailure(latest, mission, task, String(result.error || 'completed_task_result_invalid'));
      return true;
    }
    if (latest && latest.status === 'failed') {
      await this.handleTaskFailure(latest, mission, task, String(latest.last_error || 'task_job_failed_before_checkpoint'));
      return true;
    }

    mission.current_task_id = null;
    if (task.idempotent === true && task.attempts < task.max_attempts) {
      task.status = 'pending';
      task.last_error = 'task_job_missing_requeued_after_reconciliation';
      await this.saveMission(mission, 'task_requeued_after_missing_job', { task_id: task.task_id, attempts: task.attempts });
      return true;
    }

    task.status = 'waiting_human';
    task.ambiguous_result = true;
    task.last_error = 'task_job_missing_non_idempotent';
    task.last_attempt_finished_at = nowIso();
    task.ambiguous_transition_id = [task.task_id, task.attempts, task.last_error].map(value => safeDiagnosticLabel(value) || 'unknown').join(':');
    mission.last_error = task.last_error;
    await this.saveMission(mission, 'task_job_missing_requires_human', { task_id: task.task_id, idempotent: false });
    await this.notify({ type: 'ambiguous_result', mission_id: mission.mission_id, task_id: task.task_id, reason: 'ambiguous_non_idempotent_result', error_code: task.last_error, transition_id: task.ambiguous_transition_id });
    return true;
  }

  async reconcile() {
    const scope = this.package3ProbeContext;
    const scopedReadonlyPilot = this.isMissionExecutionPaused() && scope?.probe_type === 'readonly_git_status' && scope.status === 'active';
    if (this.isMissionExecutionPaused() && !scopedReadonlyPilot) return false;
    const jobs = scopedReadonlyPilot
      ? new Map((await Promise.all((scope.allowed_job_ids || []).map(async jobId => [jobId, await this.ctx.storage.get('job:' + jobId)]))).filter(([, job]) => Boolean(job)))
      : await this.ctx.storage.list({ prefix: 'job:' });
    for (const job of jobs.values()) {
      if (scopedReadonlyPilot && !package3ProbeJobAllowed(scope, job)) continue;
      if (job.status === 'leased' && job.lease_until && Date.parse(job.lease_until) <= Date.now()) {
        job.status = 'queued';
        job.worker_id = null;
        job.lease_token = null;
        job.lease_until = null;
        job.updated_at = nowIso();
        await this.ctx.storage.put('job:' + job.job_id, job);
      }
    }
    const missions = scopedReadonlyPilot
      ? new Map([[scope.mission_id, await this.ctx.storage.get('mission:' + scope.mission_id)]])
      : await this.ctx.storage.list({ prefix: 'mission:' });
    for (const mission of missions.values()) {
      if (!mission || (scopedReadonlyPilot && mission.mission_id !== scope.mission_id)) continue;
      if (mission.status === 'planning') {
        if (scopedReadonlyPilot) continue;
        await this.createJob(mission, mission.plan_kind === 'replan' ? 'mission.replan' : 'mission.plan', null, { reason: mission.last_error || 'recovery' });
      } else if (mission.status === 'running') {
        await this.reconcileCurrentTask(mission, scopedReadonlyPilot ? scope : null);
        if (mission.status === 'running') await this.scheduleNext(mission);
      }
    }
    await this.scheduleAlarm();
  }

  async alarm() {
    if (this.isMissionExecutionPaused()) {
      const a3ProbeId = await this.ctx.storage.get('mw2:a3:presence:active-probe');
      if (typeof a3ProbeId === 'string' && MISSION_WONDER_2_A3_PRESENCE_ID_PATTERN.test(a3ProbeId)) {
        const a3Scope = await this.ctx.storage.get('mw2:a3:presence:' + a3ProbeId);
        if (!a3Scope || a3Scope.status !== 'active') return;
        if (Date.parse(a3Scope.expires_at) <= Date.now()) {
          await this.expireMissionWonder2A3PresenceProbe(a3ProbeId, 'presence_probe_ttl_expired');
          return;
        }
        const lastPresenceAt = Date.parse(a3Scope.last_presence_at || '');
        if ((!Number.isFinite(lastPresenceAt) || Date.now() - lastPresenceAt > Number(a3Scope.stale_after_ms)) && !a3Scope.stale_detected_at) {
          a3Scope.stale_detected_at = nowIso();
        }
        a3Scope.alarm_tick_count = Number(a3Scope.alarm_tick_count || 0) + 1;
        a3Scope.last_alarm_at = nowIso();
        await this.ctx.storage.put('mw2:a3:presence:' + a3ProbeId, a3Scope);
        await this.ctx.storage.setAlarm(Date.now() + this.alarmMs);
        return;
      }
      const activeProbeId = await this.ctx.storage.get('package3:readonly-pilot:active-probe');
      if (typeof activeProbeId !== 'string' || !PACKAGE3_PROBE_ID_PATTERN.test(activeProbeId)) return;
      const activeScope = await this.ctx.storage.get('package3:probe:' + activeProbeId);
      if (!activeScope || activeScope.probe_type !== 'readonly_git_status' || activeScope.status !== 'active') return;
      if (Date.parse(activeScope.expires_at) <= Date.now()) {
        await this.exclusive(() => this.closePackage3Probe(new Request('https://aria.internal/api/package3/probe/close', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ probe_id: activeProbeId, reason: 'readonly_pilot_ttl_expired' })
        })), { probeScope: activeScope });
        return;
      }
      await this.exclusive(async () => {
        const scopeKey = 'package3:probe:' + activeScope.probe_id;
        const current = await this.ctx.storage.get(scopeKey);
        if (!current || current.status !== 'active' || Date.parse(current.expires_at) <= Date.now()) return;
        current.alarm_tick_count = Number(current.alarm_tick_count || 0) + 1;
        current.last_alarm_at = nowIso();
        await this.ctx.storage.put(scopeKey, current);
        await this.reconcile();
      }, { probeScope: activeScope });
      return;
    }
    await this.exclusive(() => this.reconcile());
    const notices = await this.ctx.storage.list({ prefix: 'notification:' });
    const pending = Array.from(notices.values()).filter(item => ['pending', 'waiting_config'].includes(item.status)).slice(0, 10);
    for (const item of pending) await this.exclusive(() => this.deliverNotification(item.notification_id));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' || url.pathname.startsWith('/api/')) {
      const id = env.ARIA_MISSIONS.idFromName('global');
      return env.ARIA_MISSIONS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  }
};
