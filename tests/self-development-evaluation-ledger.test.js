'use strict';
const assert = require('node:assert/strict');
const { createSelfDevelopmentEngine } = require('../self-development/coordinator');
const { createEvaluationLedger } = require('../evaluation/ledger');

(async () => {
  const entries = [];
  const ledger = createEvaluationLedger({
    store: {
      save: async entry => entries.push(entry),
      list: async suiteId => entries.filter(entry => entry.suite_id === suiteId)
    },
    now: () => '2026-09-06T00:00:00.000Z'
  });

  const engine = createSelfDevelopmentEngine({
    snapshot: async () => ({ version:'1.0.0', identity:{name:'ARIA'}, capabilities:[], tools:[], connectors:[], tests:{status:'passing'}, git:{branch:'main'} }),
    workspace: {
      read: async () => 'before',
      apply: async () => ({ status:'succeeded' })
    },
    testRunner: async () => ({ status:'passed', total:1, passed:1, failed:0 }),
    evaluationLedger: ledger,
    evaluationSuiteId: 'self-development-e2e',
    policy: { max_risk:'low' }
  });

  const result = await engine.improve({
    objective:'ledger integration',
    proposed_changes:[{ type:'modify_file', path:'safe.js', risk_level:'low', after:'after' }]
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.evaluation.suite_id, 'self-development-e2e');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].passed, 1);
  assert.equal(entries[0].metadata.source, 'self-development');
  assert.equal((await ledger.history('self-development-e2e')).length, 1);
  console.log('SELF-DEVELOPMENT EVALUATION LEDGER: PASS');
})().catch(error => { console.error(error); process.exit(1); });
