'use strict';

// Supabase-independent persistent autonomy primitives for Node.js 20+.
// Storage is a local JSON snapshot + append-only JSONL event journal.
// Deploy the same API behind a cloud worker or a Windows-local worker.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const MISSION_STATES = new Set(['planning', 'queued', 'running', 'waiting_human', ...TERMINAL]);
const TASK_STATES = new Set(['pending', 'running', 'waiting_human', 'succeeded', 'failed', 'skipped']);
const RISKS = ['low', 'medium', 'high', 'critical'];

const isoNow = () => new Date().toISOString();
const id = (prefix) => prefix + '_' + crypto.randomUUID();
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function assertObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(name + '_must_be_object');
}

function normalizeTask(task, index) {
  assertObject(task, 'task');
  const risk = String(task.risk || 'medium').toLowerCase();
  if (!RISKS.includes(risk)) throw new Error('invalid_task_risk');
  const operation = typeof task.operation === 'string' ? task.operation.trim().toLowerCase() : '';
  const payload = task.payload == null ? {} : task.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('task_payload_must_be_object');
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 524288) throw new Error('task_payload_too_large');
  return {
    task_id: String(task.task_id || id('task')),
    title: String(task.title || ('Task ' + (index + 1))),
    description: String(task.description || ''),
    operation,
    payload: clone(payload),
    status: 'pending',
    risk,
    irreversible: task.irreversible === true,
    idempotent: task.idempotent === true,
    depends_on: Array.isArray(task.depends_on) ? task.depends_on.map(String) : [],
    attempts: 0,
    max_attempts: Number.isInteger(task.max_attempts) ? Math.max(1, Math.min(10, task.max_attempts)) : 3,
    evidence: [],
    last_error: null,
    started_at: null,
    completed_at: null
  };
}

function validateTaskGraph(tasks) {
  if (!Array.isArray(tasks)) throw new TypeError('tasks_must_be_array');
  const byId = new Map();
  for (const task of tasks) {
    if (!task || typeof task.task_id !== 'string' || !task.task_id) throw new Error('task_id_required');
    if (byId.has(task.task_id)) throw new Error('duplicate_task_id:' + task.task_id);
    byId.set(task.task_id, task);
  }
  for (const task of tasks) {
    for (const dependency of task.depends_on || []) {
      if (dependency === task.task_id || !byId.has(dependency)) throw new Error('dependency_missing_or_self:' + task.task_id + ':' + dependency);
    }
  }
  const state = new Map();
  function visit(taskId) {
    const current = state.get(taskId) || 0;
    if (current === 1) return false;
    if (current === 2) return true;
    state.set(taskId, 1);
    const task = byId.get(taskId);
    for (const dependency of task.depends_on || []) if (!visit(dependency)) return false;
    state.set(taskId, 2);
    return true;
  }
  for (const task of tasks) if (!visit(task.task_id)) throw new Error('dependency_cycle:' + task.task_id);
  return { valid: true, task_count: tasks.length };
}


function createJsonMissionStore({ directory } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('directory_required');
  const root = path.resolve(directory);
  const missionsDir = path.join(root, 'missions');
  const eventsDir = path.join(root, 'events');
  const approvalsDir = path.join(root, 'approvals');
  const pendingWrites = new Map();

  async function ensure() {
    await Promise.all([fs.mkdir(missionsDir, { recursive: true }), fs.mkdir(eventsDir, { recursive: true }), fs.mkdir(approvalsDir, { recursive: true })]);
  }
  function fileFor(dir, key, suffix = '.json') {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(String(key))) throw new Error('invalid_storage_key');
    return path.join(dir, String(key) + suffix);
  }
  async function atomicWrite(file, value) {
    await ensure();
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, file);
  }
  async function serialize(key, operation) {
    const previous = pendingWrites.get(key) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    pendingWrites.set(key, next);
    try { return await next; }
    finally { if (pendingWrites.get(key) === next) pendingWrites.delete(key); }
  }
  async function appendEvent(missionId, event) {
    await ensure();
    const record = { event_id: id('evt'), mission_id: missionId, at: isoNow(), ...clone(event) };
    await fs.appendFile(fileFor(eventsDir, missionId, '.jsonl'), JSON.stringify(record) + '\n', 'utf8');
    return record;
  }
  async function save(mission) {
    return serialize('mission:' + mission.mission_id, async () => {
      await atomicWrite(fileFor(missionsDir, mission.mission_id), mission);
      return clone(mission);
    });
  }
  async function get(missionId) {
    await ensure();
    try { return JSON.parse(await fs.readFile(fileFor(missionsDir, missionId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function create({ goal, tasks = [], metadata = {}, policy = {}, status = 'queued' } = {}) {
    if (typeof goal !== 'string' || !goal.trim()) throw new TypeError('goal_required');
    if (!Array.isArray(tasks)) throw new TypeError('tasks_must_be_array');
    if (!MISSION_STATES.has(status)) throw new Error('invalid_mission_status');
    const normalizedTasks = tasks.map(normalizeTask);
    validateTaskGraph(normalizedTasks);
    const missionId = id('mission');
    const now = isoNow();
    const mission = {
      mission_id: missionId, goal: goal.trim(), status, created_at: now, updated_at: now,
      started_at: null, completed_at: null, current_task_id: null,
      tasks: normalizedTasks, metadata: clone(metadata),
      policy: { max_auto_risk: policy.max_auto_risk || 'medium', max_steps_per_tick: policy.max_steps_per_tick || 10,
        max_runtime_ms: policy.max_runtime_ms || 60000, approval_required_for_irreversible: true, ...clone(policy) },
      approval: null, attempts: 0, last_error: null, verification: null, progress_percent: 0
    };
    if (!RISKS.includes(mission.policy.max_auto_risk)) throw new Error('invalid_max_auto_risk');
    await save(mission);
    await appendEvent(missionId, { type: 'mission_created', goal: mission.goal, task_count: mission.tasks.length });
    return clone(mission);
  }
  async function update(missionId, mutator, eventType = 'mission_updated', details = {}) {
    return serialize('mission:' + missionId, async () => {
      const current = await get(missionId);
      if (!current) throw new Error('mission_not_found');
      const next = clone(current);
      await mutator(next);
      next.updated_at = isoNow();
      await atomicWrite(fileFor(missionsDir, missionId), next);
      await appendEvent(missionId, { type: eventType, ...clone(details), status: next.status });
      return clone(next);
    });
  }
  async function list() {
    await ensure();
    const names = (await fs.readdir(missionsDir)).filter(name => name.endsWith('.json'));
    const results = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(missionsDir, name), 'utf8'))));
    return results.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }
  async function events(missionId) {
    try {
      const raw = await fs.readFile(fileFor(eventsDir, missionId, '.jsonl'), 'utf8');
      return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function requestApproval(missionId, approval) {
    const approvalId = id('approval');
    const record = { approval_id: approvalId, mission_id: missionId, status: 'pending', created_at: isoNow(), resolved_at: null, ...clone(approval) };
    await atomicWrite(fileFor(approvalsDir, approvalId), record);
    await update(missionId, mission => {
      mission.status = 'waiting_human';
      mission.approval = record;
      const task = mission.tasks.find(item => item.task_id === approval.task_id);
      if (task) task.status = 'waiting_human';
    }, 'human_approval_requested', { approval_id: approvalId, reason: record.reason });
    return clone(record);
  }
  async function resolveApproval(approvalId, decision, actor = 'human') {
    if (!['approved', 'rejected'].includes(decision)) throw new Error('invalid_approval_decision');
    const file = fileFor(approvalsDir, approvalId);
    const approval = JSON.parse(await fs.readFile(file, 'utf8'));
    if (approval.status !== 'pending') throw new Error('approval_already_resolved');
    approval.status = decision; approval.actor = actor; approval.resolved_at = isoNow();
    await atomicWrite(file, approval);
    await update(approval.mission_id, mission => {
      if (!mission.approval || mission.approval.approval_id !== approvalId) throw new Error('approval_mismatch');
      mission.approval = approval;
      const task = mission.tasks.find(item => item.task_id === approval.task_id);
      if (task) task.status = decision === 'approved' ? 'pending' : 'failed';
      mission.status = decision === 'approved' ? 'queued' : 'running';
      if (decision === 'rejected' && task) task.last_error = 'Human approval rejected: ' + (approval.reason || 'no reason supplied');
    }, 'human_approval_' + decision, { approval_id: approvalId, actor });
    return clone(approval);
  }
  return Object.freeze({ root, create, get, save, update, list, events, appendEvent, requestApproval, resolveApproval });
}

function progressOf(mission) {
  const tasks = mission.tasks || [];
  if (!tasks.length) return mission.status === 'succeeded' ? 100 : 0;
  const weight = task => task.status === 'succeeded' || task.status === 'skipped' ? 1 : task.status === 'failed' ? 0.25 : 0;
  const computed = Math.floor(tasks.reduce((sum, task) => sum + weight(task), 0) / tasks.length * 100);
  return computed >= 100 && mission.status !== 'succeeded' ? 99 : computed;
}

function createPersistentAutonomy({ store, plan, executeTask, verifyCompletion, notify = async () => {}, replan = null, now = Date.now, deferPlanning = false } = {}) {
  if (!store || typeof store.create !== 'function' || typeof store.get !== 'function') throw new TypeError('store_required');
  if (typeof plan !== 'function' || typeof executeTask !== 'function' || typeof verifyCompletion !== 'function') throw new TypeError('plan_execute_verify_required');
  if (replan !== null && typeof replan !== 'function') throw new TypeError('replan_must_be_function');

  async function start({ goal, metadata = {}, policy = {} } = {}) {
    if (deferPlanning) {
      const mission = await store.create({ goal, tasks: [], metadata, policy, status: 'planning' });
      await notify({ type: 'mission_started', mission_id: mission.mission_id, goal: mission.goal, planning: true });
      return mission;
    }
    const tasks = await plan(goal, { metadata, policy });
    if (!Array.isArray(tasks) || !tasks.length) throw new Error('planner_must_return_tasks');
    const mission = await store.create({ goal, tasks, metadata, policy });
    await notify({ type: 'mission_started', mission_id: mission.mission_id, goal: mission.goal });
    return mission;
  }

  async function planMission(missionId, options = {}) {
    const mission = await store.get(missionId);
    if (!mission) throw new Error('mission_not_found');
    if (mission.status !== 'planning') return mission;
    try {
      const tasks = await plan(mission.goal, {
        metadata: mission.metadata || {}, policy: mission.policy || {},
        mission_id: mission.mission_id, prior_tasks: mission.tasks || [], signal: options.signal
      });
      if (!Array.isArray(tasks) || !tasks.length) throw new Error('planner_must_return_tasks');
      const normalized = tasks.map(normalizeTask);
      validateTaskGraph(normalized);
      await store.update(missionId, current => {
        if (current.status !== 'planning') return;
        current.tasks = normalized;
        current.status = 'queued';
        current.last_error = null;
        current.planning_completed_at = isoNow();
        current.progress_percent = progressOf(current);
      }, 'mission_plan_created', { task_count: normalized.length });
      await notify({ type: 'mission_plan_created', mission_id: missionId, task_count: normalized.length });
      return store.get(missionId);
    } catch (error) {
      const message = String(error && error.message || error).slice(0, 1000);
      const transient = /worker_job_timeout|worker_wait_aborted|ECONNRESET|ECONNREFUSED|fetch failed|timed? ?out|timeout/i.test(message);
      const attempts = (mission.planning_attempts || 0) + 1;
      await store.update(missionId, current => {
        current.planning_attempts = attempts;
        current.last_error = message;
        current.status = transient || attempts < 3 ? 'planning' : 'waiting_human';
        current.progress_percent = progressOf(current);
      }, transient || attempts < 3 ? 'mission_planning_deferred' : 'mission_planning_failed', { attempts, transient, error: message });
      if (mission.last_error !== message) {
        await notify({ type: transient ? 'worker_waiting_for_planner' : 'mission_planning_error', mission_id: missionId, reason: message, attempts });
      }
      if (!transient && attempts >= 3) {
        await notify({ type: 'human_intervention_required', mission_id: missionId, reason: 'planner_failed_repeatedly', details: message });
      }
      return store.get(missionId);
    }
  }

  const activeTicks = new Set();

  async function runTick(missionId, options = {}) {
    const initialMission = await store.get(missionId);
    if (!initialMission) throw new Error('mission_not_found');
    if (initialMission.status === 'planning') {
      const planned = await planMission(missionId, options);
      if (planned.status === 'planning' || planned.status === 'waiting_human') return planned;
    }
    const maxSteps = Number.isInteger(options.max_steps) ? Math.max(1, Math.min(100, options.max_steps)) : 10;
    const maxRuntime = Number.isInteger(options.max_runtime_ms) ? Math.max(1000, options.max_runtime_ms) : 60000;
    const deadline = now() + maxRuntime;
    const beforeRecovery = await store.get(missionId);
    if (!beforeRecovery) throw new Error('mission_not_found');
    if (beforeRecovery.status === 'running') {
      const runningTasks = beforeRecovery.tasks.filter(item => item.status === 'running');
      if (runningTasks.length) {
        const unsafe = runningTasks.filter(item => item.idempotent !== true);
        await store.update(missionId, current => {
          for (const item of current.tasks) {
            if (item.status !== 'running') continue;
            item.last_error = 'Recovered after runtime interruption; previous execution outcome is unknown.';
            item.status = item.idempotent === true ? 'pending' : 'waiting_human';
          }
          current.current_task_id = null;
          current.status = unsafe.length ? 'waiting_human' : 'queued';
          current.last_error = unsafe.length ? 'Interrupted non-idempotent task requires human review before retry.' : 'Recovered interrupted idempotent task.';
          current.progress_percent = progressOf(current);
        }, unsafe.length ? 'recovery_requires_human_review' : 'idempotent_task_recovered', { task_ids: runningTasks.map(item => item.task_id) });
        if (unsafe.length) {
          await notify({ type: 'human_intervention_required', mission_id: missionId, reason: 'interrupted_non_idempotent_task', details: 'The previous execution outcome is unknown. Review before retrying.' });
          return store.get(missionId);
        }
      }
    }
    let processed = 0;
    while (processed < maxSteps && now() < deadline) {
      let mission = await store.get(missionId);
      if (!mission) throw new Error('mission_not_found');
      if (TERMINAL.has(mission.status) || mission.status === 'waiting_human') return mission;
      const task = mission.tasks.find(item => item.status === 'pending' && item.depends_on.every(dep => mission.tasks.some(other => other.task_id === dep && ['succeeded', 'skipped'].includes(other.status))));
      if (!task) {
        const unresolved = mission.tasks.some(item => !['succeeded', 'skipped'].includes(item.status));
        if (unresolved) {
          const failedOrPaused = mission.tasks.some(item => item.status === 'failed' || item.status === 'waiting_human');
          if (replan && !failedOrPaused) {
            const newTasks = await replan(clone(mission), { reason: 'no_runnable_tasks' });
            if (Array.isArray(newTasks) && newTasks.length) {
              await store.update(missionId, current => { current.tasks.push(...newTasks.map(normalizeTask)); current.status = 'queued'; }, 'mission_replanned', { added_tasks: newTasks.length });
              processed++;
              continue;
            }
          }
          await store.update(missionId, current => { current.status = 'waiting_human'; current.last_error = 'No runnable task; unresolved dependencies or failed tasks require review.'; current.progress_percent = progressOf(current); }, 'mission_blocked');
          await notify({ type: 'human_intervention_required', mission_id: missionId, reason: 'no_runnable_tasks', details: 'Unresolved dependencies or failed tasks remain.' });
          return store.get(missionId);
        }
        const verification = await verifyCompletion(clone(mission));
        if (!verification || verification.passed !== true) {
          await store.update(missionId, current => { current.status = 'waiting_human'; current.verification = clone(verification || { passed: false, reason: 'verification_missing' }); current.progress_percent = progressOf(current); }, 'final_verification_failed');
          await notify({ type: 'human_intervention_required', mission_id: missionId, reason: 'final_verification_failed', verification });
          return store.get(missionId);
        }
        await store.update(missionId, current => { current.status = 'succeeded'; current.completed_at = isoNow(); current.verification = clone(verification); current.progress_percent = 100; }, 'mission_verified_complete', { verification });
        await notify({ type: 'mission_completed', mission_id: missionId, verification });
        return store.get(missionId);
      }
      const maxRisk = RISKS.indexOf(mission.policy.max_auto_risk || 'medium');
      const taskRisk = RISKS.indexOf(task.risk || 'critical');
      const previouslyApproved = mission.approval && mission.approval.task_id === task.task_id && mission.approval.status === 'approved';
      if (!previouslyApproved && (task.irreversible || taskRisk > maxRisk || taskRisk >= RISKS.indexOf('critical'))) {
        const approval = await store.requestApproval(missionId, { task_id: task.task_id, task_title: task.title, risk: task.risk, irreversible: task.irreversible, reason: task.irreversible ? 'Irreversible action requires explicit human approval.' : 'Task risk exceeds autonomous policy.' });
        await notify({ type: 'human_intervention_required', mission_id: missionId, approval_id: approval.approval_id, reason: approval.reason, task });
        return store.get(missionId);
      }
      await store.update(missionId, current => {
        current.status = 'running'; current.started_at = current.started_at || isoNow(); current.current_task_id = task.task_id; current.attempts++;
        const active = current.tasks.find(item => item.task_id === task.task_id);
        active.status = 'running'; active.attempts++; active.started_at = active.started_at || isoNow();
      }, 'task_started', { task_id: task.task_id, task_title: task.title });
      processed++;
      try {
        const result = await executeTask(clone(task), clone(await store.get(missionId)), { signal: options.signal });
        if (!result || result.passed === false || result.status === 'failed') throw new Error(result && result.error ? String(result.error) : 'task_execution_not_verified');
        await store.update(missionId, current => {
          const active = current.tasks.find(item => item.task_id === task.task_id);
          active.status = 'succeeded'; active.completed_at = isoNow(); active.evidence = Array.isArray(result.evidence) ? result.evidence : result.evidence == null ? [] : [result.evidence]; active.last_error = null;
          current.current_task_id = null; current.progress_percent = progressOf(current); current.status = 'running';
        }, 'task_verified', { task_id: task.task_id, evidence: result.evidence || null });
      } catch (error) {
        const latest = await store.get(missionId);
        const active = latest.tasks.find(item => item.task_id === task.task_id);
        const canRetry = active.idempotent === true || Boolean(error && error.retryable === true);
        const willRetry = canRetry && active.attempts < active.max_attempts;
        await store.update(missionId, current => {
          const target = current.tasks.find(item => item.task_id === task.task_id);
          target.last_error = String(error && error.message || error);
          target.status = willRetry ? 'pending' : 'failed';
          current.current_task_id = null; current.last_error = target.last_error; current.progress_percent = progressOf(current);
        }, 'task_attempt_failed', { task_id: task.task_id, attempt: active.attempts, retryable: willRetry, error: String(error && error.message || error) });
        if (willRetry) await notify({ type: 'task_retrying', mission_id: missionId, task_id: task.task_id, attempt: active.attempts, error: String(error && error.message || error) });
      }
    }
    const mission = await store.get(missionId);
    await store.appendEvent(missionId, { type: 'execution_yielded', processed_steps: processed, reason: now() >= deadline ? 'runtime_budget' : 'step_budget' });
    return mission;
  }

  async function tick(missionId, options = {}) {
    if (activeTicks.has(missionId)) return store.get(missionId);
    activeTicks.add(missionId);
    try { return await runTick(missionId, options); }
    finally { activeTicks.delete(missionId); }
  }

  async function resume(missionId, options = {}) {
    const mission = await store.get(missionId);
    if (!mission) throw new Error('mission_not_found');
    if (mission.status === 'waiting_human') {
      if (mission.approval && mission.approval.status === 'pending') return mission;
      if (mission.approval && mission.approval.status === 'rejected') return mission;
      await store.update(missionId, current => {
        for (const task of current.tasks) {
          if (task.status === 'waiting_human' || task.status === 'failed') {
            task.status = 'pending';
            task.attempts = 0;
            task.last_error = null;
          }
        }
        current.status = 'queued';
        current.last_error = null;
        current.current_task_id = null;
        current.approval = current.approval && current.approval.status === 'approved' ? current.approval : null;
        current.manual_resume_at = isoNow();
        current.manual_resume_by = String(options.actor || 'human');
      }, mission.approval && mission.approval.status === 'approved' ? 'mission_resumed_after_approval' : 'mission_resumed_after_human_review', { actor: String(options.actor || 'human') });
    }
    return tick(missionId, options);
  }

  return Object.freeze({ start, planMission, tick, resume });
}

function createPollingSupervisor({ listMissions, tickMission, intervalMs = 5000, onError = async () => {}, shouldStop = () => false } = {}) {
  if (typeof listMissions !== 'function' || typeof tickMission !== 'function') throw new TypeError('supervisor_dependencies_required');
  let stopped = false;
  const active = new Map();
  async function run() {
    while (!stopped && !shouldStop()) {
      try {
        const missions = await listMissions();
        for (const mission of missions) {
          if (stopped || shouldStop()) break;
          if (!['planning', 'queued', 'running'].includes(mission.status) || active.has(mission.mission_id)) continue;
          const task = Promise.resolve()
            .then(() => tickMission(mission.mission_id))
            .catch(error => onError({ mission_id: mission.mission_id, error: String(error && error.message || error) }))
            .finally(() => active.delete(mission.mission_id));
          active.set(mission.mission_id, task);
        }
      } catch (error) {
        await onError({ scope: 'supervisor', error: String(error && error.message || error) });
      }
      await new Promise(resolve => setTimeout(resolve, Math.max(500, intervalMs)));
    }
    await Promise.allSettled([...active.values()]);
  }
  return Object.freeze({ run, stop: () => { stopped = true; }, activeCount: () => active.size });
}

module.exports = Object.freeze({ TERMINAL, MISSION_STATES, TASK_STATES, RISKS, createJsonMissionStore, createPersistentAutonomy, createPollingSupervisor, progressOf, validateTaskGraph });
