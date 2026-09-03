'use strict';

/**
 * ARIA Self-State — Mission 1.5
 * Read-only snapshot of ARIA's known state. Never returns credentials or secrets.
 */

function safeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return null;
    const out = {};
    for (const key of ['id', 'name', 'status', 'version', 'capability']) {
      if (item[key] !== undefined) out[key] = item[key];
    }
    return out;
  }).filter(Boolean);
}

function createSelfStateProvider(deps = {}) {
  const identity = deps.identity || (() => ({ id: 'aria', name: 'ARIA' }));
  const version = deps.version || (() => 'unknown');
  const capabilities = deps.capabilities || (() => []);
  const tools = deps.tools || (() => []);
  const health = deps.health || (() => ({ status: 'unknown' }));
  const pending = deps.pending || (() => []);
  const now = deps.now || (() => new Date().toISOString());

  return Object.freeze({
    snapshot() {
      const id = identity();
      const snapshot = {
        state_version: 'aria-self-state-v1.0.0',
        as_of: now(),
        identity: {
          id: id && id.id ? id.id : 'aria',
          name: id && id.name ? id.name : 'ARIA',
          role: id && id.role ? id.role : 'autonomous-ai-agent'
        },
        version: String(version()),
        capabilities: safeList(capabilities()),
        tools: safeList(tools()),
        health: (() => {
          const h = health();
          return h && typeof h === 'object' ? { status: h.status || 'unknown', detail: h.detail || null } : { status: 'unknown', detail: null };
        })(),
        pending_missions: safeList(pending())
      };
      return Object.freeze(snapshot);
    }
  });
}

module.exports = { createSelfStateProvider };
