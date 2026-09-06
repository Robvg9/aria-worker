'use strict';

function requireStore(store) {
  if (!store || typeof store.save !== 'function' || typeof store.list !== 'function') {
    throw new TypeError('evaluation_store_required');
  }
}

function createEvaluationLedger({ store, now = () => new Date().toISOString() } = {}) {
  requireStore(store);

  async function record({ suite_id, suite, baseline = null, metadata = {} } = {}) {
    if (typeof suite_id !== 'string' || !suite_id) throw new Error('suite_id_required');
    if (!suite || typeof suite !== 'object') throw new Error('suite_required');
    const entry = Object.freeze({
      evaluation_id: `${suite_id}:${now()}`,
      suite_id,
      recorded_at: now(),
      status: suite.status || 'unknown',
      total: suite.total ?? 0,
      passed: suite.passed ?? 0,
      failed: suite.failed ?? 0,
      regressions: baseline ? (require('../evaluation/engine').compareSuites(baseline, suite).regressions) : [],
      suite,
      metadata
    });
    await store.save(entry);
    return entry;
  }

  async function history(suite_id, limit = 20) {
    const entries = await store.list(suite_id);
    return entries.filter(Boolean).slice(-Math.max(1, Number(limit) || 20));
  }

  return Object.freeze({ record, history });
}

module.exports = { createEvaluationLedger };
