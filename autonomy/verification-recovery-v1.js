'use strict';

const MAX_REPLANS = 2;

function classifyVerificationFailure(step, result) {
  const status = String(result?.status || 'unknown');
  if (status === 'waiting') return Object.freeze({ class: 'async_wait', retryable: false, replan: false });
  if (status === 'blocked' || status === 'cancelled') return Object.freeze({ class: 'blocked', retryable: false, replan: false });
  if (status === 'failed' || status === 'timeout') return Object.freeze({ class: 'execution_failure', retryable: step?.retryable !== false, replan: step?.replan_on_failure === true });
  if (status === 'succeeded' || result?.ok === true) return Object.freeze({ class: 'verification_failure', retryable: false, replan: step?.replan_on_verification_failure === true });
  return Object.freeze({ class: 'unknown_failure', retryable: false, replan: step?.replan_on_failure === true });
}

function buildRecoveryContext({ missionId, goal, step, result, attempts = 0, previousPlan = [] } = {}) {
  return Object.freeze({
    version: 'verification-recovery-v1.0',
    mission_id: missionId || null,
    goal: typeof goal === 'string' ? goal : '',
    failed_step: step ? {
      id: step.id || null,
      operation: step.operation || null,
      executor_type: step.executor_type || step.target?.type || null,
      target: step.target || null,
      verify: step.verify || null,
    } : null,
    observed_result: result || null,
    attempt: attempts,
    replan_count: attempts,
    previous_plan_step_count: Array.isArray(previousPlan) ? previousPlan.length : 0,
    evidence_only: true,
  });
}

function shouldReplan(step, result, replanCount = 0) {
  if (replanCount >= MAX_REPLANS) return false;
  const failure = classifyVerificationFailure(step, result);
  return failure.replan === true;
}

module.exports = Object.freeze({ MAX_REPLANS, classifyVerificationFailure, buildRecoveryContext, shouldReplan });
