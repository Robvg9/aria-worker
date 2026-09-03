'use strict';

const STATES = Object.freeze(['queued', 'active', 'paused', 'completed', 'cancelled', 'blocked']);

function createGoal(input) {
  if (!input || typeof input.id !== 'string' || !input.id) throw new Error('goal id required');
  if (typeof input.objective !== 'string' || !input.objective.trim()) throw new Error('goal objective required');
  return { id: input.id, objective: input.objective.trim(), priority: Number.isFinite(input.priority) ? input.priority : 0, risk: input.risk || 'critical', state: 'queued', metadata: input.metadata ? { ...input.metadata } : {} };
}

function transition(goal, next) {
  if (!STATES.includes(next)) throw new Error('invalid goal state');
  const allowed = { queued: ['active','cancelled','blocked'], active: ['paused','completed','cancelled','blocked'], paused: ['active','cancelled'], blocked: ['queued','cancelled'], completed: [], cancelled: [] };
  if (!allowed[goal.state].includes(next)) throw new Error(`invalid goal transition: ${goal.state}->${next}`);
  return { ...goal, state: next };
}

module.exports = { STATES, createGoal, transition };
