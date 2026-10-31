'use strict';

// Mission Wonder 2 physical probe only. The global freeze must stop the worker
// before any task can execute; this adapter deliberately refuses all work.
module.exports = Object.freeze({
  supabaseIndependent: true,
  capabilities: Object.freeze([]),
  async health() {
    return Object.freeze({ ok: true, model: 'safe-frozen-worker-probe' });
  },
  async executeTask() {
    throw new Error('FROZEN_WORKER_PROBE_MUST_NEVER_EXECUTE_TASKS');
  }
});
