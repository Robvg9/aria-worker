'use strict';
const assert = require('assert');
const { route, routePlan } = require('../mcp-router/lookup');

const registry = { tools: [
  { tool_id: 'tool_aria_context', status: 'available', operations: ['read'], risk_level: 'read' },
  { tool_id: 'tool_aria_memory_capture', status: 'available', operations: ['write_candidate'], risk_level: 'low_risk_write' },
  { tool_id: 'tool_unknown', status: 'unknown', operations: ['read'], risk_level: 'read' }
] };

const cases = [
  ['exact operation routes', () => {
    const r = route({ task_id: 't1', request_id: 'r1', intent: 'read context', operation: 'read' }, registry);
    assert.strictEqual(r.status, 'route'); assert.deepStrictEqual(r.plan.map(x => x.tool_id), ['tool_aria_context']);
  }],
  ['preferred tool routes', () => {
    const r = route({ task_id: 't2', request_id: 'r2', intent: 'capture', preferred_tool_id: 'tool_aria_memory_capture' }, registry);
    assert.strictEqual(r.status, 'route'); assert.deepStrictEqual(r.plan.map(x => x.tool_id), ['tool_aria_memory_capture']);
  }],
  ['preferred operation routes', () => {
    const r = route({ task_id: 't3', request_id: 'r3', intent: 'capture', preferred_operation: 'write_candidate' }, registry);
    assert.strictEqual(r.status, 'route'); assert.deepStrictEqual(r.plan.map(x => x.operation), ['write_candidate']);
  }],
  ['unknown tool is never selected', () => {
    const r = route({ task_id: 't4', request_id: 'r4', intent: 'read context', operation: 'read' }, registry);
    assert.ok(!r.plan.some(x => x.tool_id === 'tool_unknown'));
  }],
  ['missing identity blocks', () => assert.strictEqual(route({ request_id: 'r5', intent: 'x', operation: 'read' }, registry).status, 'no_route')],
  ['missing intent blocks', () => assert.strictEqual(route({ task_id: 't6', request_id: 'r6', operation: 'read' }, registry).status, 'no_route')],
  ['insufficient selection intent blocks', () => assert.strictEqual(route({ task_id: 't7', request_id: 'r7', intent: 'x' }, registry).status, 'no_route')],
  ['unknown operation yields no route', () => assert.strictEqual(route({ task_id: 't8', request_id: 'r8', intent: 'x', operation: 'delete' }, registry).status, 'no_route')],
  ['invalid risk is rejected', () => {
    const bad = { tools: [{ tool_id: 'bad', status: 'available', operations: ['x'], risk_level: 'evil' }] };
    assert.strictEqual(route({ task_id: 't9', request_id: 'r9', intent: 'x', operation: 'x' }, bad).status, 'no_route');
  }],
  ['ambiguous selection fails closed', () => assert.strictEqual(route({ task_id: 't10', request_id: 'r10', intent: 'x' }, registry).status, 'no_route')],
  ['multi-tool plan routes each step independently', () => {
    const r = routePlan({ task_id: 't11', request_id: 'r11', intent: 'chain', steps: [
      { operation: 'read' }, { operation: 'write_candidate' }
    ] }, registry);
    assert.strictEqual(r.status, 'route'); assert.deepStrictEqual(r.plan.map(x => x.operation), ['read', 'write_candidate']);
  }],
  ['empty plan blocks', () => assert.strictEqual(routePlan({ task_id: 't12', request_id: 'r12', intent: 'chain', steps: [] }, registry).status, 'no_route')],
  ['step failure blocks whole plan', () => assert.strictEqual(routePlan({ task_id: 't13', request_id: 'r13', intent: 'chain', steps: [{ operation: 'read' }, { operation: 'delete' }] }, registry).status, 'no_route')]
];

for (const [name, test] of cases) { test(); console.log(`PASS ${name}`); }
console.log(`\n${cases.length}/${cases.length} Tool Router tests passed`);
