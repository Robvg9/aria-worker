'use strict';

async function recoverAgent({ execute, message, max_attempts = 1 } = {}) {
  if (typeof execute !== 'function') return { status: 'failed', reason: 'executor_missing', attempts: 0 };
  if (!Number.isInteger(max_attempts) || max_attempts < 0 || max_attempts > 1) return { status: 'blocked', reason: 'invalid_recovery_bound' };
  let attempts = 0;
  while (attempts <= max_attempts) {
    attempts += 1;
    try {
      const result = await execute(message, attempts);
      return { status: 'recovered', attempts, result };
    } catch (_) {
      if (attempts > max_attempts) return { status: 'failed', attempts, reason: 'recovery_exhausted' };
    }
  }
  return { status: 'failed', attempts, reason: 'recovery_exhausted' };
}

module.exports = { recoverAgent };