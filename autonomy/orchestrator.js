'use strict';

const crypto = require('crypto');
const { createAutonomyPolicy, riskAllowed } = require('./policy');
const { normalizePlan, nextReadyStep, dependenciesSatisfied } = require('./universal-execution/plan');

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

  const p = createAutonomyPolicy(policy);
  const limits = Object.freeze({
    max_steps: p.max_steps,
    max_attempts_per_step: Number.isInteger(policy.max_attempts_per_step) && policy.max_attempts_per_step > 0 ? policy.max_attempts_per_step : 2
  });

  async function run(missionId) {
    if (!p.enabled) return { status: 'disabled', reason: 'autonomy_disabled' };
    const started = Date.now();
    let mission = await missionStore.get(missionId);
    if (!mission) throw new Error(`mission not found: ${missionId}`);
    if (TERMINAL.has(mission.status)) return { status: mission.status, mission };
    if (mission.status === 'queued' || mission.status === 'blocked' || mission.status === 'paused' || mission.status === 'failed') {
      mission = await missionStore.transition(missionId, 'planning');
    }

    let plan = mission.checkpoint && Array.isArray(mission.checkpoint.plan) ? mission.checkpoint.plan : null;
    if (!plan) {
      plan = await planner({ mission, checkpoint: mission.checkpoint || {}, policy: p });
      try {
        plan = normalizePlan(plan).map((step, index) => ({
          id: step.id || stableId({ missionId, index, action: step.action || step.operation || null }),
          action: step.action || step.operation || 'unknown',
          operation: step.operation || null,
          target: step.target || null,
          input: step.input && typeof step.input === 'object' ? step.input : {},
          policy: step.policy && typeof step.policy === 'object' ? step.policy : {},
          verify: step.verify && typeof step.verify === 'object' ? step.verify : {},
          retryable: step.retryable !== false,
          risk: step.risk || step.policy?.risk || 'critical',
          depends_on: step.depends_on || []
        }));
      } catch (error) {
        await missionStore.transition(missionId, 'blocked', { next_action: `human_gate: invalid plan (${String(error.message || error)})` });
        return { status: 'blocked', reason: 'plan_invalid' };
      }
      if (plan.length === 0) {
        await missionStore.transition(missionId, 'blocked', { next_action: 'human_gate: planner returned no executable steps' });
        return { status: 'blocked', reason: 'plan_missing' };
      }
      mission = await missionStore.checkpoint(missionId, { ...(mission.checkpoint || {}), plan, planned_at: now() }, { total_steps: plan.length, current_step: mission.current_step || 0 });
    } else {
      try { plan = normalizePlan(plan); } catch (error) {
        await missionStore.transition(missionId, 'blocked', { next_action: `human_gate: stored plan invalid (${String(error.message || error)})` });
        return { status: 'blocked', reason: 'plan_invalid' };
      }
    }

    mission = await missionStore.transition(missionId, 'running', { total_steps: plan.length });

    const completedIds = new Set((mission.checkpoint?.completed_steps || []).map(String));
    if (mission.completed_step) completedIds.add(String(mission.completed_step));
    let completedCount = Number.isInteger(mission.completed_steps) ? mission.completed_steps : completedIds.size;
    const startedIds = new Set();

    while (completedCount < plan.length) {
      if (Date.now() - started >= p.max_runtime_ms) {
        await missionStore.transition(missionId, 'paused', { current_step: completedCount, next_action: 'resume: runtime budget exhausted' });
        return { status: 'time_limit', mission };
      }
      if (completedCount >= limits.max_steps) {
        await missionStore.transition(missionId, 'paused', { current_step: completedCount, next_action: 'resume: step budget exhausted' });
        return { status: 'step_limit', mission };
      }

      const step = nextReadyStep(plan, completedIds, startedIds);
      if (!step) {
        const unresolved = plan.filter(item => !completedIds.has(item.id));
        const waiting = unresolved.filter(item => !item.depends_on.every(dep => completedIds.has(dep)));
        await missionStore.transition(missionId, 'blocked', {
          current_step: completedCount,
          next_action: waiting.length ? 'human_gate: dependency graph cannot make progress' : 'human_gate: executable step unavailable'
        });
        return { status: 'blocked', reason: waiting.length ? 'dependencies_unsatisfied' : 'no_ready_step' };
      }

      startedIds.add(step.id);
      if (!dependenciesSatisfied(step, completedIds)) {
        await missionStore.transition(missionId, 'blocked', { current_step: completedCount, next_action: `human_gate: dependencies unsatisfied for ${step.id}` });
        return { status: 'blocked', reason: 'dependencies_unsatisfied', step };
      }

      if (!riskAllowed(step.risk, p)) {
        await missionStore.transition(missionId, 'blocked', {
          current_step: completedCount,
          next_action: `human_gate: risk ${step.risk} exceeds max_risk ${p.max_risk}`
        });
        return { status: 'blocked', reason: 'risk_blocked', step };
      }

      let attempt = 0;
      let outcome = null;
      while (attempt < limits.max_attempts_per_step) {
        if (Date.now() - started >= p.max_runtime_ms) break;
        attempt += 1;
        await missionStore.checkpoint(missionId, { ...(mission.checkpoint || {}), plan, active_step: step, active_step_index: plan.indexOf(step), last_attempt_at: now() }, {
          current_step: completedCount,
          attempt_count: attempt,
          next_action: step.action
        });

        try {
          const result = await executor({ missionId, mission, step, attempt, policy: p });
          const passed = await verify({ missionId, mission, step, result, attempt });
          outcome = { result, passed, attempt };
          if (passed) break;
          outcome.error = 'verification_failed';
        } catch (error) {
          outcome = { error: String(error && error.message || error), passed: false, attempt };
        }

        if (!step.retryable || !RETRYABLE.has(outcome.result?.status || 'failed') || attempt >= limits.max_attempts_per_step) break;
      }

      const stepIndex = plan.findIndex(item => item.id === step.id);
      if (Date.now() - started >= p.max_runtime_ms && !outcome?.passed) {
        await missionStore.transition(missionId, 'paused', { current_step: completedCount, next_action: 'resume: runtime budget exhausted' });
        return { status: 'time_limit', mission, step, outcome };
      }

      if (!outcome || !outcome.passed) {
        await missionStore.transition(missionId, 'failed', {
          current_step: completedCount,
          attempt_count: outcome?.attempt || limits.max_attempts_per_step,
          next_action: 'recover_or_human_gate',
          last_stderr: outcome?.error || outcome?.result?.stderr || null,
          last_exit_code: outcome?.result?.exit_code ?? null,
          last_stdout: outcome?.result?.stdout ?? null
        });
        return { status: 'failed', step, outcome };
      }

      completedIds.add(step.id);
      completedCount += 1;
      mission = await missionStore.checkpoint(missionId, {
        ...(mission.checkpoint || {}),
        plan,
        completed_step: step.id,
        completed_steps: [...completedIds],
        completed_at: now(),
        last_result: outcome.result
      }, {
        current_step: completedCount,
        completed_steps: completedCount,
        last_command: outcome.result?.command || null,
        last_exit_code: outcome.result?.exit_code ?? null,
        last_stdout: outcome.result?.stdout ?? null,
        last_stderr: outcome.result?.stderr ?? null,
        next_action: completedCount < plan.length ? 'next_ready_step' : 'verify_goal'
      });

      startedIds.delete(step.id);
      void stepIndex;
    }

    const finalVerification = await verify({ missionId, mission, final: true, plan });
    if (!finalVerification) {
      await missionStore.transition(missionId, 'failed', { next_action: 'human_gate: final verification failed' });
      return { status: 'verification_failed' };
    }

    mission = await missionStore.transition(missionId, 'succeeded', { current_step: plan.length, completed_steps: plan.length, next_action: null });
    return { status: 'succeeded', mission };
  }

  return Object.freeze({ policy: p, limits, run });
}

module.exports = Object.freeze({ createAutonomousMissionOrchestrator, stableId });
