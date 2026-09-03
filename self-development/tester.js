'use strict';

function createSelfTester({ run } = {}) {
  if (typeof run !== 'function') throw new TypeError('test_runner_required');
  return Object.freeze({
    async test({ scope = [], reason = 'self_improvement' } = {}) {
      const result = await run({ scope: Array.isArray(scope) ? [...scope] : [], reason });
      if (!result || typeof result !== 'object') return { status: 'failed', reason: 'invalid_test_result' };
      return Object.freeze({ status: result.status === 'passed' ? 'passed' : 'failed', summary: result.summary || null, details: structuredClone(result.details || null) });
    }
  });
}

module.exports = { createSelfTester };
