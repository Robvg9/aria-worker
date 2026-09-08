'use strict';

const assert = require('assert');
const { createEasAdapter, OPERATIONS } = require('../autonomy/universal-execution/adapters/eas');
const { createAdapterRegistry } = require('../autonomy/universal-execution/adapters');
const { createUniversalExecutor } = require('../autonomy/universal-executor');
const { resolveExecutor, requiredTargetKey } = require('../autonomy/universal-execution/lookup');
const { selectExecutor } = require('../autonomy/universal-execution/selector');

const projectId = '1b23b091-f7b6-4dc2-b328-c8e5ec07de57';
const calls = [];
const client = Object.fromEntries(OPERATIONS.map((operation) => [operation.slice(4), async (input) => {
  calls.push({ operation, input });
  return { status: 'succeeded', payload: { operation } };
}]));

const adapter = createEasAdapter({ client });
assert.strictEqual(adapter.executor_type, 'eas');
assert.deepStrictEqual(adapter.operations, OPERATIONS);

const resolved = resolveExecutor({
  executor_type: 'eas',
  operation: 'eas.connection_status',
  target: { type: 'eas', project_id: projectId }
});
assert.strictEqual(resolved.type, 'eas');
assert.strictEqual(resolved.target.project_id, projectId);
assert.strictEqual(requiredTargetKey('eas'), 'project_id');

const selected = selectExecutor({
  operation: 'eas.workflow_list',
  target: { project_id: projectId }
});
assert.strictEqual(selected.type, 'eas');
assert.strictEqual(selected.selection_reason, 'target_identity_hint');

const registry = createAdapterRegistry({
  activation: { execute: async () => ({ status: 'succeeded' }) },
  deviceDispatcher: { execute: async () => ({ status: 'succeeded' }) },
  easClient: client
});
assert.ok(registry.get('eas'));
assert.strictEqual(registry.get('eas').status, 'ready');

const executor = createUniversalExecutor({
  activation: { execute: async () => ({ status: 'succeeded' }) },
  deviceDispatcher: { execute: async () => ({ status: 'succeeded' }) },
  easClient: client
});

(async () => {
  const result = await executor.execute({
    missionId: 'eas-contract-mission',
    step: {
      id: 'eas-step-1',
      executor_type: 'eas',
      operation: 'eas.connection_status',
      target: { type: 'eas', project_id: projectId },
      risk: 'READ'
    },
    policy: {}
  });

  assert.strictEqual(result.status, 'succeeded');
  assert.strictEqual(result.executor_type, 'eas');
  assert.strictEqual(result.project_id, projectId);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].operation, 'eas.connection_status');

  const blocked = await adapter.execute({
    missionId: 'eas-contract-mission',
    step: {
      id: 'eas-step-2',
      operation: 'eas.connection_status',
      target: { type: 'eas', project_id: '' }
    }
  });
  assert.strictEqual(blocked.status, 'blocked');
  assert.strictEqual(blocked.error.code, 'eas_project_id_required');

  console.log('EAS universal executor integration PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
