'use strict';

const assert = require('node:assert/strict');
const { createSelfImprovementEngine } = require('../autonomy/self-improvement-engine-v1');

async function main() {
  const events = [];
  const engine = createSelfImprovementEngine({
    observe: async ({ signal }) => { events.push('observe'); return { status: 'succeeded', observed: signal.goal }; },
    research: async () => { events.push('research'); return { status: 'succeeded', findings: ['existing invariant'] }; },
    plan: async () => { events.push('plan'); return { status: 'succeeded', actions: ['implement smallest safe change'] }; },
    build: async () => { events.push('build'); return { status: 'succeeded', changed: true, workspace: 'isolated' }; },
    test: async () => { events.push('test'); return { status: 'succeeded', passed: 3 }; },
    verify: async () => { events.push('verify'); return { status: 'succeeded', evidence: 'tests=3' }; },
    learn: async () => { events.push('learn'); return { status: 'succeeded', lesson: 'safe path verified' }; }
  });

  const completed = await engine.run({
    goal: 'Improve a safe reliability path',
    category: 'reliability',
    confidence: 0.95
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.engine, 'self-improvement-v1');
  assert.equal(completed.classification.category, 'autonomous');
  assert.ok(completed.evidence_hash);
  assert.deepEqual(events, ['observe', 'research', 'plan', 'build', 'test', 'verify', 'learn']);

  const humanGate = await engine.run({
    goal: 'Deploy the new change to production',
    category: 'reliability',
    mutating_production: true
  });
  assert.equal(humanGate.status, 'blocked');
  assert.equal(humanGate.stop_reason, 'autonomy_frontier');

  const invalidCategory = await engine.run({
    goal: 'Modify production infrastructure',
    category: 'security',
    confidence: 0.9
  });
  assert.equal(invalidCategory.status, 'blocked');
  assert.equal(invalidCategory.stop_reason, 'category_not_autonomous');

  console.log('SELF_IMPROVEMENT_ENGINE_V1_OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
