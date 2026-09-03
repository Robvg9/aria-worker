'use strict';

const STATES = Object.freeze(['planned','running','waiting','completed','failed','cancelled','rolled_back']);

function createExecutionMonitor({ onEvent = null } = {}) {
  const tasks = new Map();
  function emit(event) { try { if (typeof onEvent === 'function') onEvent(Object.freeze({ ...event })); } catch (_) {} }
  function create(taskId, stepIds) {
    if (!taskId || tasks.has(taskId)) throw new Error('task_exists');
    const steps = Object.fromEntries(stepIds.map(id => [id, 'planned']));
    const task = { task_id: taskId, state: 'planned', steps };
    tasks.set(taskId, task); emit({ type:'task.created', task_id:taskId, state:'planned' }); return snapshot(task);
  }
  function setTaskState(taskId, state) {
    if (!STATES.includes(state)) throw new TypeError('invalid_state');
    const task = tasks.get(taskId); if (!task) throw new Error('task_not_found');
    if (['completed','failed','cancelled','rolled_back'].includes(task.state)) throw new Error('terminal_state');
    task.state = state; emit({ type:'task.state', task_id:taskId, state }); return snapshot(task);
  }
  function setStepState(taskId, stepId, state) {
    if (!STATES.includes(state)) throw new TypeError('invalid_state');
    const task = tasks.get(taskId); if (!task || !(stepId in task.steps)) throw new Error('step_not_found');
    task.steps[stepId] = state; emit({ type:'step.state', task_id:taskId, step_id:stepId, state }); return snapshot(task);
  }
  function snapshot(task) { return structuredClone(task); }
  return Object.freeze({ create, setTaskState, setStepState, snapshot: (taskId) => tasks.has(taskId) ? snapshot(tasks.get(taskId)) : null });
}

module.exports = { STATES, createExecutionMonitor };
