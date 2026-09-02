'use strict';

const assert = require('node:assert/strict');
const router = require('../mcp-router/lookup');
const planner = require('../mcp-router/plan');
const gateway = require('../mcp-gateway');
const registry = require('../tools/registry.json');

const tool = {
  tool_id: 'tool_test',
  status: 'available',
  operations: ['read', 'write_candidate'],
  risk_level: 'read',
  capabilities: ['read']
};

const baseTask = {
  task_id: 'task-c',
  request_id: 'request-c',
  intent: 'read context',
  required_capability: null,
  preferred_tool_id: 'tool_test',
  preferred_operation: 'read'
};

const authorizedRead = {
  authorization_id: 'auth-c-read',
  execution_id: 'exec-c-read',
  request_id: 'request-c',
  tool_id: 'tool_test',
  operation: 'read',
  risk_class: 'READ',
  decision: 'approved',
  reviewed_by: 'Robert',
  reviewed_at: '2026-09-02T00:00:00Z',
  policy_version: 'governance-v1'
};

function routeTask(overrides = {}) {
  return router.route({ ...baseTask, ...overrides }, { ...registry, tools: [tool] });
}

async function run() {
  // 11.2 deterministic route.
  const routed = routeTask();
  assert.equal(routed.status, 'route');
  assert.deepEqual(routed.plan, [{
    tool_id: 'tool_test',
    operation: 'read',
    risk_class: 'READ',
    selection_reason: 'preferred_candidate'
  }]);

  const routedAgain = routeTask();
  assert.deepEqual(routedAgain, routed, 'same task produces the same route');

  // 11.3 explicit normalization and scope preservation.
  const planned = planner.normalize(routed);
  assert.equal(planned.status, 'plan');
  assert.deepEqual(planned.steps[0], {
    step_id: 'step-1',
    index: 0,
    tool_id: 'tool_test',
    operation: 'read',
    risk_class: 'READ',
    selection_reason: 'preferred_candidate'
  });
  assert.equal(planned.authorization_required, true);

  assert.equal(planner.normalize({ ...routed, plan: [] }).reason, 'empty_plan');
  assert.equal(planner.normalize({ ...routed, plan: [{ ...routed.plan[0], operation: 'read' }, { ...routed.plan[0] }] }).reason, 'duplicate_operation_1');
  assert.equal(planner.normalize({ ...routed, plan: [{ ...routed.plan[0], selection_reason: '' }] }).reason, 'missing_selection_reason_0');
  assert.equal(planner.normalize({ ...routed, plan: [{ ...routed.plan[0], risk_class: 'UNKNOWN' }] }).reason, 'invalid_risk_class_0');
  assert.equal(planner.normalize({ ...routed, authorization: 'secret' }).reason, 'invalid_route_result');

  // 11.1/11.4 controlled dispatch through injected adapter only.
  const request = {
    request_id: 'request-c',
    task_id: 'task-c',
    execution_id: 'exec-c-read',
    tool_id: 'tool_test',
    operation: 'read',
    input: { path: 'README.md' },
    authorization_id: 'auth-c-read',
    risk_class: 'READ'
  };

  let adapterCalls = 0;
  const adapter = {
    async execute(input) {
      adapterCalls += 1;
      assert.equal(input.tool_id, 'tool_test');
      assert.equal(input.operation, 'read');
      assert.equal(input.authorization_id, 'auth-c-read');
      return { status: 'succeeded', result: { content: 'ok' }, metadata: { mode: 'mock' } };
    }
  };

  const dispatched = await gateway.dispatchAuthorized({
    request,
    tool,
    authorization: authorizedRead,
    adapter
  });
  assert.equal(dispatched.status, 'succeeded');
  assert.equal(dispatched.result.content, 'ok');
  assert.equal(dispatched.metadata.dispatch_attempted, true);
  assert.equal(adapterCalls, 1);

  // Authorization remains bound to exact scope.
  const wrongExecution = await gateway.dispatchAuthorized({
    request,
    tool,
    authorization: { ...authorizedRead, execution_id: 'other' },
    adapter
  });
  assert.equal(wrongExecution.status, 'blocked');
  assert.equal(wrongExecution.reason, 'execution_scope_mismatch');
  assert.equal(adapterCalls, 1, 'blocked authorization never reaches adapter');

  // High-risk requires verification; approval alone is insufficient.
  const highRiskTool = { ...tool, risk_level: 'high_risk_write' };
  const highRiskRequest = { ...request, operation: 'write_candidate', risk_class: 'HIGH_RISK_WRITE' };
  const highRiskAuth = { ...authorizedRead, authorization_id: 'auth-c-high', execution_id: 'exec-c-high', operation: 'write_candidate', risk_class: 'HIGH_RISK_WRITE' };
  const highRiskBlocked = await gateway.dispatchAuthorized({
    request: { ...highRiskRequest, execution_id: 'exec-c-high', authorization_id: 'auth-c-high' },
    tool: highRiskTool,
    authorization: highRiskAuth,
    adapter
  });
  assert.equal(highRiskBlocked.status, 'blocked');
  assert.equal(highRiskBlocked.reason, 'human_verification_required');
  assert.equal(adapterCalls, 1);

  const highRiskReady = await gateway.dispatchAuthorized({
    request: { ...highRiskRequest, execution_id: 'exec-c-high', authorization_id: 'auth-c-high' },
    tool: highRiskTool,
    authorization: highRiskAuth,
    verification: { status: 'verified', verification_ref: 'vr-c-high' },
    adapter
  });
  assert.equal(highRiskReady.status, 'succeeded');
  assert.equal(adapterCalls, 2);

  // Fail closed when adapter missing or output contains sensitive material.
  const noAdapter = await gateway.dispatchAuthorized({ request, tool, authorization: authorizedRead });
  assert.equal(noAdapter.status, 'blocked');
  assert.equal(noAdapter.reason, 'adapter_unavailable');

  const secretAdapter = {
    async execute() { return { status: 'succeeded', result: { message: 'Bearer abc-secret' } }; }
  };
  const sensitive = await gateway.dispatchAuthorized({ request, tool, authorization: authorizedRead, adapter: secretAdapter });
  assert.equal(sensitive.status, 'blocked');
  assert.equal(sensitive.reason, 'sensitive_output_rejected');

  // Malformed adapter result normalizes safely.
  const malformed = await gateway.dispatchAuthorized({
    request,
    tool,
    authorization: authorizedRead,
    adapter: { async execute() { return null; } }
  });
  assert.equal(malformed.status, 'failed');
  assert.equal(malformed.error_code, 'invalid_adapter_result');

  // Multi-step routing keeps each step explicit; planner remains deterministic.
  const multi = router.routePlan({
    task_id: 'task-multi',
    request_id: 'request-multi',
    intent: 'two steps',
    steps: [
      { preferred_tool_id: 'tool_test', preferred_operation: 'read' },
      { preferred_tool_id: 'tool_test', preferred_operation: 'write_candidate', risk_level: 'low_risk_write' }
    ]
  }, { ...registry, tools: [tool, { ...tool, risk_level: 'low_risk_write' }] });
  assert.equal(multi.status, 'route');
  assert.equal(multi.plan.length, 2);
  const normalizedMulti = planner.normalize(multi);
  assert.equal(normalizedMulti.status, 'plan');
  assert.equal(normalizedMulti.steps.length, 2);

  console.log('PASS: Block C 11.1/11.2/11.3/11.4 integration and security tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
