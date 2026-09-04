'use strict';

const crypto = require('crypto');

const DEFAULT_POLL_MS = 1500;
const DEFAULT_WAIT_MS = 120000;
const TERMINAL = new Set(['succeeded', 'failed', 'timeout', 'cancelled', 'blocked']);

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function jobId(missionId, stepId, attempt) {
  return `job_${crypto.createHash('sha256').update(JSON.stringify({ missionId, stepId, attempt })).digest('hex').slice(0, 24)}`;
}

function createDeviceDispatcher({ enqueue, get, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), poll_ms = DEFAULT_POLL_MS, wait_ms = DEFAULT_WAIT_MS } = {}) {
  requireFn(enqueue, 'enqueue');
  requireFn(get, 'get');

  async function execute({ missionId, step, attempt = 1 }) {
    if (!missionId || !step || !step.id) throw new Error('missionId and step.id required');
    if (step.operation !== 'shell.execute') throw new Error(`unsupported device operation: ${step.operation}`);
    const deviceId = step.target?.device_id || step.policy?.device_id;
    if (!deviceId) throw new Error('device_id required');
    if (typeof step.command !== 'string' && typeof step.input?.command !== 'string') throw new Error('shell command required');

    const command = step.command || step.input.command;
    const id = jobId(missionId, step.id, attempt);
    const created = await enqueue({
      job_id: id,
      mission_id: missionId,
      device_id: deviceId,
      operation: 'shell.execute',
      command,
      cwd: step.cwd || step.input?.cwd || null,
      timeout_ms: Number.isInteger(step.timeout_ms) ? step.timeout_ms : 120000,
      policy: step.policy || {},
      metadata: { mission_step_id: step.id, attempt }
    });

    if (!created) throw new Error('device job enqueue returned empty result');

    const started = Date.now();
    while (Date.now() - started < wait_ms) {
      const current = await get(id);
      if (current && TERMINAL.has(current.status)) {
        return {
          ...current,
          job_id: id,
          status: current.status,
          duration_ms: current.result?.duration_ms ?? null
        };
      }
      await sleep(Math.max(250, poll_ms));
    }
    return { job_id: id, status: 'timeout', exit_code: null, stdout: '', stderr: 'dispatcher wait timeout', duration_ms: Date.now() - started };
  }

  return Object.freeze({ execute, jobId: (missionId, stepId, attempt) => jobId(missionId, stepId, attempt) });
}

module.exports = Object.freeze({ createDeviceDispatcher, jobId, TERMINAL });
