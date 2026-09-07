'use strict';

const crypto = require('crypto');

function createSelfDevelopmentSandbox({ workspace, snapshotStore = null, protectedPaths = [] } = {}) {
  if (!workspace || typeof workspace.read !== 'function' || typeof workspace.apply !== 'function') throw new TypeError('workspace_boundary_required');
  const protectedSet = new Set((Array.isArray(protectedPaths) ? protectedPaths : []).map(String));
  const sessions = new Map();

  function sessionId(seed = '') {
    return `sandbox_${crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 20)}`;
  }

  function assertMutable(path) {
    if (!path || protectedSet.has(String(path))) throw new Error('protected_path');
  }

  async function create({ objective, seed = '' } = {}) {
    const id = sessionId(`${objective || ''}:${seed}:${sessions.size}`);
    const state = { id, objective: objective || 'self_development', status: 'open', changes: [], created_at: new Date().toISOString() };
    sessions.set(id, state);
    return Object.freeze({ ...state });
  }

  async function stage(id, change) {
    const state = sessions.get(id);
    if (!state || state.status !== 'open') throw new Error('sandbox_session_closed');
    if (!change || typeof change.path !== 'string') throw new TypeError('change_required');
    assertMutable(change.path);
    const before = await workspace.read(change.path);
    const entry = { type: change.type, path: change.path, content: change.content, before, staged_at: new Date().toISOString() };
    state.changes.push(entry);
    return Object.freeze({ status: 'staged', session_id: id, path: change.path, before });
  }

  async function run(id, { dry_run = true } = {}) {
    const state = sessions.get(id);
    if (!state || state.status !== 'open') throw new Error('sandbox_session_closed');
    const results = [];
    for (const change of state.changes) {
      if (dry_run) results.push({ path: change.path, status: 'simulated', type: change.type });
      else {
        assertMutable(change.path);
        results.push({ path: change.path, result: await workspace.apply({ ...change }) });
      }
    }
    return Object.freeze({ status: 'succeeded', session_id: id, mode: dry_run ? 'dry_run' : 'sandbox_apply', results });
  }

  async function promote(id, { verifier = null, tests = null } = {}) {
    const state = sessions.get(id);
    if (!state || state.status !== 'open') throw new Error('sandbox_session_closed');
    if (typeof verifier !== 'function') return { status: 'blocked', reason: 'promotion_verifier_required' };
    const evidence = await verifier({ session: { ...state, changes: [...state.changes] }, tests });
    if (!evidence || evidence.passed !== true) return { status: 'blocked', reason: 'verification_required', evidence: evidence || null };
    state.status = 'promoted';
    return Object.freeze({ status: 'promoted', session_id: id, evidence });
  }

  async function discard(id) {
    const state = sessions.get(id);
    if (!state) return { status: 'not_found' };
    state.status = 'discarded';
    return Object.freeze({ status: 'discarded', session_id: id });
  }

  return Object.freeze({ create, stage, run, promote, discard });
}

module.exports = Object.freeze({ createSelfDevelopmentSandbox });
