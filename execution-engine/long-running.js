'use strict';
const { createDurableSessionStore } = require('./durable-session');

function createLongRunningStore({ save, load, appendEvent } = {}) {
  if (typeof save !== 'function' || typeof load !== 'function') throw new TypeError('persistence_callbacks_required');
  const durable = createDurableSessionStore({
    save,
    load: async taskId => {
      const value = await load(taskId);
      return value ? { ...value, session_id: value.session_id || value.task_id || taskId, state: value.state || 'waiting' } : null;
    },
    appendEvent,
  });
  return Object.freeze({
    async checkpoint(task) {
      if (!task || !task.task_id) throw new TypeError('task_id_required');
      await durable.checkpoint({ ...structuredClone(task), session_id: task.session_id || task.task_id, state: task.state || 'waiting' });
      return { status:'checkpointed', task_id:task.task_id };
    },
    async resume(taskId) {
      if (!taskId) throw new TypeError('task_id_required');
      const session = await durable.resume(taskId);
      if (session?.status === 'not_found') return null;
      const { session_id: _sessionId, ...task } = structuredClone(session);
      return task;
    },
    async transition(taskId, state, patch = {}) {
      return durable.transition(taskId, state, patch);
    },
  });
}

module.exports = { createLongRunningStore };
