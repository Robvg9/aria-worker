'use strict';

const assert = require('node:assert/strict');
const { createAutonomyCoordinator } = require('../autonomy/coordinator');

(async () => {
  let selfDevelopmentCalls = 0;
  let normalExecutorCalls = 0;

  const coordinator = createAutonomyCoordinator({
    policy: { enabled: true, max_risk: 'low', max_steps: 2, max_runtime_ms: 1000 },
    execute: async () => { normalExecutorCalls += 1; return { status: 'normal' }; },
    selfDevelopment: async goal => {
      selfDevelopmentCalls += 1;
      return { status: 'succeeded', objective: goal.objective };
    }
  });

  assert.equal(
    coordinator.submit({
      id: 'sd-1', objective: 'repair safe docs', priority: 10, risk: 'low',
      metadata: { self_development: true }
    }).accepted,
    true
  );

  assert.equal(
    coordinator.submit({
      id: 'normal-1', objective: 'ordinary task', priority: 1, risk: 'low'
    }).accepted,
    true
  );

  const result = await coordinator.run();
  assert.equal(result.steps, 2);
  assert.equal(selfDevelopmentCalls, 1);
  assert.equal(normalExecutorCalls, 1);

  const blocked = createAutonomyCoordinator({
    policy: { enabled: true, max_risk: 'low' },
    execute: async () => ({ status: 'normal' }),
    selfDevelopment: async () => ({ status: 'succeeded' })
  });
  assert.equal(
    blocked.submit({
      id: 'sd-high', objective: 'unsafe self modification', risk: 'high',
      metadata: { self_development: true }
    }).accepted,
    false
  );

  console.log('AUTONOMY SELF-DEVELOPMENT BRIDGE TESTS PASS');
})();
