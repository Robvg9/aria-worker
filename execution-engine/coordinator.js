'use strict';

const { topologicalOrder, normalizeSteps } = require('./dependencies');
const { recoverStep } = require('./recovery');
const { verifyStep, verifyTask } = require('./verifier');
const { rollback } = require('./rollback');

function createExecutionCoordinator({ executeStep, monitor, checkpointStore = null } = {}) {
  if (typeof executeStep !== 'function') throw new TypeError('executeStep_required');
  if (!monitor || typeof monitor.create !== 'function') throw new TypeError('monitor_required');

  async function run({ task_id, steps, retry = false, max_retries = 0, verify = null, compensators = {} } = {}) {
    if (!task_id) throw new TypeError('task_id_required');
    const normalized = normalizeSteps(steps);
    const byId = new Map(normalized.map(s => [s.id, s]));
    const order = topologicalOrder(normalized);
    monitor.create(task_id, order);
    monitor.setTaskState(task_id, 'running');
    const results = [];
    const completed = [];

    for (const id of order) {
      const step = byId.get(id);
      if (step.depends_on.some(dep => !completed.some(x => x.id === dep))) {
        monitor.setStepState(task_id, id, 'failed');
        monitor.setTaskState(task_id, 'failed');
        return { task_id, status:'failed', reason:'dependency_not_completed', results };
      }
      monitor.setStepState(task_id, id, 'running');
      let result;
      try { result = await executeStep(step); }
      catch (error) { result = { status:'failed', error:{ code:'execution_error', message:'step threw' } }; }
      if (!result || result.status !== 'succeeded') {
        const recovery = await recoverStep({ step, error:result?.error, retry, maxRetries:max_retries, retryCount:step.retry_count || 0, execute:executeStep });
        if (recovery.status === 'recovered') result = recovery.result;
      }
      results.push({ id, result });
      if (!result || result.status !== 'succeeded') {
        monitor.setStepState(task_id, id, 'failed');
        monitor.setTaskState(task_id, 'failed');
        if (completed.length) await rollback(completed, compensators);
        return { task_id, status:'failed', results };
      }
      monitor.setStepState(task_id, id, 'completed');
      completed.push({ id, result });
      if (checkpointStore) await checkpointStore.checkpoint({ task_id, state:'running', completed_step_ids:completed.map(x => x.id), results });
    }

    const verification = await verifyTask(results.map(x => x.result), verify);
    if (!verification.verified) {
      monitor.setTaskState(task_id, 'failed');
      if (completed.length) await rollback(completed, compensators);
      return { task_id, status:'failed', reason:'verification_failed', verification, results };
    }
    monitor.setTaskState(task_id, 'completed');
    if (checkpointStore) await checkpointStore.checkpoint({ task_id, state:'completed', completed_step_ids:completed.map(x => x.id), results });
    return { task_id, status:'completed', verification, results };
  }

  return Object.freeze({ run });
}

module.exports = { createExecutionCoordinator };
