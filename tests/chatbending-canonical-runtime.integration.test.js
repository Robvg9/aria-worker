'use strict';

const assert = require('node:assert/strict');

const runtimeModulePath = require.resolve('../autonomy/autonomous-runtime');
const canonicalModulePath = require.resolve('../autonomy/canonical-runtime');
const originalRuntimeModule = require(runtimeModulePath);

require.cache[runtimeModulePath].exports = {
  createAutonomousRuntime() {
    const received = [];
    return Object.freeze({
      missionRepository: {},
      missionStore: {},
      deviceClient: {},
      deviceDispatcher: {},
      executor: {},
      orchestrator: {},
      missionHttp: {},
      async runMission(input) {
        return { status: 'succeeded', input };
      },
      async startMission(input) {
        received.push(input);
        return { status: 'succeeded', input, received_count: received.length };
      }
    });
  }
};

delete require.cache[canonicalModulePath];
const { createCanonicalAriaRuntime } = require('../autonomy/canonical-runtime');

(async () => {
  try {
    const runtime = createCanonicalAriaRuntime({
      memory: false,
      activation: { execute: async () => ({ status: 'succeeded' }) },
      planner: async () => ({}) ,
      verify: async () => true
    });

    const normal = await runtime.startMission({
      goal: 'validate canonical ChatBending wiring',
      metadata: { project: 'ChatBending', active_rules: ['RULE-001'], evidence: ['e1'] }
    });

    assert.equal(normal.status, 'succeeded');
    assert.equal(normal.input.metadata.chatbending_context.version, 'chatbending-mission-context-v1');
    assert.equal(normal.input.metadata.chatbending_behavior.mode, 'CONTINUE');

    const blocked = await runtime.startMission({
      goal: 'reject contradictory mission',
      metadata: {
        chatbending_enforce: true,
        chatbending_contradiction: true
      }
    });

    assert.equal(blocked.status, 'stop');
    assert.equal(blocked.chatbending.mode, 'STOP');
    console.log('chatbending-canonical-runtime.integration.test.js: PASS');
  } finally {
    require.cache[runtimeModulePath].exports = originalRuntimeModule;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
