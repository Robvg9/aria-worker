'use strict';

const assert = require('assert');
const { listExecutors, resolveExecutor } = require('../autonomy/universal-execution/lookup');

const executors = listExecutors();
assert.deepStrictEqual(executors.map((e) => e.type), ['connector', 'device', 'agent']);
assert.strictEqual(executors[0].operations.includes('*'), true);
assert.strictEqual(executors[1].operations.includes('shell.execute'), true);
assert.strictEqual(executors[2].operations.includes('delegate'), true);

assert.deepStrictEqual(
  resolveExecutor({ operation: 'repo_read', target: { type: 'connector', connector_id: 'github' } }),
  {
    executor_id: 'connector',
    type: 'connector',
    operation: 'repo_read',
    target: { type: 'connector', connector_id: 'github' }
  }
);

assert.deepStrictEqual(
  resolveExecutor({ operation: 'shell.execute', executor_type: 'device', target: { type: 'device', device_id: 'android-termux' } }),
  {
    executor_id: 'device',
    type: 'device',
    operation: 'shell.execute',
    target: { type: 'device', device_id: 'android-termux' }
  }
);

assert.throws(
  () => resolveExecutor({ operation: 'delegate', target: { type: 'agent' } }),
  (error) => error.code === 'executor_target_missing'
);

assert.throws(
  () => resolveExecutor({ operation: 'shell.execute', target: { type: 'unknown', id: 'x' } }),
  (error) => error.code === 'unknown_executor_type'
);

assert.throws(
  () => resolveExecutor({ operation: 'delegate', target: { type: 'device', device_id: 'x' } }),
  (error) => error.code === 'operation_not_registered'
);

console.log('UO-1 universal execution registry tests passed');
