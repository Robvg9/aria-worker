'use strict';

const NON_RETRYABLE = new Set(['authorization_denied','credential_unavailable','tool_unavailable','operation_unsupported','destructive_blocked']);

function createToolRecovery({ discover, execute } = {}) {
  if (typeof discover !== 'function' || typeof execute !== 'function') throw new TypeError('discover and execute are required');
  async function recover(failure, context = {}, maxAttempts = 2) {
    const reason = failure && failure.reason ? failure.reason : (failure && failure.error && failure.error.code) || 'unknown';
    if (NON_RETRYABLE.has(reason)) return { status: 'no_recovery', reason, attempts: 0 };
    const candidates = await discover(context);
    const list = Array.isArray(candidates) ? candidates.slice(0, Math.max(0, maxAttempts)) : [];
    const attempts = [];
    for (const candidate of list) {
      const result = await execute(candidate, context);
      attempts.push({ tool_id: candidate.tool_id, result });
      if (result && ['succeeded','completed'].includes(result.status)) return { status: 'recovered', tool_id: candidate.tool_id, attempts };
    }
    return { status: 'no_recovery', reason: 'candidates_exhausted', attempts };
  }
  return Object.freeze({ recover });
}

module.exports = { createToolRecovery };
