'use strict';

async function recoverStep({ step, error, retry = false, maxRetries = 0, retryCount = 0, execute }) {
  if (!retry || typeof execute !== 'function' || retryCount >= maxRetries) {
    return { status:'failed', action:'stop', reason: error?.code || 'step_failed', retry_count: retryCount };
  }
  const result = await execute(step, retryCount + 1);
  return result && result.status === 'succeeded'
    ? { status:'recovered', action:'retry', retry_count: retryCount + 1, result }
    : { status:'failed', action:'stop', retry_count: retryCount + 1, result: result || null };
}

module.exports = { recoverStep };
