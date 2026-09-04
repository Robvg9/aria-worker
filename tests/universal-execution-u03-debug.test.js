'use strict';
const assert = require('assert');
const { selectExecutor } = require('../autonomy/universal-execution/selector');

const registry = { list: () => [
  { executor_id: 'connector', type: 'connector', status: 'registered', operations: ['*'] },
  { executor_id: 'device', type: 'device', status: 'ready', operations: ['shell.execute'] },
  { executor_id: 'agent', type: 'agent', status: 'ready', operations: ['delegate'] }
] };

let caught = null;
try {
  selectExecutor({
    operation: 'shell.execute',
    executor_type: 'unknown',
    target: { type: 'unknown', id: 'x' }
  }, registry);
} catch (error) {
  caught = error;
}

assert(caught, 'selector must reject unknown executor');
assert.strictEqual(caught.code, 'unknown_executor_type');
console.log('UO-3 isolated unknown-executor selector test passed');
