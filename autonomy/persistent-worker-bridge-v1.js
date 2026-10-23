'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const nowIso = () => new Date().toISOString();
const makeId = () => 'job_' + crypto.randomUUID();
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function createPersistentWorkerBridge({ directory, leaseMs = 60000 } = {}) {
  if (typeof directory !== 'string' || !directory.trim()) throw new TypeError('directory_required');
  const root = path.resolve(directory);
  const jobsDir = path.join(root, 'worker-jobs');
  const locks = new Map();

  async function ensure() { await fs.mkdir(jobsDir, { recursive: true }); }
  function jobPath(jobId) {
    if (!/^job_[a-zA-Z0-9_-]{1,150}$/.test(String(jobId))) throw new Error('invalid_job_id');
    return path.join(jobsDir, jobId + '.json');
  }
  async function write(job) {
    await ensure();
    const file = jobPath(job.job_id);
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temp, JSON.stringify(job, null, 2), { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, file);
    return clone(job);
  }
  async function get(jobId) {
    await ensure();
    try { return JSON.parse(await fs.readFile(jobPath(jobId), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function serialize(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    locks.set(key, next);
    try { return await next; }
    finally { if (locks.get(key) === next) locks.delete(key); }
  }
  async function enqueue({ mission_id, task, context = {} } = {}) {
    if (typeof mission_id !== 'string' || !mission_id) throw new TypeError('mission_id_required');
    if (!task || typeof task !== 'object' || Array.isArray(task)) throw new TypeError('task_required');
    const job = {
      job_id: makeId(), mission_id, task: clone(task), context: clone(context),
      status: 'queued', created_at: nowIso(), updated_at: nowIso(),
      worker_id: null, lease_token: null, lease_until: null, attempts: 0, result: null, error: null
    };
    await write(job);
    return clone(job);
  }
  async function list() {
    await ensure();
    const names = (await fs.readdir(jobsDir)).filter(name => name.endsWith('.json'));
    const jobs = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(jobsDir, name), 'utf8'))));
    return jobs.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async function claimNext({ worker_id, capabilities = [] } = {}) {
    if (typeof worker_id !== 'string' || !worker_id.trim()) throw new TypeError('worker_id_required');
    return serialize('claim-queue', async () => {
      const jobs = await list();
      const now = Date.now();
      const candidate = jobs.find(item => item.status === 'queued' || (item.status === 'leased' && item.lease_until && Date.parse(item.lease_until) <= now));
      if (!candidate) return null;
      return serialize('job:' + candidate.job_id, async () => {
        const job = await get(candidate.job_id);
        const claimTime = Date.now();
        const eligible = job && (job.status === 'queued' || (job.status === 'leased' && job.lease_until && Date.parse(job.lease_until) <= claimTime));
        if (!eligible) return null;
        job.status = 'leased';
        job.worker_id = worker_id;
        job.lease_token = crypto.randomUUID();
        job.lease_until = new Date(claimTime + Math.max(5000, leaseMs)).toISOString();
        job.updated_at = nowIso();
        job.attempts += 1;
        job.claimed_capabilities = Array.isArray(capabilities) ? capabilities.map(String) : [];
        return write(job);
      });
    });
  }
  async function heartbeat(jobId, { worker_id, lease_token } = {}) {
    return serialize('job:' + jobId, async () => {
      const job = await get(jobId);
      if (!job) throw new Error('job_not_found');
      if (job.status !== 'leased' || job.worker_id !== worker_id || !lease_token || job.lease_token !== lease_token) throw new Error('worker_lease_mismatch');
      job.lease_until = new Date(Date.now() + Math.max(5000, leaseMs)).toISOString();
      job.updated_at = nowIso();
      return write(job);
    });
  }
  async function complete(jobId, { worker_id, lease_token, result, error } = {}) {
    return serialize('job:' + jobId, async () => {
      const job = await get(jobId);
      if (!job) throw new Error('job_not_found');
      if (job.status !== 'leased' || job.worker_id !== worker_id || !lease_token || job.lease_token !== lease_token) throw new Error('worker_lease_mismatch');
      job.updated_at = nowIso();
      job.lease_until = null;
      if (error) {
        job.status = 'failed';
        job.error = String(error);
      } else if (!result || result.passed !== true || result.status === 'failed') {
        job.status = 'failed';
        job.error = String(result && result.error || 'worker_result_not_verified');
        job.result = clone(result || null);
      } else {
        job.status = 'succeeded';
        job.result = clone(result);
      }
      return write(job);
    });
  }
  async function waitForResult(jobId, { timeoutMs = 30 * 60 * 1000, pollMs = 1000, signal } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (signal && signal.aborted) throw new Error('worker_wait_aborted');
      const job = await get(jobId);
      if (!job) throw new Error('worker_job_missing');
      if (job.status === 'succeeded') return clone(job.result);
      if (job.status === 'failed') throw new Error(job.error || 'worker_job_failed');
      await new Promise(resolve => setTimeout(resolve, Math.max(250, pollMs)));
    }
    throw new Error('worker_job_timeout:' + jobId);
  }
  return Object.freeze({ root, enqueue, get, list, claimNext, heartbeat, complete, waitForResult });
}

function createWorkerBackedExecutor({ bridge, timeoutMs, pollMs } = {}) {
  if (!bridge || typeof bridge.enqueue !== 'function' || typeof bridge.waitForResult !== 'function') throw new TypeError('worker_bridge_required');
  return async function executeTaskOnWindows(task, mission, context = {}) {
    const job = await bridge.enqueue({ mission_id: mission.mission_id, task, context: { goal: mission.goal, metadata: mission.metadata || {} } });
    return bridge.waitForResult(job.job_id, { timeoutMs, pollMs, signal: context.signal });
  };
}

async function getOrEnqueueWorkerJob(bridge, mission_id, task, context) {
  if (typeof bridge.list === 'function') {
    const jobs = await bridge.list();
    const pending = jobs
      .filter(job => job.mission_id === mission_id && job.task && job.task.operation === task.operation && ['queued', 'leased', 'succeeded'].includes(job.status))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (pending) return pending;
  }
  return bridge.enqueue({ mission_id, task, context });
}

function createWorkerBackedPlanner({ bridge, timeoutMs, pollMs } = {}) {
  if (!bridge || typeof bridge.enqueue !== 'function' || typeof bridge.waitForResult !== 'function') throw new TypeError('worker_bridge_required');
  return async function planOnWindows(goal, context = {}) {
    const missionId = context.mission_id || ('planning_' + crypto.randomUUID());
    const job = await getOrEnqueueWorkerJob(bridge, missionId,
      { operation: 'mission.plan', payload: { goal, metadata: context.metadata || {}, policy: context.policy || {} } },
      { goal, metadata: context.metadata || {}, policy: context.policy || {}, mode: 'plan' });
    const result = await bridge.waitForResult(job.job_id, { timeoutMs, pollMs, signal: context.signal });
    const tasks = result && result.evidence && result.evidence.tasks;
    if (!Array.isArray(tasks) || !tasks.length) throw new Error('worker_planner_returned_no_tasks');
    return tasks;
  };
}

function createWorkerBackedReplanner({ bridge, timeoutMs, pollMs } = {}) {
  if (!bridge || typeof bridge.enqueue !== 'function' || typeof bridge.waitForResult !== 'function') throw new TypeError('worker_bridge_required');
  return async function replanOnWindows(mission, context = {}) {
    const job = await getOrEnqueueWorkerJob(bridge, mission.mission_id,
      { operation: 'mission.replan', payload: { reason: context.reason || 'replan' } },
      { goal: mission.goal, metadata: mission.metadata || {}, policy: mission.policy || {}, mission: clone(mission), reason: context.reason || 'replan', mode: 'replan' });
    const result = await bridge.waitForResult(job.job_id, { timeoutMs, pollMs, signal: context.signal });
    const tasks = result && result.evidence && result.evidence.tasks;
    if (!Array.isArray(tasks) || !tasks.length) throw new Error('worker_replanner_returned_no_tasks');
    return tasks;
  };
}

function createWorkerBackedVerifier({ bridge, timeoutMs, pollMs } = {}) {
  if (!bridge || typeof bridge.enqueue !== 'function' || typeof bridge.waitForResult !== 'function') throw new TypeError('worker_bridge_required');
  return async function verifyOnWindows(mission, context = {}) {
    const job = await getOrEnqueueWorkerJob(bridge, mission.mission_id,
      { operation: 'mission.verify', payload: {} },
      { goal: mission.goal, metadata: mission.metadata || {}, policy: mission.policy || {}, mission: clone(mission), mode: 'verify' });
    const result = await bridge.waitForResult(job.job_id, { timeoutMs, pollMs, signal: context.signal });
    const verification = result && result.evidence && result.evidence.verification;
    if (!verification || typeof verification.passed !== 'boolean') throw new Error('worker_verifier_returned_invalid_result');
    return verification;
  };
}

module.exports = Object.freeze({
  createPersistentWorkerBridge,
  createWorkerBackedExecutor,
  createWorkerBackedPlanner,
  createWorkerBackedReplanner,
  createWorkerBackedVerifier
});
