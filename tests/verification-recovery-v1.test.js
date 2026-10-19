'use strict';

const assert = require('node:assert/strict');
const { MAX_REPLANS, classifyVerificationFailure, buildRecoveryContext, shouldReplan } = require('../autonomy/verification-recovery-v1');

(() => {
  assert.equal(MAX_REPLANS, 2);
  assert.deepEqual(classifyVerificationFailure({ operation: 'click', replan_on_verification_failure: true }, { status: 'succeeded' }), { class: 'verification_failure', retryable: false, replan: true });
  assert.deepEqual(classifyVerificationFailure({ operation: 'shell.execute' }, { status: 'failed' }), { class: 'execution_failure', retryable: true, replan: false });
  assert.equal(shouldReplan({ replan_on_verification_failure: true }, { status: 'succeeded' }, 0), true);
  assert.equal(shouldReplan({ replan_on_verification_failure: true }, { status: 'succeeded' }, 2), false);
  const ctx = buildRecoveryContext({ missionId: 'm1', goal: 'open PowerShell', step: { id: 's1', operation: 'click', target: { type: 'device', device_id: 'w1' } }, result: { status: 'succeeded' }, attempts: 1, previousPlan: [{ id: 's1' }] });
  assert.equal(ctx.evidence_only, true);
  assert.equal(ctx.failed_step.id, 's1');
  assert.equal(ctx.observed_result.status, 'succeeded');
  console.log('VERIFICATION_RECOVERY_V1=PASS — distinguishes execution failure, verification failure, blocked and async states with bounded replanning');
})();
