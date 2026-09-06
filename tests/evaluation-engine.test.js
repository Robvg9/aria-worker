'use strict';
const assert = require('node:assert/strict');
const { runEvalSuite, compareSuites } = require('../evaluation/engine');
(async () => {
  const suite = await runEvalSuite({ cases: [
    { id: 'ok', run: async () => ({ value: 2 }), expect: out => out.value === 2 },
    { id: 'bad', run: async () => ({ value: 1 }), expect: out => out.value === 2 },
    { id: 'err', run: async () => { throw new Error('boom'); } },
  ] });
  assert.equal(suite.status, 'failed');
  assert.equal(suite.total, 3);
  assert.equal(suite.passed, 1);
  assert.equal(suite.failed, 2);
  const baseline = { results: [{ id: 'a', status: 'passed' }, { id: 'b', status: 'passed' }] };
  assert.deepEqual(compareSuites(baseline, { results: [{ id: 'a', status: 'passed' }, { id: 'b', status: 'failed' }] }), { regression_free: false, regressions: ['b'] });
  assert.deepEqual(compareSuites(baseline, baseline), { regression_free: true, regressions: [] });
  console.log('EVALUATION ENGINE TESTS PASS');
})();
