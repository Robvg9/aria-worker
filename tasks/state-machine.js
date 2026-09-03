'use strict';

/**
 * ARIA Task State Machine — Mission 1.4
 * Explicit lifecycle; invalid transitions fail closed.
 */

const STATES = Object.freeze(['planned', 'running', 'waiting', 'completed', 'failed', 'cancelled']);
const TRANSITIONS = Object.freeze({
  planned: ['running', 'cancelled'],
  running: ['waiting', 'completed', 'failed', 'cancelled'],
  waiting: ['running', 'failed', 'cancelled'],
  completed: [],
  failed: ['planned', 'cancelled'],
  cancelled: []
});

function assertState(state) {
  if (!STATES.includes(state)) throw new Error('invalid_task_state');
}

function canTransition(from, to) {
  assertState(from); assertState(to);
  return TRANSITIONS[from].includes(to);
}

function transition(task, to, patch = {}) {
  if (!task || typeof task !== 'object') throw new TypeError('task must be an object');
  assertState(task.state);
  if (!canTransition(task.state, to)) throw new Error(`invalid_transition:${task.state}->${to}`);
  return Object.freeze({ ...task, ...patch, state: to, updated_at: new Date().toISOString() });
}

function createTask(input = {}) {
  if (typeof input.goal !== 'string' || !input.goal.trim()) throw new TypeError('goal must be non-empty');
  return Object.freeze({
    id: input.id || null,
    goal: input.goal.trim(),
    plan_id: input.plan_id || null,
    state: 'planned',
    created_at: input.created_at || new Date().toISOString(),
    updated_at: input.updated_at || new Date().toISOString()
  });
}

module.exports = { STATES, TRANSITIONS, canTransition, transition, createTask };
