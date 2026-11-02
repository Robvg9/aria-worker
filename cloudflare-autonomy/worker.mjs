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
const bodyRetryable = reason => /timeout|temporar|network|\b429\b|\b502\b|\b503\b|\b504\b/i.test(String(reason || ''));
const nowIso = () => new Date().toISOString();
const uuid = prefix => prefix + '_' + crypto.randomUUID();
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});
const error = (message, status = 400) => json({ error: message }, status);

const PACKAGE3_PROBE_TTL_MS = 10 * 60 * 1000;
const PACKAGE3_PROBE_LEASE_MS = 8000;
const PACKAGE3_PROBE_ALLOWED_JOB_OPERATIONS = new Set(['mission.plan', 'task.execute', 'mission.verify']);
const PACKAGE3_PROBE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,70}$/;

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
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
  return Boolean(prefix && (workerId === prefix + 'before' || workerId === prefix + 'after'));
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

    const workerRoute = url.pathname === '/api/worker/claim' || /^\/api\/worker\/jobs\/[^/]+\/(heartbeat|complete|fail)$/.test(url.pathname);
    if (workerRoute) {
      if (!authorized(request, this.env.ARIA_WORKER_TOKEN)) return error('unauthorized_worker', 401);
      if (this.isMissionExecutionPaused()) {
        if (method !== 'POST') return this.pausedResponse();
        // Preserve the legacy fail-fast contract: normal claims are rejected
        // before parsing their bodies. Only the complete scoped-probe header set
        // proceeds to body parsing and the narrow worker allowlist.
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
      if (!job || job.mission_id !== scope.mission_id ||
          !PACKAGE3_PROBE_ALLOWED_JOB_OPERATIONS.has(String(job.operation))) return null;
      if (!(Array.isArray(scope.allowed_job_ids) && scope.allowed_job_ids.includes(job.job_id))) return null;
      if (job.operation === 'task.execute' && job.task?.operation !== 'workspace.write') return null;
    }
    return scope;
  }

  async startPackage3Probe(request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    if (!body || body.confirm !== 'RUN_ONE_MISSION_WONDER_2_PACKAGE3_PROBE') {
      return error('explicit_package3_probe_confirmation_required', 400);
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
      status: 'preparing',
      mission_id: null,
      scope_token_sha256: await sha256Hex(scopeToken),
      worker_id_prefix: 'mw2p3-' + probeId + '-',
      allowed_job_ids: [],
      claim_count: 0,
      claimed_worker_ids: [],
      created_at: nowIso(),
      expires_at: new Date(Date.now() + PACKAGE3_PROBE_TTL_MS).toISOString(),
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
          goal: 'Mission Wonder 2 Package 3 LIVE synthetic recovery probe ' + probeId + ': write one temporary proof artifact, recover the same job after a process interruption, and verify its SHA-256.',
          metadata: {
            mission: 'Mission Wonder 2',
            package: 3,
            environment: 'production-live-probe',
            execution_scope: 'one-mission-one-artifact',
            package3_live_probe: true,
            probe_id: probeId
          },
          policy: {
            max_risk: 'medium',
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
      const records = await this.ctx.storage.list({ prefix: 'job:' });
      scope.allowed_job_ids = Array.from(records.values())
        .filter(job => job.mission_id === scope.mission_id)
        .map(job => String(job.job_id));
      await this.ctx.storage.put(scopeKey, scope);
      return json({
        ok: true,
        probe: {
          probe_id: probeId,
          status: scope.status,
          mission_id: scope.mission_id,
          expires_at: scope.expires_at,
          lease_ms: scope.lease_ms,
          allowed_job_operations: Array.from(PACKAGE3_PROBE_ALLOWED_JOB_OPERATIONS)
        },
        mission: createdPayload.mission
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
    const [jobRecords, eventRecords, notificationRecords] = await Promise.all([
      this.ctx.storage.list({ prefix: 'job:' }),
      scope.mission_id
        ? this.ctx.storage.list({ prefix: 'event:' + scope.mission_id + ':' })
        : Promise.resolve(new Map()),
      this.ctx.storage.list({ prefix: 'notification:' })
    ]);
    const jobs = Array.from(jobRecords.values())
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
        status: scope.status,
        mission_id: scope.mission_id,
        worker_id_prefix: scope.worker_id_prefix,
        allowed_job_ids: scope.allowed_job_ids,
        claim_count: scope.claim_count,
        claimed_worker_ids: scope.claimed_worker_ids,
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
      const jobs = await this.ctx.storage.list({ prefix: 'job:' });
      for (const job of jobs.values()) {
        if (job.mission_id !== scope.mission_id || !ACTIVE_JOB_STATES.has(job.status)) continue;
        job.status = 'cancelled';
        job.last_error = 'package3_probe_scope_closed';
        job.worker_id = null;
        job.lease_token = null;
        job.lease_until = null;
        job.updated_at = nowIso();
        await this.ctx.storage.put('job:' + job.job_id, job);
      }
      const mission = scope.mission_id ? await this.getMission(scope.mission_id) : null;
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
    const telegramRequested = Boolean(this.env.ARIA_TELEGRAM_BOT_TOKEN || this.env.ARIA_TELEGRAM_CHAT_ID);
    const telegramConfigured = Boolean(this.env.ARIA_TELEGRAM_BOT_TOKEN && this.env.ARIA_TELEGRAM_CHAT_ID);
    const webhookConfigured = Boolean(this.env.ARIA_NOTIFICATION_WEBHOOK_URL);
    const configured = telegramRequested ? telegramConfigured : webhookConfigured;
    const isPackage3Probe = Boolean(this.package3ProbeContext);
    const record = {
      notification_id: uuid('notification'),
      created_at: nowIso(),
      updated_at: nowIso(),
      status: isPackage3Probe ? 'suppressed_package3_probe' : (configured ? 'pending' : 'waiting_config'),
      attempts: 0,
      delivered_at: null,
      last_error: isPackage3Probe
        ? 'external_delivery_disabled_for_package3_probe'
        : (configured ? null : (telegramRequested ? 'telegram_configuration_incomplete' : 'notification_webhook_not_configured')),
      event: clone(event)
    };
    await this.ctx.storage.put('notification:' + record.notification_id, record);
    if (configured && !isPackage3Probe) {
      this.ctx.waitUntil((async () => {
        try {
          await this.deliverNotification(record.notification_id);
        } finally {
          await this.scheduleAlarm();
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
      record.status = 'failed';
      record.last_error = /^(telegram_|notification_webhook_)/.test(message) ? message : 'notification_webhook_url_invalid';
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
      created_at: record.created_at
    };
    const telegramText = [
      'ARIA · ' + payload.type,
      payload.mission_id ? 'Misión: ' + payload.mission_id : null,
      payload.task_id ? 'Tarea: ' + payload.task_id : null,
      payload.approval_id ? 'Aprobación: ' + payload.approval_id : null,
      payload.reason ? 'Motivo: ' + payload.reason : null,
      payload.details ? 'Detalles: ' + payload.details : null,
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
    if (this.isMissionExecutionPaused()) return false;
    const missions = await this.ctx.storage.list({ prefix: 'mission:' });
    const hasActive = Array.from(missions.values()).some(m => ACTIVE_MISSION_STATES.has(m.status));
    const jobs = await this.ctx.storage.list({ prefix: 'job:' });
    const hasJobs = Array.from(jobs.values()).some(job => ACTIVE_JOB_STATES.has(job.status));
    const notices = await this.ctx.storage.list({ prefix: 'notification:' });
    const hasPendingNotifications = Array.from(notices.values()).some(item => item.status === 'pending');
    if (hasActive || hasJobs || hasPendingNotifications) await this.ctx.storage.setAlarm(Date.now() + this.alarmMs);
  }
  async createJob(mission, operation, task, context = {}) {
    this.assertMissionExecutionEnabled();
    const jobs = await this.ctx.storage.list({ prefix: 'job:' });
    const existing = Array.from(jobs.values()).find(job =>
      job.mission_id === mission.mission_id &&
      job.operation === operation &&
      ACTIVE_JOB_STATES.has(job.status) &&
      (!task || job.task_id === task.task_id)
    );
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
    if (this.package3ProbeContext && mission.mission_id === this.package3ProbeContext.mission_id) {
      const scopeKey = 'package3:probe:' + this.package3ProbeContext.probe_id;
      const currentScope = await this.ctx.storage.get(scopeKey);
      if (currentScope && currentScope.status === 'active') {
        currentScope.allowed_job_ids = Array.from(new Set([...(currentScope.allowed_job_ids || []), job.job_id]));
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
    const policy = {
      max_risk: parseRisk(policyInput.max_risk || 'medium'),
      require_human_approval: policyInput.require_human_approval !== false,
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
        redirect: 'error',
        signal: AbortSignal.timeout(20000)
      });
    } catch (_) {
      return { ok: false, status: 503, reason: 'remote_plan_producer_unreachable' };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = String(payload && (payload.reason || payload.error) || 'remote_plan_producer_rejected').slice(0, 160);
      return { ok: false, status: response.status, reason };
    }
    if (!payload || payload.ok !== true || !Array.isArray(payload.plan && payload.plan.tasks)) {
      return { ok: false, status: 502, reason: 'remote_plan_producer_response_invalid' };
    }
    return {
      ok: true,
      tasks: payload.plan.tasks,
      planner_version: String(payload.planner_version || 'unknown'),
      contract_version: String(payload.contract_version || 'unknown')
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
      tasks: result.tasks,
      read_only_preview: true
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

  async submitPlan(missionId, request) {
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

    // The cloud planner supplies structured tasks; the Windows executor never
    // receives an LLM planning job and never needs a local model credential.
    const jobRecords = await this.ctx.storage.list({ prefix: 'job:' });
    for (const job of jobRecords.values()) {
      if (job.mission_id !== missionId ||
          !['mission.plan', 'mission.replan'].includes(job.operation) ||
          !ACTIVE_JOB_STATES.has(job.status)) continue;
      job.status = 'cancelled';
      job.worker_id = null;
      job.lease_token = null;
      job.lease_until = null;
      job.updated_at = nowIso();
      job.last_error = 'superseded_by_authenticated_remote_plan';
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
      source: 'authenticated_remote_planner',
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
    const records = await this.ctx.storage.list({ prefix: 'job:' });
    const candidate = Array.from(records.values())
      .filter(job => {
        if (probeScope) {
          if (job.mission_id !== probeScope.mission_id) return false;
          if (!Array.isArray(probeScope.allowed_job_ids) || !probeScope.allowed_job_ids.includes(job.job_id)) return false;
          if (!PACKAGE3_PROBE_ALLOWED_JOB_OPERATIONS.has(String(job.operation))) return false;
          if (job.operation === 'task.execute' && job.task?.operation !== 'workspace.write') return false;
        }
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
    job.updated_at = nowIso();
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
    job.result = clone(result);
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
        const expectedPath = 'package3-proof-' + this.package3ProbeContext.probe_id + '.txt';
        if (job.task?.operation !== 'workspace.write' ||
            evidence.relative_path !== expectedPath ||
            !/^[a-f0-9]{64}$/.test(String(evidence.sha256 || '')) ||
            evidence.execution_attempt !== 2 ||
            evidence.write_action !== 'already_identical') {
          return this.failAfterResult(job, mission, 'package3_probe_artifact_evidence_invalid');
        }
      }
      task.status = 'succeeded';
      task.evidence = [clone(result.evidence == null ? { result: 'passed_without_detail' } : result.evidence)];
      task.last_error = null;
      mission.current_task_id = null;
      mission.last_error = null;
      await this.saveMission(mission, 'task_succeeded', { task_id: task.task_id, evidence: task.evidence });
      await this.scheduleNext(mission);
      await this.scheduleAlarm();
      return json({ ok: true, mission });
    }

    if (job.operation === 'mission.verify') {
      const verification = result.evidence && result.evidence.verification;
      mission.verification = clone(verification || { passed: false, reason: 'verification_result_missing' });
      let package3ProofVerified = true;
      if (this.package3ProbeContext) {
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
      if (result.passed === true && verification && verification.passed === true && package3ProofVerified) {
        mission.status = 'succeeded';
        mission.progress_percent = 100;
        mission.last_error = null;
        await this.saveMission(mission, 'mission_verified_complete', { verification: mission.verification });
        await this.notify({ type: 'mission_completed', mission_id: mission.mission_id, details: String(verification.reason || 'verified') });
      } else {
        mission.status = 'waiting_human';
        mission.last_error = String(verification && verification.reason || 'final_verification_failed');
        await this.saveMission(mission, 'mission_verification_failed', { verification: mission.verification });
        await this.notify({ type: 'human_intervention_required', mission_id: mission.mission_id, reason: 'final_verification_failed', details: mission.last_error });
      }
      await this.scheduleAlarm();
      return json({ ok: true, mission });
    }
    return this.failAfterResult(job, mission, 'unsupported_job_operation');
  }

  async failAfterResult(job, mission, reason) {
    this.assertMissionExecutionEnabled();
    job.status = 'failed';
    job.last_error = reason;
    job.updated_at = nowIso();
    await this.ctx.storage.put('job:' + job.job_id, job);
    mission.last_error = reason;
    mission.status = 'waiting_human';
    mission.current_task_id = null;
    await this.saveMission(mission, 'mission_worker_result_rejected', { job_id: job.job_id, reason });
    await this.notify({ type: 'human_intervention_required', mission_id: mission.mission_id, reason, details: reason });
    await this.scheduleAlarm();
    return error(reason, 422);
  }

  async handleTaskFailure(job, mission, task, reason) {
    this.assertMissionExecutionEnabled();
    task.last_error = reason.slice(0, 1000);
    mission.current_task_id = null;
    job.status = 'failed';
    job.last_error = task.last_error;
    job.updated_at = nowIso();
    await this.ctx.storage.put('job:' + job.job_id, job);
    if ((task.idempotent === true || (bodyRetryable(reason))) && task.attempts < task.max_attempts) {
      task.status = 'pending';
      await this.saveMission(mission, 'task_retrying', { task_id: task.task_id, reason, attempts: task.attempts });
      await this.scheduleNext(mission);
      await this.scheduleAlarm();
      return json({ ok: true, retrying: true, mission });
    }
    task.status = 'failed';
    if ((mission.replans || 0) < 2) {
      for (const other of mission.tasks) if (other.status === 'pending') other.status = 'skipped';
      task.status = 'skipped';
      task.last_error = 'Superseded by bounded replan after: ' + reason.slice(0, 500);
      mission.status = 'planning';
      mission.plan_kind = 'replan';
      mission.last_error = reason;
      await this.saveMission(mission, 'mission_replan_started', { task_id: task.task_id, reason });
      await this.createJob(mission, 'mission.replan', null, { reason });
      await this.scheduleAlarm();
      return json({ ok: true, replanning: true, mission });
    }
    mission.status = 'waiting_human';
    mission.last_error = reason;
    await this.saveMission(mission, 'task_failed_human_gate', { task_id: task.task_id, reason });
    await this.notify({ type: 'human_intervention_required', mission_id: mission.mission_id, task_id: task.task_id, reason, details: reason });
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
    job.status = 'failed';
    job.last_error = String(body.error || 'worker_execution_failed').slice(0, 1000);
    job.updated_at = nowIso();
    await this.ctx.storage.put('job:' + jobId, job);
    if (job.operation === 'task.execute') {
      const task = mission.tasks.find(item => item.task_id === job.task_id);
      if (!task) return error('task_not_found', 404);
      return this.handleTaskFailure(job, mission, task, job.last_error);
    }
    mission.status = 'waiting_human';
    mission.current_task_id = null;
    mission.last_error = job.last_error;
    await this.saveMission(mission, 'worker_job_failed_human_gate', { job_id: job.job_id, error: job.last_error });
    await this.notify({ type: 'human_intervention_required', mission_id: mission.mission_id, reason: 'worker_job_failed', details: job.last_error });
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
    const pending = mission.tasks.find(task => task.status === 'pending' && task.depends_on.every(dep => {
      const parent = mission.tasks.find(item => item.task_id === dep);
      return parent && parent.status === 'succeeded';
    }));
    if (pending) {
      const risk = parseRisk(pending.risk);
      const maxRisk = parseRisk(mission.policy && mission.policy.max_risk || 'medium');
      const riskRank = { low: 0, medium: 1, high: 2, critical: 3 };
      if (pending.approved !== true && (pending.irreversible || riskRank[risk] >= riskRank.high || (mission.policy && mission.policy.require_human_approval !== false && riskRank[risk] > riskRank[maxRisk]))) {
        pending.status = 'waiting_human';
        mission.status = 'waiting_human';
        mission.approval = {
          approval_id: uuid('approval'),
          status: 'pending',
          task_id: pending.task_id,
          task_title: pending.title,
          reason: pending.irreversible ? 'Irreversible action requires approval.' : 'Task risk exceeds mission policy.',
          created_at: nowIso()
        };
        await this.saveMission(mission, 'human_approval_required', { approval: mission.approval });
        await this.notify({ type: 'human_intervention_required', mission_id: mission.mission_id, task_id: pending.task_id, approval_id: mission.approval.approval_id, reason: mission.approval.reason });
        return;
      }
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
      if (blocked.length) {
        mission.status = 'waiting_human';
        mission.last_error = 'Task dependency graph is blocked.';
        await this.saveMission(mission, 'mission_dependency_blocked', { task_ids: blocked.map(task => task.task_id) });
        await this.notify({ type: 'human_intervention_required', mission_id: mission.mission_id, reason: 'task_dependency_blocked', details: mission.last_error });
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
    if (mission.approval.status !== 'pending' || mission.status !== 'waiting_human') return error('approval_not_pending', 409);
    mission.approval.status = body.decision;
    mission.approval.decided_at = nowIso();
    mission.approval.decided_by = String(body.actor || 'dashboard-operator').slice(0, 200);
    const task = mission.tasks.find(item => item.task_id === mission.approval.task_id);
    if (body.decision === 'rejected') {
      if (task) { task.status = 'failed'; task.last_error = 'Human approval rejected.'; }
      mission.status = 'failed';
      mission.last_error = 'Human approval rejected.';
      await this.saveMission(mission, 'human_approval_rejected', { approval: mission.approval });
      await this.notify({ type: 'mission_rejected', mission_id: mission.mission_id, approval_id: approvalId, reason: mission.last_error });
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

  async resume(missionId, request) {
    this.assertMissionExecutionEnabled();
    const mission = await this.getMission(missionId);
    if (!mission) return error('mission_not_found', 404);
    if (mission.status !== 'waiting_human' || (mission.approval && mission.approval.status === 'pending')) return error('mission_not_resumable', 409);
    for (const task of mission.tasks) {
      if (task.status === 'waiting_human' || task.status === 'failed') {
        task.status = 'pending';
        task.attempts = 0;
        task.last_error = null;
      }
    }
    mission.status = 'running';
    mission.last_error = null;
    mission.current_task_id = null;
    mission.approval = null;
    mission.manual_resume_at = nowIso();
    let body = {};
    try { body = await request.json(); } catch (_) {}
    mission.manual_resume_by = String(body.actor || 'dashboard-operator').slice(0, 200);
    await this.saveMission(mission, 'mission_resumed_after_human_review', { actor: mission.manual_resume_by });
    await this.scheduleNext(mission);
    await this.scheduleAlarm();
    return json({ ok: true, mission });
  }

  async reconcile() {
    if (this.isMissionExecutionPaused()) return false;
    const jobs = await this.ctx.storage.list({ prefix: 'job:' });
    for (const job of jobs.values()) {
      if (job.status === 'leased' && job.lease_until && Date.parse(job.lease_until) <= Date.now()) {
        job.status = 'queued';
        job.worker_id = null;
        job.lease_token = null;
        job.lease_until = null;
        job.updated_at = nowIso();
        await this.ctx.storage.put('job:' + job.job_id, job);
      }
    }
    const missions = await this.ctx.storage.list({ prefix: 'mission:' });
    for (const mission of missions.values()) {
      if (mission.status === 'planning') {
        await this.createJob(mission, mission.plan_kind === 'replan' ? 'mission.replan' : 'mission.plan', null, { reason: mission.last_error || 'recovery' });
      } else if (mission.status === 'running') {
        await this.scheduleNext(mission);
      }
    }
    await this.scheduleAlarm();
  }

  async alarm() {
    if (this.isMissionExecutionPaused()) return;
    await this.exclusive(() => this.reconcile());
    const notices = await this.ctx.storage.list({ prefix: 'notification:' });
    const pending = Array.from(notices.values()).filter(item => item.status === 'pending').slice(0, 10);
    for (const item of pending) await this.deliverNotification(item.notification_id);
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
