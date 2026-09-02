'use strict';

const assert = require('assert');
const { normalize } = require('../mcp-router/plan');

function run() {
  const base = {
    status: 'route', task_id: 't1', request_id: 'r1',
    plan: [{ tool_id: 'tool_a', operation: 'read', risk_class: 'READ', selection_reason: 'match' }]
  };

  const cases = [
    ['normalizes valid route', () => {
      const r = normalize(base);
      assert.strictEqual(r.status, 'plan');
      assert.strictEqual(r.authorization_required, true);
      assert.deepStrictEqual(r.steps[0], {
        step_id: 'step-1', index: 0, tool_id: 'tool_a', operation: 'read', risk_class: 'READ', selection_reason: 'match'
      });
    }],
    ['preserves order', () => {
      const r = normalize({ ...base, plan: [
        { tool_id: 'tool_b', operation: 'write', risk_class: 'LOW_RISK_WRITE', selection_reason: 'x' },
        { tool_id: 'tool_a', operation: 'read', risk_class: 'READ', selection_reason: 'y' }
      ]});
      assert.deepStrictEqual(r.steps.map(s => s.tool_id), ['tool_b', 'tool_a']);
      assert.deepStrictEqual(r.steps.map(s => s.index), [0, 1]);
    }],
    ['rejects non-route', () => assert.strictEqual(normalize({ ...base, status: 'no_route' }).status, 'no_plan')],
    ['rejects missing task id', () => assert.strictEqual(normalize({ ...base, task_id: '' }).status, 'no_plan')],
    ['rejects missing request id', () => assert.strictEqual(normalize({ ...base, request_id: '' }).status, 'no_plan')],
    ['rejects empty plan', () => assert.strictEqual(normalize({ ...base, plan: [] }).status, 'no_plan')],
    ['rejects unknown risk', () => assert.strictEqual(normalize({ ...base, plan: [{ ...base.plan[0], risk_class: 'UNKNOWN' }] }).status, 'no_plan')],
    ['rejects duplicate operation', () => assert.strictEqual(normalize({ ...base, plan: [base.plan[0], base.plan[0]] }).status, 'no_plan')],
    ['rejects missing selection reason', () => assert.strictEqual(normalize({ ...base, plan: [{ ...base.plan[0], selection_reason: '' }] }).status, 'no_plan')],
    ['rejects secret-like key', () => assert.strictEqual(normalize({ ...base, api_key: 'x' }).status, 'no_plan')],
    ['requires downstream authorization', () => assert.strictEqual(normalize(base).authorization_required, true)],
    ['does not authorize execution', () => {
      const r = normalize(base);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(r, 'approved_to_execute'), false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(r, 'executed'), false);
    }],
    ['does not invent steps', () => {
      const r = normalize(base);
      assert.strictEqual(r.steps.length, 1);
    }],
    ['supports multi-tool plan', () => {
      const r = normalize({ ...base, plan: [
        { tool_id: 'tool_a', operation: 'read', risk_class: 'READ', selection_reason: 'a' },
        { tool_id: 'tool_b', operation: 'write', risk_class: 'HIGH_RISK_WRITE', selection_reason: 'b' }
      ]});
      assert.strictEqual(r.steps.length, 2);
    }]
  ];

  for (const [name, test] of cases) { test(); console.log(`PASS ${name}`); }
  console.log(`\n${cases.length}/${cases.length} Tool Operation Planner tests passed`);
}

run();
