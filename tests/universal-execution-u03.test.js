'use strict';

const assert = require('assert');
const { selectExecutor } = require('../autonomy/universal-execution/selector');

const baseRegistry = {
  list: () => [
    { executor_id: 'connector', type: 'connector', status: 'registered', operations: ['*'] },
    { executor_id: 'device', type: 'device', status: 'ready', operations: ['shell.execute'] },
    { executor_id: 'agent', type: 'agent', status: 'ready', operations: ['delegate'] }
  ]
};

const connector = selectExecutor({
  operation: 'repo_read',
  target: { type: 'connector', connector_id: 'github' }
}, baseRegistry);
assert.strictEqual(connector.type, 'connector');
assert.strictEqual(connector.selection_confidence, 'explicit');
assert.strictEqual(connector.selection_reason, 'explicit_target_type');

const explicitDevice = selectExecutor({
  operation: 'shell.execute',
  executor_type: 'device',
  target: { type: 'device', device_id: 'android-termux' }
}, baseRegistry);
assert.strictEqual(explicitDevice.type, 'device');
assert.strictEqual(explicitDevice.selection_reason, 'explicit_executor_type');

const inferredDevice = selectExecutor({
  operation: 'shell.execute',
  target: { type: 'device', device_id: 'android-termux' }
}, baseRegistry);
assert.strictEqual(inferredDevice.type, 'device');

const inferredAgent = selectExecutor({
  operation: 'delegate',
  target: { type: 'agent', agent_id: 'grok' }
}, baseRegistry);
assert.strictEqual(inferredAgent.type, 'agent');

assert.throws(() => selectExecutor({
  operation: 'delegate',
  executor_type: 'device',
  target: { type: 'agent', agent_id: 'grok' }
}, baseRegistry), e => e.code === 'executor_type_conflict');

assert.throws(() => selectExecutor({
  operation: 'shell.execute',
  target: { type: 'unknown', id: 'x' }
}, baseRegistry), e => e.code === 'unknown_executor_type');

assert.throws(() => selectExecutor({
  operation: 'unknown.operation'
}, baseRegistry), e => e.code === 'ambiguous_executor_selection');

assert.throws(() => selectExecutor({
  operation: 'delegate',
  executor_type: 'device',
  target: { type: 'device', device_id: 'android-termux' }
}, baseRegistry), e => e.code === 'operation_not_registered');

const ambiguous = { list: () => [
  { executor_id: 'a', type: 'a', status: 'ready', operations: ['x'] },
  { executor_id: 'b', type: 'b', status: 'ready', operations: ['x'] }
] };
assert.throws(() => selectExecutor({ operation: 'x', target: { type: 'a', id: 'x' } }, ambiguous), e => e.code === 'ambiguous_executor_selection');
assert.throws(() => selectExecutor({ operation: 'x' }, ambiguous), e => e.code === 'ambiguous_executor_selection');

console.log('UO-3 universal executor selector tests passed');
