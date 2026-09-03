'use strict';

function createSelfDocumenter({ write } = {}) {
  if (typeof write !== 'function') throw new TypeError('writer_required');
  return Object.freeze({
    async record({ objective, findings = [], changes = [], tests = null, verification = null, rollback = null } = {}) {
      const entry = {
        type: 'aria.self_development',
        objective: objective || 'self_improvement',
        findings: structuredClone(findings),
        changes: structuredClone(changes),
        tests: structuredClone(tests),
        verification: structuredClone(verification),
        rollback: structuredClone(rollback),
        durable_write: true
      };
      const result = await write(entry);
      return result && result.status === 'succeeded'
        ? { status: 'succeeded', entry: result.entry || entry }
        : { status: 'failed', reason: 'documentation_write_failed' };
    }
  });
}

module.exports = { createSelfDocumenter };
