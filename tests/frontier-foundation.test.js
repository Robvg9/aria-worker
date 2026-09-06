'use strict';
const assert = require('node:assert/strict');
const { createResourceBudget } = require('../resources/budget');
const { createAgentCard, createTask, validateTask, createMessage } = require('../interoperability/a2a-contract');

const budget = createResourceBudget({ limits: { tokens: 100, usd: 1, actions: 2 } });
assert.equal(budget.consume({ tokens: 40, usd: 0.2, actions: 1 }).ok, true);
assert.equal(budget.canConsume({ tokens: 60 }), true);
assert.equal(budget.consume({ actions: 2 }).ok, false);
assert.equal(budget.consume({ actions: 1 }).ok, true);
assert.equal(budget.consume({ tokens: 61 }).reason, 'budget_exceeded');

const card = createAgentCard({ id: 'aria-peer', name: 'ARIA Peer', url: 'https://example.test/a2a', capabilities: ['research'], skills: ['web-research'] });
assert.equal(card.protocol, 'A2A');
assert.deepEqual(card.capabilities, ['research']);
const task = createTask({ task_id: 't1', state: 'working' });
assert.equal(validateTask(task).valid, true);
assert.equal(validateTask({ task_id: 't2', status: { state: 'nope' } }).valid, false);
const msg = createMessage({ message_id: 'm1', task_id: 't1', role: 'agent', parts: [{ type: 'text', text: 'done' }] });
assert.equal(msg.role, 'agent');
console.log('FRONTIER FOUNDATION TESTS PASS');
