'use strict';

/**
 * ARIA Session Engine — Mission 1.2
 * Deterministic in-memory session lifecycle. Persistence is injected by caller.
 */

const STATES = Object.freeze(['active', 'paused', 'closed']);

function assertId(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty string`);
}

function createSessionManager(deps = {}) {
  const store = deps.store || new Map();
  const now = typeof deps.now === 'function' ? deps.now : () => new Date().toISOString();

  function load(sessionId) { return store instanceof Map ? store.get(sessionId) : store.get(sessionId); }
  async function save(session) {
    if (store instanceof Map) store.set(session.id, session);
    else if (typeof store.set === 'function') await store.set(session.id, session);
    else throw new TypeError('store.set is required');
  }

  async function create(input = {}) {
    const id = input.id || `sess_${now()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    assertId(id, 'session id');
    if (load(id)) throw new Error('session_exists');
    const session = {
      id,
      state: 'active',
      created_at: now(),
      updated_at: now(),
      turns: [],
      context: { ...(input.context || {}) }
    };
    await save(session);
    return structuredClone(session);
  }

  async function resume(id) {
    assertId(id, 'session id');
    const session = load(id);
    if (!session) throw new Error('session_not_found');
    if (session.state === 'closed') throw new Error('session_closed');
    session.state = 'active'; session.updated_at = now();
    await save(session);
    return structuredClone(session);
  }

  async function appendTurn(id, turn) {
    assertId(id, 'session id');
    const session = load(id);
    if (!session) throw new Error('session_not_found');
    if (session.state !== 'active') throw new Error('session_not_active');
    if (!turn || typeof turn !== 'object') throw new TypeError('turn must be an object');
    session.turns.push(structuredClone(turn));
    session.updated_at = now();
    await save(session);
    return structuredClone(session);
  }

  async function setContext(id, patch) {
    assertId(id, 'session id');
    const session = load(id);
    if (!session) throw new Error('session_not_found');
    if (session.state === 'closed') throw new Error('session_closed');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('context patch must be an object');
    session.context = { ...session.context, ...structuredClone(patch) };
    session.updated_at = now();
    await save(session);
    return structuredClone(session);
  }

  async function close(id) {
    assertId(id, 'session id');
    const session = load(id);
    if (!session) throw new Error('session_not_found');
    session.state = 'closed'; session.updated_at = now();
    await save(session);
    return structuredClone(session);
  }

  return Object.freeze({ create, resume, appendTurn, setContext, close, states: STATES });
}

module.exports = { STATES, createSessionManager };
