'use strict';

const TERMINAL = new Set(['succeeded', 'failed', 'blocked', 'cancelled']);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createDurableSessionStore({ save, load, appendEvent } = {}) {
  if (typeof save !== 'function' || typeof load !== 'function') throw new Error('durable_store_required');

  async function checkpoint(session) {
    if (!session || typeof session.session_id !== 'string' || !session.session_id) throw new Error('session_id_required');
    const current = clone(session);
    current.updated_at = current.updated_at || new Date().toISOString();
    await save(current);
    if (typeof appendEvent === 'function') await appendEvent(current.session_id, { type: 'checkpoint', state: clone(current) });
    return clone(current);
  }

  async function resume(sessionId) {
    const current = await load(sessionId);
    if (!current) return { status: 'not_found', session_id: sessionId };
    return clone(current);
  }

  async function transition(sessionId, state, patch = {}) {
    const current = await load(sessionId);
    if (!current) throw new Error('session_not_found');
    if (TERMINAL.has(current.state) && current.state !== state) throw new Error('terminal_session_immutable');
    const next = { ...current, ...clone(patch), state, updated_at: new Date().toISOString() };
    return checkpoint(next);
  }

  return Object.freeze({ checkpoint, resume, transition, terminal: state => TERMINAL.has(state) });
}

module.exports = { createDurableSessionStore, TERMINAL };
