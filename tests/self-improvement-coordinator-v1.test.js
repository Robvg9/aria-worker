'use strict';

const assert = require('node:assert/strict');
const { createSelfImprovementCoordinatorV1 } = require('../autonomy/self-improvement-coordinator-v1');

async function main() {
  const files = new Map([['autonomy/demo.js', 'module.exports = 1;']]);
  const snapshot = async keys => ({ identity: 'ARIA', version: 'test', capabilities: ['self_development'], tools: ['workspace'], tests: keys.includes('tests') ? { status: 'ready' } : undefined, git: { branch: 'isolated' } });
  const workspace = {
    read: async path => files.get(path) || '',
    apply: async change => { files.set(change.path, change.content || '// changed'); return { status: 'succeeded' }; }
  };
  const coordinator = createSelfImprovementCoordinatorV1({
    snapshot,
    workspace,
    testRunner: async () => ({ status: 'succeeded', passed: 1 }),
    writer: async () => ({ status: 'succeeded', documented: true }),
    policy: { max_risk: 'low' }
  });

  const result = await coordinator.engine.run({
    goal: 'Harden a safe demo module',
    category: 'reliability',
    proposed_changes: [{ type: 'modify_file', path: 'autonomy/demo.js', content: 'module.exports = 2;', risk_level: 'low' }]
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.classification.category, 'autonomous');
  assert.equal(files.get('autonomy/demo.js'), 'module.exports = 2;');
  console.log('SELF_IMPROVEMENT_COORDINATOR_V1_OK');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
