'use strict';

// Mission Wonder 2 physical probe only. The global freeze must stop the worker
// before any task can execute; this adapter deliberately refuses all work.
module.exports = Object.freeze({
  supabaseIndependent: true,
  localInference: false,
  capabilities: Object.freeze([]),
  async health() {
    return Object.freeze({ ok: true, local_inference: false, adapter: 'safe-frozen-worker-probe' });
  },
  async executeTask() {
    throw new Error('FROZEN_WORKER_PROBE_MUST_NEVER_EXECUTE_TASKS');
  },
  async verifyCompletion() {
    return { passed: false, reason: 'frozen_probe_never_verifies_missions' };
  }
});
