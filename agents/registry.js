'use strict';

const STATUSES = new Set(['available','inactive','blocked','unknown']);

function createAgentRegistry() {
  const map = new Map();
  return {
    register(agent) {
      if (!agent || typeof agent.id !== 'string' || !agent.id || typeof agent.role !== 'string') throw new Error('invalid agent');
      const status = STATUSES.has(agent.status) ? agent.status : 'unknown';
      const safe = Object.freeze({
        id: agent.id,
        role: agent.role,
        capabilities: Array.isArray(agent.capabilities) ? [...new Set(agent.capabilities)] : [],
        scope: Array.isArray(agent.scope) ? [...new Set(agent.scope)] : [],
        status
      });
      map.set(safe.id, safe);
      return safe;
    },
    get(id) { return map.get(id) || null; },
    list() { return [...map.values()]; },
    available(id) { const a = map.get(id); return !!a && a.status === 'available'; }
  };
}

module.exports = { createAgentRegistry, STATUSES };