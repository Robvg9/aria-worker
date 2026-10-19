'use strict';

function createSelfImprovementAdapter({ coordinator } = {}) {
  const engine = coordinator?.engine || coordinator;
  if (!engine || typeof engine.run !== 'function') throw new TypeError('self-improvement engine required');

  async function execute({ missionId, step, policy, request = {} } = {}) {
    const input = step?.input && typeof step.input === 'object' ? { ...step.input } : {};
    const { approve_promote: _approvePromote, approve_deploy: _approveDeploy, ...safeInput } = input;
    const signal = {
      ...safeInput,
      goal: typeof safeInput.goal === 'string' && safeInput.goal.trim() ? safeInput.goal : String(step?.goal || ''),
      mission_id: missionId || null,
      step_id: step?.id || null,
      policy: policy && typeof policy === 'object' ? policy : {},
      request: request && typeof request === 'object' ? request : {},
      approve_promote: false,
      approve_deploy: false
    };
    if (!signal.goal.trim()) return { status: 'blocked', reason: 'improvement_goal_required' };
    const result = await engine.run(signal);
    return {
      ...result,
      operation: 'self.improve',
      self_improvement: true,
      human_gate_preserved: true,
      promotion_authority: 'human_gate'
    };
  }

  return Object.freeze({
    adapter_id: 'self-improvement-engine-v1',
    executor_type: 'self_improvement',
    status: 'ready',
    operations: ['self.improve'],
    execute
  });
}

module.exports = Object.freeze({ createSelfImprovementAdapter });
