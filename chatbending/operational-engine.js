'use strict';

const { decideFailureEscalation } = require('../autonomy/failure-escalation');

const TERMINAL = new Set(['VERIFIED', 'BLOCKED', 'REVALIDATE', 'STOP']);
const PROMOTION_STATES = Object.freeze(['CANDIDATE', 'VALIDATED', 'ACTIVE', 'REJECTED']);

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(items) {
  return [...new Set((Array.isArray(items) ? items : []).filter(Boolean))];
}

function buildMissionContext({
  goal,
  project = null,
  current_state = null,
  active_rules = [],
  evidence = [],
  decisions = [],
  learnings = [],
  source_of_truth = null,
  tools = [],
  human_gates = [],
  forbidden_actions = [],
  success_criteria = [],
  next_test = null
} = {}) {
  const normalizedGoal = cleanString(goal);
  if (!normalizedGoal) throw new TypeError('goal must be a non-empty string');

  return Object.freeze({
    version: 'chatbending-mission-context-v1',
    goal: normalizedGoal,
    project: cleanString(project) || null,
    current_state: current_state && typeof current_state === 'object' ? structuredClone(current_state) : null,
    active_rules: unique(active_rules),
    evidence: unique(evidence),
    decisions: unique(decisions),
    learnings: unique(learnings),
    source_of_truth: cleanString(source_of_truth) || null,
    tools: unique(tools),
    human_gates: unique(human_gates),
    forbidden_actions: unique(forbidden_actions),
    success_criteria: unique(success_criteria),
    next_test: cleanString(next_test) || null
  });
}

function evaluateBehavior({
  context,
  contradiction = false,
  stale = false,
  closure_requested = false,
  closure = {},
  failure = {}
} = {}) {
  if (!context || typeof context.goal !== 'string' || !context.goal.trim()) {
    return Object.freeze({ mode: 'BLOCKED', reason: 'missing_mission_context' });
  }

  if (contradiction) {
    return Object.freeze({ mode: 'STOP', reason: 'critical_contradiction' });
  }

  if (stale) {
    return Object.freeze({ mode: 'REVALIDATE', reason: 'evidence_stale' });
  }

  if (failure && Number.isInteger(failure.consecutive_failures) && failure.consecutive_failures > 0) {
    const escalation = decideFailureEscalation(failure);
    if (escalation.action === 'request_human_decision') {
      return Object.freeze({
        mode: 'BLOCKED',
        reason: escalation.reason,
        escalation
      });
    }
    if (escalation.action === 'change_path' || escalation.action === 'escalate_to_another_ai') {
      return Object.freeze({
        mode: 'STOP',
        reason: escalation.reason,
        escalation
      });
    }
  }

  if (closure_requested) {
    const result = verifyClosure(closure);
    if (!result.verified) return Object.freeze({ mode: 'BLOCKED', reason: result.reason });
    return Object.freeze({ mode: 'VERIFIED', reason: 'closure_gate_passed', closure: result });
  }

  return Object.freeze({ mode: 'CONTINUE', reason: 'no_blocking_gate_triggered' });
}

function verifyClosure({
  criteria_passed = false,
  evidence_count = 0,
  regression_passed = false,
  artifacts_present = false
} = {}) {
  const checks = {
    criteria_passed: criteria_passed === true,
    evidence_present: Number.isInteger(evidence_count) && evidence_count > 0,
    regression_passed: regression_passed === true,
    artifacts_present: artifacts_present === true
  };
  const verified = Object.values(checks).every(Boolean);
  return Object.freeze({
    verified,
    terminal_state: verified ? 'VERIFIED' : 'BLOCKED',
    checks,
    reason: verified ? 'all_closure_gates_passed' : 'closure_evidence_incomplete'
  });
}

function buildLearningCandidate({
  mission_id = null,
  observation,
  evidence = [],
  proposed_rule = null,
  approval_required = true
} = {}) {
  const normalizedObservation = cleanString(observation);
  if (!normalizedObservation) throw new TypeError('observation_required');

  return Object.freeze({
    type: 'learning_candidate',
    mission_id: cleanString(mission_id) || null,
    observation: normalizedObservation,
    evidence: unique(evidence),
    proposed_rule: cleanString(proposed_rule) || null,
    status: 'CANDIDATE',
    approval_required: approval_required !== false,
    auto_promoted: false,
    promotion_states: PROMOTION_STATES
  });
}

function promoteLearning(candidate, {
  explicit_approval = false,
  validation_passed = false
} = {}) {
  if (!candidate || candidate.status !== 'CANDIDATE') {
    return Object.freeze({ promoted: false, status: 'REJECTED', reason: 'invalid_candidate' });
  }
  if (!explicit_approval) {
    return Object.freeze({ promoted: false, status: 'CANDIDATE', reason: 'approval_required' });
  }
  if (!validation_passed) {
    return Object.freeze({ promoted: false, status: 'CANDIDATE', reason: 'validation_required' });
  }
  return Object.freeze({
    promoted: true,
    status: 'ACTIVE',
    reason: 'explicit_approval_and_validation'
  });
}

module.exports = Object.freeze({
  TERMINAL,
  PROMOTION_STATES,
  buildMissionContext,
  evaluateBehavior,
  verifyClosure,
  buildLearningCandidate,
  promoteLearning
});
