'use strict';

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
    if (depends.some(dep => !availableIds.has(dep))) throw new Error('plan_dependency_invalid');
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
  }

  async exclusive(fn) {
    const previous = this.lock;
    let release;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await fn(); }
    finally { release(); }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'aria-autonomy-coordinator', storage: 'durable-object', supabase_independent: true, time: nowIso() });
    }

    const workerRoute = url.pathname === '/api/worker/claim' || /^\/api\/worker\/jobs\/[^/]+\/(heartbeat|complete|fail)$/.test(url.pathname);
    if (workerRoute) {
      if (!authorized(request, this.env.ARIA_WORKER_TOKEN)) return error('unauthorized_worker', 401);
      if (method === 'POST' && url.pathname === '/api/worker/claim') return this.exclusive(() => this.claim(request));
      const match = url.pathname.match(/^\/api\/worker\/jobs\/([^/]+)\/(heartbeat|complete|fail)$/);
      if (method !== 'POST' || !match) return error('method_not_allowed', 405);
      const jobId = decodeURIComponent(match[1]);
      if (match[2] === 'heartbeat') return this.exclusive(() => this.heartbeat(jobId, request));
      if (match[2] === 'complete') return this.exclusive(() => this.complete(jobId, request));
      return this.exclusive(() => this.fail(jobId, request));
    }

    if (!url.pathname.startsWith('/api/')) return error('not_found', 404);
    if (!authorized(request, this.env.ARIA_CONTROL_TOKEN)) return error('unauthorized', 401);

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
    const missionMatch = url.pathname.match(/^\/api\/missions\/([^/]+)(?:\/(events|resume))?$/);
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

  async getMission(missionId) {
    return this.ctx.storage.get('mission:' + missionId);
  }
  async saveMission(mission, eventType, details = {}) {
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
  async notify(event) {
    const record = {
      notification_id: uuid('notification'),
      created_at: nowIso(),
      updated_at: nowIso(),
      status: this.env.ARIA_NOTIFICATION_WEBHOOK_URL ? 'pending' : 'waiting_config',
      attempts: 0,
      delivered_at: null,
      last_error: this.env.ARIA_NOTIFICATION_WEBHOOK_URL ? null : 'notification_webhook_not_configured',
      event: clone(event)
    };
    await this.ctx.storage.put('notification:' + record.notification_id, record);
    if (this.env.ARIA_NOTIFICATION_WEBHOOK_URL) this.ctx.waitUntil(this.deliverNotification(record.notification_id));
    return record;
  }
  async deliverNotification(notificationId) {
    const record = await this.ctx.storage.get('notification:' + notificationId);
    if (!record || !['pending', 'waiting_config'].includes(record.status)) return;
    let endpoint;
    try {
      endpoint = new URL(this.env.ARIA_NOTIFICATION_WEBHOOK_URL || '');
      if (endpoint.protocol !== 'https:') throw new Error('notification_webhook_must_use_https');
      record.attempts += 1;
      const response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.env.ARIA_NOTIFICATION_TOKEN ? { authorization: 'Bearer ' + this.env.ARIA_NOTIFICATION_TOKEN } : {}) },
        body: JSON.stringify({ source: 'ARIA Mission Control', ...record.event, notification_id: record.notification_id, created_at: record.created_at }),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error('webhook_http_' + response.status);
      record.status = 'delivered';
      record.delivered_at = nowIso();
      record.last_error = null;
    } catch (err) {
      record.status = 'pending';
      record.last_error = String(err && err.message || err).slice(0, 500);
    }
    record.updated_at = nowIso();
    await this.ctx.storage.put('notification:' + notificationId, record);
  }
  async scheduleAlarm() {
    const missions = await this.ctx.storage.list({ prefix: 'mission:' });
    const hasActive = Array.from(missions.values()).some(m => ACTIVE_MISSION_STATES.has(m.status));
    const jobs = await this.ctx.storage.list({ prefix: 'job:' });
    const hasJobs = Array.from(jobs.values()).some(job => ACTIVE_JOB_STATES.has(job.status));
    if (hasActive || hasJobs) await this.ctx.storage.setAlarm(Date.now() + this.alarmMs);
  }
  async createJob(mission, operation, task, context = {}) {
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
    await this.ctx.storage.setAlarm(Date.now() + this.alarmMs);
    return job;
  }
  async createMission(request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const goal = String(body.goal || '').trim();
    if (!goal || goal.length > 10000) return error('goal_required_or_too_long', 400);
    const policy = body.policy && typeof body.policy === 'object' ? body.policy : {};
    const mission = {
      mission_id: uuid('mission'),
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
      metadata: body.metadata && typeof body.metadata === 'object' ? clone(body.metadata) : {},
      policy: {
        max_risk: parseRisk(policy.max_risk || 'medium'),
        require_human_approval: policy.require_human_approval !== false,
        allow_background: true,
        max_steps: Math.max(1, Math.min(50, Number(policy.max_steps) || 20))
      },
      approval: null,
      verification: null,
      last_error: null
    };
    await this.saveMission(mission, 'mission_created', { goal });
    await this.createJob(mission, 'mission.plan', null);
    await this.scheduleAlarm();
    return json({ mission }, 201);
  }

  async claim(request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const workerId = String(body.worker_id || '').slice(0, 200);
    if (!workerId) return error('worker_id_required', 400);
    const now = Date.now();
    const records = await this.ctx.storage.list({ prefix: 'job:' });
    const candidate = Array.from(records.values())
      .filter(job => job.status === 'queued' || (job.status === 'leased' && job.lease_until && Date.parse(job.lease_until) <= now))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (!candidate) return json({ job: null });
    const job = await this.ctx.storage.get('job:' + candidate.job_id);
    if (!job || !(job.status === 'queued' || (job.status === 'leased' && job.lease_until && Date.parse(job.lease_until) <= Date.now()))) return json({ job: null });
    job.status = 'leased';
    job.worker_id = workerId;
    job.lease_token = crypto.randomUUID();
    job.lease_until = new Date(Date.now() + Math.max(5000, Number(this.env.ARIA_WORKER_LEASE_MS) || 60000)).toISOString();
    job.updated_at = nowIso();
    job.attempts += 1;
    job.claimed_capabilities = Array.isArray(body.capabilities) ? body.capabilities.map(String).slice(0, 50) : [];
    await this.ctx.storage.put('job:' + job.job_id, job);
    await this.scheduleAlarm();
    const mission = await this.getMission(job.mission_id);
    return json({ job: { ...job, context: { ...job.context, mission } } });
  }

  async heartbeat(jobId, request) {
    let body;
    try { body = await request.json(); } catch (_) { return error('invalid_json', 400); }
    const job = await this.ctx.storage.get('job:' + jobId);
    if (!job) return error('job_not_found', 404);
    if (job.status !== 'leased' || job.worker_id !== body.worker_id || job.lease_token !== body.lease_token) return error('lease_mismatch', 409);
    job.lease_until = new Date(Date.now() + Math.max(5000, Number(this.env.ARIA_WORKER_LEASE_MS) || 60000)).toISOString();
    job.updated_at = nowIso();
    await this.ctx.storage.put('job:' + jobId, job);
    await this.ctx.storage.setAlarm(Date.now() + this.alarmMs);
    return json({ ok: true, lease_until: job.lease_until });
  }

  async complete(jobId, request) {
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
      if (result.passed === true && verification && verification.passed === true) {
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
