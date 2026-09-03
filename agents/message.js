'use strict';

const TYPES = new Set(['task','result','error','status']);

function createAgentMessage({ message_id, task_id, from, to, type, payload, depth = 0 } = {}) {
  if (![message_id, task_id, from, to].every(x => typeof x === 'string' && x)) throw new Error('message identity required');
  if (!TYPES.has(type)) throw new Error('invalid message type');
  if (depth < 0 || !Number.isInteger(depth)) throw new Error('invalid depth');
  return Object.freeze({ version: 1, message_id, task_id, from, to, type, payload: payload === undefined ? null : payload, depth });
}

function normalizeAgentResult({ agent_id, task_id, status, output = null, error = null, verified = false } = {}) {
  const allowed = new Set(['succeeded','failed','blocked','cancelled']);
  if (!allowed.has(status)) throw new Error('invalid result status');
  return Object.freeze({ version: 1, agent_id, task_id, status, output, error, verified: Boolean(verified) });
}

module.exports = { createAgentMessage, normalizeAgentResult };