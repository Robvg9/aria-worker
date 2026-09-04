'use strict';

const assert = require('node:assert/strict');
const { createDispatchBoundary } = require('../autonomy/universal-execution/dispatch-boundary');

(async () => {
  const calls = [];
  const adapter = {
    adapter_id: 'mock-adapter-v1',
    executor_type: 'connector',
    status: 'ready',
    operations: ['github:read'],
    async execute(input) {
      calls.push(input);
      return { status: 'succeeded', output: { ok: true } };
    }
  };

  const boundary = createDispatchBoundary({ adapters: { get: (type) => type === 'connector' ? adapter : null } });

  const ok = await boundary.dispatch({
    missionId: 'm1',
    step: { id: 'step_1', executor_type: 'connector', operation: 'github:read', target: { type: 'connector', connector_id: 'github' }, input: {} }
  });
  assert.deepEqual(ok, { status: 'succeeded', output: { ok: true }, adapter_id: 'mock-adapter-v1', executor_type: 'connector' });
  assert.equal(calls.length, 1);

  const unavailable = await boundary.dispatch({
    step: { executor_type: 'device', operation: 'github:read', target: { type: 'device', device_id: 'android-termux' } }
  });
  assert.deepEqual(unavailable, { status: 'blocked', reason: 'executor_adapter_unavailable', executor_type: 'device' });

  const badOperation = await boundary.dispatch({
    step: { executor_type: 'connector', operation: 'github:write', target: { type: 'connector', connector_id: 'github' } }
  });
  assert.deepEqual(badOperation, { status: 'blocked', executor_type: 'connector', reason: 'operation_not_supported' });

  const badTarget = await boundary.dispatch({
    step: { executor_type: 'connector', operation: 'github:read', target: { type: 'connector' } }
  });
  assert.deepEqual(badTarget, { status: 'blocked', executor_type: 'connector', reason: 'connector_target_missing' });

  const sensitiveAdapter = { ...adapter, async execute() { return { status: 'succeeded', output: { token: 'hidden' } }; } };
  const sensitiveBoundary = createDispatchBoundary({ adapters: { get: () => sensitiveAdapter } });
  const sensitive = await sensitiveBoundary.dispatch({ step: { executor_type: 'connector', operation: 'github:read', target: { type: 'connector', connector_id: 'github' } } });
  assert.deepEqual(sensitive, { status: 'blocked', reason: 'sensitive_output_rejected' });

  const throwingAdapter = { ...adapter, async execute() { throw new Error('adapter failed'); } };
  const throwingBoundary = createDispatchBoundary({ adapters: { get: () => throwingAdapter } });
  const failed = await throwingBoundary.dispatch({ step: { executor_type: 'connector', operation: 'github:read', target: { type: 'connector', connector_id: 'github' } } });
  assert.deepEqual(failed, { status: 'failed', executor_type: 'connector', adapter_id: 'mock-adapter-v1', error: { code: 'adapter_error', message: 'adapter dispatch failed' } });

  console.log('UO-10 governed adapter dispatch boundary tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
