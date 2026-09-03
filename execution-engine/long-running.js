'use strict';

function createLongRunningStore({ save, load } = {}) {
  if (typeof save !== 'function' || typeof load !== 'function') throw new TypeError('persistence_callbacks_required');
  return Object.freeze({
    async checkpoint(task) { if (!task || !task.task_id) throw new TypeError('task_id_required'); await save(structuredClone(task)); return { status:'checkpointed', task_id:task.task_id }; },
    async resume(taskId) { if (!taskId) throw new TypeError('task_id_required'); const task = await load(taskId); return task ? structuredClone(task) : null; }
  });
}

module.exports = { createLongRunningStore };
