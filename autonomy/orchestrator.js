'use strict';

const crypto = require('crypto');
const { createAutonomyPolicy, riskAllowed } = require('./policy');
const { normalizePlan, nextReadyStep, dependenciesSatisfied } = require('./universal-execution/plan');
const { readySteps } = require('./mission-graph');

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const RETRYABLE = new Set(['failed', 'timeout']);

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function stableId(parts) {
  const raw = JSON.stringify(parts, Object.keys(parts).sort());
  return `step_${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 20)}`;
}

function createAutonomousMissionOrchestrator({ missionStore, planner, replanner = null, executor, verify, policy = {}, now = () => new Date().toISOString() } = {}) {
  if (!missionStore || typeof missionStore !== 'object') throw new TypeError('missionStore required');
  requireFn(missionStore.get, 'missionStore.get');
  requireFn(missionStore.transition, 'missionStore.transition');
  requireFn(missionStore.checkpoint, 'missionStore.checkpoint');
  requireFn(planner, 'planner');
  requireFn(executor, 'executor');
  requireFn(verify, 'verify');
  if (replanner !== null) requireFn(replanner, 'replanner');

  const p = createAutonomyPolicy(policy);
  const limits = Object.freeze({
    max_steps: p.max_steps,
    max_parallel: p.max_parallel,
    max_attempts_per_step: Number.isInteger(policy.max_attempts_per_step) && policy.max_attempts_per_step > 0 ? policy.max_attempts_per_step : 2,
    max_replans: Number.isInteger(policy.max_replans) && policy.max_replans >= 0 ? policy.max_replans : 2
  });

  async function executeStep({ missionId, mission, step, plan, replanCount, started }) {
    let attempt = 0;
    let outcome = null;
    while (attempt < limits.max_attempts_per_step) {
      if (Date.now() - started >= p.max_runtime_ms) break;
      attempt += 1;
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
    return outcome;
  }

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
      mission = await missionStore.checkpoint(missionId, { ...(mission.checkpoint || {}), plan, planned_at: now(), replan_count: 0 }, { total_steps: plan.length, current_step: mission.current_step || 0 });
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
    let replanCount = Number(mission.checkpoint?.replan_count || 0);

    while (completedCount < plan.length) {
      if (Date.now() - started >= p.max_runtime_ms) {
        await missionStore.transition(missionId, 'paused', { current_step: completedCount, next_action: 'resume: runtime budget exhausted' });
        return { status: 'time_limit', mission };
      }
      if (completedCount >= limits.max_steps) {
        await missionStore.transition(missionId, 'paused', { current_step: completedCount, next_action: 'resume: step budget exhausted' });
        return { status: 'step_limit', mission };
      }

      const ready = readySteps(plan, [...completedIds])
        .filter(step => !completedIds.has(String(step.id)))
        .slice(0, limits.max_parallel);
      if (!ready.length) {
        const fallback = nextReadyStep(plan, completedIds, new Set());
        const unresolved = plan.filter(item => !completedIds.has(item.id));
        const waiting = unresolved.filter(item => !item.depends_on.every(dep => completedIds.has(dep)));
        const reason = waiting.length ? 'dependencies_unsatisfied' : (fallback ? 'no_eligible_parallel_batch' : 'no_ready_step');
        await missionStore.transition(missionId, 'blocked', { current_step: completedCount, next_action: `human_gate: ${reason}` });
        return { status: 'blocked', reason };
      }

      const invalidDependency = ready.find(step => !dependenciesSatisfied(step, completedIds));
      if (invalidDependency) {
        await missionStore.transition(missionId, 'blocked', { current_step: completedCount, next_action: `human_gate: dependencies unsatisfied for ${invalidDependency.id}` });
        return { status: 'blocked', reason: 'dependencies_unsatisfied', step: invalidDependency };
      }
      const blockedRisk = ready.find(step => !riskAllowed(step.risk, p));
      if (blockedRisk) {
        await missionStore.transition(missionId, 'blocked', { current_step: completedCount, next_action: `human_gate: risk ${blockedRisk.risk} exceeds max_risk ${p.max_risk}` });
        return { status: 'blocked', reason: 'risk_blocked', step: blockedRisk };
      }

      const batchMission = mission;
      await missionStore.checkpoint(missionId, {
        ...(mission.checkpoint || {}),
        plan,
        active_steps: ready.map(step => step.id),
        active_batch_started_at: now(),
        replan_count: replanCount
      }, {
        current_step: completedCount,
        next_action: 'executing_parallel_batch'
      });

      const outcomes = await Promise.all(ready.map(step => executeStep({ missionId, mission: batchMission, step, plan, replanCount, started })));
      const failures = [];
      for (let i = 0; i < ready.length; i++) {
        const outcome = outcomes[i];
        if (outcome?.passed) {
          completedIds.add(String(ready[i].id));
          completedCount += 1;
        } else {
          failures.push({ step: ready[i], outcome });
        }
      }

      if (failures.length) {
        const primary = failures[0];
        if (replanner && replanCount < limits.max_replans) {
          try {
            const replacement = await replanner({ mission, plan, completed_steps: [...completedIds], failed_step: primary.step, outcome: primary.outcome, failed_steps: failures, replan_count: replanCount + 1, policy: p });
            const normalized = normalizePlan(replacement);
            if (!Array.isArray(normalized) || normalized.length === 0) throw new Error('replanner returned no executable steps');
            const remaining = normalized.filter(item => !completedIds.has(String(item.id)));
            if (remaining.length === 0) throw new Error('replanner returned no remaining work');
            plan = remaining.map((item, index) => ({ ...item, id: item.id || stableId({ missionId, index, action: item.action || item.operation || null }), depends_on: Array.isArray(item.depends_on) ? item.depends_on.map(String).filter(dep => !completedIds.has(dep)) : [] }));
            replanCount += 1;
            await missionStore.checkpoint(missionId, { ...(mission.checkpoint || {}), plan, completed_steps: [...completedIds], active_steps: [], replanned_from_step: primary.step.id, replan_count: replanCount, last_replan_reason: primary.outcome?.error || primary.outcome?.result?.status || 'execution_or_verification_failure' }, { total_steps: completedCount + plan.length, current_step: completedCount, next_action: 'replanned_next_ready_batch' });
            continue;
          } catch (replanError) {
            primary.outcome.replan_error = String(replanError && replanError.message || replanError);
          }
        }
        await missionStore.transition(missionId, 'failed', { current_step: completedCount, attempt_count: primary.outcome?.attempt || limits.max_attempts_per_step, next_action: replanner && replanCount >= limits.max_replans ? 'human_gate: max_replans_exhausted' : 'recover_or_human_gate', last_stderr: primary.outcome?.error || primary.outcome?.result?.stderr || null, last_exit_code: primary.outcome?.result?.exit_code ?? null, last_stdout: primary.outcome?.result?.stdout ?? null });
        return { status: 'failed', step: primary.step, outcome: primary.outcome, failed_steps: failures.map(item => item.step) };
      }

      mission = await missionStore.checkpoint(missionId, { ...(mission.checkpoint || {}), plan, completed_steps: [...completedIds], active_steps: [], completed_at: now(), replan_count: replanCount }, { current_step: completedCount, completed_steps: completedCount, next_action: completedCount < plan.length ? 'next_ready_batch' : 'verify_goal' });
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
