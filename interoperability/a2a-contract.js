'use strict';

const TASK_STATES = Object.freeze(['submitted','working','input_required','completed','failed','cancelled']);
function createAgentCard({ id, name, url, capabilities = [], skills = [] } = {}) {
  if (!id || !name || !url) throw new Error('agent_card_identity_required');
  return Object.freeze({ protocol: 'A2A', version: '1.0.0', id, name, url, capabilities: [...new Set(capabilities)], skills: [...new Set(skills)] });
}
function createTask({ task_id, context_id = null, state = 'submitted', message = null } = {}) {
  if (!task_id) throw new Error('task_id_required');
  if (!TASK_STATES.includes(state)) throw new Error('task_state_invalid');
  return { task_id, context_id, status: { state }, message };
}
function validateTask(task) {
  if (!task || !task.task_id) return { valid: false, reason: 'task_id_required' };
  if (!TASK_STATES.includes(task.status?.state)) return { valid: false, reason: 'task_state_invalid' };
  return { valid: true };
}
function createMessage({ message_id, task_id = null, role, parts = [] } = {}) {
  if (!message_id || !['user','agent'].includes(role)) throw new Error('message_contract_invalid');
  return { message_id, task_id, role, parts };
}
module.exports = { TASK_STATES, createAgentCard, createTask, validateTask, createMessage };
