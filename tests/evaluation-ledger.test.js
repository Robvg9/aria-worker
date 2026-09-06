'use strict';
const assert = require('node:assert/strict');
const { createEvaluationLedger } = require('../evaluation/ledger');
const { runEvalSuite } = require('../evaluation/engine');
(async () => {
  const saved = [];
  const ledger = createEvaluationLedger({ store: { save: async e => saved.push(e), list: async id => saved.filter(e => e.suite_id === id) }, now: () => '2026-09-06T00:00:00.000Z' });
  const suite = await runEvalSuite({ cases: [{ id:'a', run:async()=>1, expect:x=>x===1 }] });
  const entry = await ledger.record({ suite_id:'suite-a', suite, metadata:{source:'test'} });
  assert.equal(entry.status, 'passed');
  assert.equal(entry.total, 1);
  assert.deepEqual(await ledger.history('suite-a'), [entry]);
  await assert.rejects(() => ledger.record({ suite_id:'', suite }), /suite_id_required/);
  console.log('EVALUATION LEDGER TEST PASS');
})().catch(error => { console.error(error); process.exit(1); });
