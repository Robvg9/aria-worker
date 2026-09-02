'use strict';

const assert = require('assert');
const { route, routePlan } = require('../mcp-router/lookup');

const registry = {
  tools: [
    {
      tool_id: 'tool_aria_context',
      status: 'available',
      operations: [{ operation: 'read', risk_level: 'read', capabilities: ['context_read'] }]
    },
    {
      tool_id: 'tool_aria_memory_capture',
      status: 'available',
      operations: [{ operation: 'write_candidate', risk_level: 'low_risk_write', capabilities: ['memory_capture'] }]
    },
    {
      tool_id: 'tool_unknown',
      status: 'unknown',
      operations: [{ operation: 'read', risk_level: 'read', capabilities: ['context_read'] }]
    }
  ]
};

function run() {
  const cases = [
    ['routes available exact capability', () => {
      const r = route({ task_id: 't1', request_id: 'r1', intent: 'read context', required_capability: 'context_read' }, registry);
      assert.strictEqual(r.status, 'route');
      assert.deepStrictEqual(r.plan.map(x => x.tool_id), ['tool_aria_context']);
    }],
    ['unknown tools are ignored', () => {
      const r = route({ task_id: 't2', request_id: 'r2', intent: 'read context', required_capability: 'context_read' }, registry);
      assert.ok(!r.plan.some(x => x.tool_id === 'tool_unknown'));
    }],
    ['missing task id blocks', () => assert.strictEqual(route({ request_id: 'r3', intent: 'x' }, registry).status, 'no_route')],
    ['missing intent blocks', () => assert.strictEqual(route({ task_id: 't4', request_id: 'r4' }, registry).status, 'no_route')],
    ['preferred tool filters valid candidates', () => {
      const r = route({ task_id: 't5', request_id: 'r5', intent: 'capture', preferred_tool_id: 'tool_aria_memory_capture' }, registry);
      assert.deepStrictEqual(r.plan.map(x => x.tool_id), ['tool_aria_memory_capture']);
    }],
    ['preferred operation filters valid candidates', () => {
      const r = route({ task_id: 't6', request_id: 'r6', intent: 'capture', preferred_operation: 'write_candidate' }, registry);
      assert.deepStrictEqual(r.plan.map(x => x.operation), ['write_candidate']);
    }],
    ['invalid capability yields no route', () => assert.strictEqual(route({ task_id: 't7', request_id: 'r7', intent: 'x', required_capability: 'missing' }, registry).status, 'no_route')],
    ['invalid risk is rejected', () => {
      const bad = { tools: [{ tool_id: 'bad', status: 'available', operations: [{ operation: 'x', risk_level: 'evil', capabilities: [] }] }] };
      assert.strictEqual(route({ task_id: 't8', request_id: 'r8', intent: 'x' }, bad).status, 'no_route');
    }],
    ['multi-tool plan routes every step independently', () => {
      const r = routePlan({ task_id: 't9', request_id: 'r9', intent: 'chain', steps: [
        { required_capability: 'context_read' },
        { required_capability: 'memory_capture' }
      ] }, registry);
      assert.strictEqual(r.status, 'route');
      assert.deepStrictEqual(r.plan.map(x => x.operation), ['read', 'write_candidate']);
    }],
    ['empty multi-tool plan blocks', () => assert.strictEqual(routePlan({ task_id: 't10', request_id: 'r10', intent: 'chain', steps: [] }, registry).status, 'no_route')],
    ['single-step preference remains scoped', () => {
      const r = routePlan({ task_id: 't11', request_id: 'r11', intent: 'chain', steps: [
        { preferred_tool_id: 'tool_aria_context' },
        { required_capability: 'memory_capture' }
      ] }, registry);
      assert.strictEqual(r.status, 'route');
      assert.deepStrictEqual(r.plan.map(x => x.tool_id), ['tool_aria_context', 'tool_aria_memory_capture']);
    }]
  ];

  for (const [name, test] of cases) { test(); console.log(`PASS ${name}`); }
  console.log(`\n${cases.length}/${cases.length} Tool Router tests passed`);
}

run();
