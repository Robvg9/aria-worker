'use strict';

const assert = require('assert');
const { normalizePlan, dependenciesSatisfied, nextReadyStep } = require('../autonomy/universal-execution/plan');

(async () => {
  const plan = normalizePlan([
    { id: 'github', operation: 'repo_read', executor_type: 'connector', target: { type: 'connector', connector_id: 'github' } },
    { id: 'termux', operation: 'shell.execute', executor_type: 'device', target: { type: 'device', device_id: 'android-termux' }, depends_on: ['github'] },
    { id: 'supabase', operation: 'read', executor_type: 'connector', target: { type: 'connector', connector_id: 'supabase' }, depends_on: ['github'] },
    { id: 'agent', operation: 'delegate', executor_type: 'agent', target: { type: 'agent', agent_id: 'agent.test' }, depends_on: ['termux', 'supabase'] }
  ]);

  assert.strictEqual(plan.length, 4);
  assert.deepStrictEqual(plan[1].depends_on, ['github']);
  assert.strictEqual(dependenciesSatisfied(plan[1], new Set(['github'])), true);
  assert.strictEqual(dependenciesSatisfied(plan[3], new Set(['termux'])), false);
  assert.strictEqual(nextReadyStep(plan, new Set(), new Set()).id, 'github');
  assert.strictEqual(nextReadyStep(plan, new Set(['github']), new Set()).id, 'termux');
  assert.strictEqual(nextReadyStep(plan, new Set(['github']), new Set(['termux'])).id, 'supabase');
  assert.strictEqual(nextReadyStep(plan, new Set(['github', 'termux', 'supabase']), new Set()).id, 'agent');

  assert.throws(() => normalizePlan([
    { id: 'a', operation: 'x', depends_on: ['missing'] }
  ]), /unknown_dependency/);
  assert.throws(() => normalizePlan([
    { id: 'a', operation: 'x', depends_on: ['b'] },
    { id: 'b', operation: 'x', depends_on: ['a'] }
  ]), /dependency_cycle/);

  console.log('UO-5 multi-executor dependency plan tests passed');
})().catch(error => { console.error(error); process.exit(1); });
