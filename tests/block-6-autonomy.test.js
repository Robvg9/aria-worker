'use strict';
const assert = require('node:assert/strict');
const { createAutonomyPolicy, riskAllowed } = require('../autonomy/policy');
const { createGoal, transition } = require('../autonomy/goals');
const { createPriorityQueue } = require('../autonomy/priority-queue');
const { createScheduler } = require('../autonomy/scheduler');
const { createStopController } = require('../autonomy/stop-controller');
const { createResourceGuard } = require('../autonomy/resource-guard');
const { createAutonomyCoordinator } = require('../autonomy/coordinator');

(async () => {
  const p = createAutonomyPolicy({ enabled: true, max_risk: 'medium', max_steps: 2, max_runtime_ms: 1000 });
  assert.equal(riskAllowed('low', p), true); assert.equal(riskAllowed('high', p), false);
  const g = createGoal({ id: 'g1', objective: 'test', priority: 1, risk: 'low' });
  assert.equal(transition(g, 'active').state, 'active');
  const q = createPriorityQueue(); q.push({ id: 'b', priority: 1 }); q.push({ id: 'a', priority: 2 }); assert.equal(q.next().id, 'a');
  const s = createScheduler({ now: () => 10 }); s.schedule({ id: 'j', due_at: 10, run: async () => {} }); assert.equal(s.due(10).length, 1);
  const stop = createStopController(); stop.stop('test'); assert.equal(stop.isStopped(), true);
  const rg = createResourceGuard({ max_actions: 1, max_failures: 1 }); assert.equal(rg.canAct(), true); rg.recordAction(); assert.equal(rg.canAct(), false);
  const c = createAutonomyCoordinator({ policy: { enabled: true, max_risk: 'low', max_steps: 2 }, execute: async x => x.id });
  assert.equal(c.submit({ id: 'blocked', objective: 'x', risk: 'high' }).accepted, false);
  assert.equal(c.submit({ id: 'ok', objective: 'x', risk: 'low' }).accepted, true);
  const out = await c.run(); assert.equal(out.status, 'idle'); assert.equal(out.steps, 1);
  const disabled = createAutonomyCoordinator({ policy: {}, execute: async () => null }); assert.equal((await disabled.run()).status, 'disabled');
  console.log('BLOCK 6 AUTONOMY TESTS PASS');
})();
