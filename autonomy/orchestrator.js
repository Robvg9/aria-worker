'use strict';

const crypto = require('crypto');

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const RETRYABLE = new Set(['failed', 'timeout']);

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function stableId(parts) {
  const raw = JSON.stringify(parts, Object.keys(parts).sort());
  return `step_${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 20)}`;
}

function createAutonomousMissionOrchestrator({ missionStore, planner, executor, verify, policy = {}, now = () => new Date().toISOString() } = {}) {
  if (!missionStore || typeof missionStore !== 'object') throw new TypeError('missionStore required');
  requireFn(missionStore.get, 'missionStore.get');
  requireFn(missionStore.transition, 'missionStore.transition');
  requireFn(missionStore.checkpoint, 'missionStore.checkpoint');
  requireFn(planner, 'planner');
  requireFn(executor, 'executor');
  requireFn(verify, 'verify');

  const limits = Object.freeze({
    max_steps: Number.isInteger(policy.max_steps) && policy.max_steps > 0 ? policy.max_steps : 20,
    max_attempts_per_step: Number.isInteger(policy.max_attempts_per_step) && policy.max_attempts_per_step > 0 ? policy.max_attempts_per_step : 2
  });

  async function run(missionId) {
    let mission = await missionStore.get(missionId);
    if (!mission) throw new Error(`mission not found: ${missionId}`);
    if (TERMINAL.has(mission.status)) return { status: mission.status, mission };

    if (mission.status === 'queued' || mission.status === 'blocked' || mission.status === 'paused' || mission.status === 'failed') {
      mission = await missionStore.transition(missionId, 'planning');
    }

    let plan = mission.checkpoint && Array.isArray(mission.checkpoint.plan) ? mission.checkpoint.plan : null;
    if (!plan) {
      plan = await planner({ mission, checkpoint: mission.checkpoint || {} });
      if (!Array.isArray(plan) || plan.length === 0) {
        await missionStore.transition(missionId, 'blocked', { next_action: 'human_gate: planner returned no executable steps' });
        return { status: 'blocked', reason: 'plan_missing' };
      }
      plan = plan.map((step, index) => ({
        id: step.id || stableId({ missionId, index, action: step.action || step.operation || null }),
        action: step.action || step.operation || 'unknown',
        operation: step.operation || null,
        target: step.target || null,
        input: step.input && typeof step.input === 'object' ? step.input : {},
        policy: step.policy && typeof step.policy === 'object' ? step.policy : {},
        verify: step.verify && typeof step.verify === 'object' ? step.verify : {},
        retryable: step.retryable !== false
      }));
      mission = await missionStore.checkpoint(missionId, { ...(mission.checkpoint || {}), plan, planned_at: now() }, { total_steps: plan.length, current_step: mission.current_step || 0 });
    }

    mission = await missionStore.transition(missionId, 'running', { total_steps: plan.length });

    for (let index = mission.completed_steps || 0; index < plan.length; index += 1) {
      if (index >= limits.max_steps) {
        await missionStore.transition(missionId, 'paused', { current_step: index, next_action: 'resume: step budget exhausted' });
        return { status: 'step_limit', mission };
      }

      const step = plan[index];
      let attempt = 0;
      let outcome = null;
      while (attempt < limits.max_attempts_per_step) {
        attempt += 1;
        await missionStore.checkpoint(missionId, { ...(mission.checkpoint || {}), plan, active_step: step, active_step_index: index, last_attempt_at: now() }, {
          current_step: index,
          attempt_count: attempt,
          next_action: step.action
        });

        try {
          const result = await executor({ missionId, mission, step, attempt });
          const passed = await verify({ missionId, mission, step, result, attempt });
          outcome = { result, passed, attempt };
          if (passed) break;
          outcome.error = 'verification_failed';
        } catch (error) {
          outcome = { error: String(error && error.message || error), passed: false, attempt };
        }

        if (outcome.passed) break;
        if (!step.retryable || !RETRYABLE.has(outcome.result?.status || 'failed') || attempt >= limits.max_attempts_per_step) break;
      }

      if (!outcome || !outcome.passed) {
        await missionStore.transition(missionId, 'failed', {
          current_step: index,
          attempt_count: outcome?.attempt || limits.max_attempts_per_step,
          next_action: 'recover_or_human_gate',
          last_stderr: outcome?.error || outcome?.result?.stderr || null,
          last_exit_code: outcome?.result?.exit_code ?? null,
          last_stdout: outcome?.result?.stdout ?? null
        });
        return { status: 'failed', step, outcome };
      }

      mission = await missionStore.checkpoint(missionId, {
        ...(mission.checkpoint || {}), plan, completed_step: step.id, completed_at: now(), last_result: outcome.result
      }, {
        current_step: index + 1,
        completed_steps: index + 1,
        last_command: outcome.result?.command || null,
        last_exit_code: outcome.result?.exit_code ?? null,
        last_stdout: outcome.result?.stdout ?? null,
        last_stderr: outcome.result?.stderr ?? null,
        next_action: index + 1 < plan.length ? plan[index + 1].action : 'verify_goal'
      });
    }

    const finalVerification = await verify({ missionId, mission, final: true, plan });
    if (!finalVerification) {
      await missionStore.transition(missionId, 'failed', { next_action: 'human_gate: final verification failed' });
      return { status: 'verification_failed' };
    }

    mission = await missionStore.transition(missionId, 'succeeded', { current_step: plan.length, completed_steps: plan.length, next_action: null });
    return { status: 'succeeded', mission };
  }

  return Object.freeze({ limits, run });
}

module.exports = Object.freeze({ createAutonomousMissionOrchestrator, stableId });
