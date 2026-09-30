'use strict';

const { decideFailureEscalation } = require('../autonomy/failure-escalation');

const TERMINAL = new Set(['VERIFIED', 'BLOCKED', 'REVALIDATE', 'STOP']);
const INTENTS = Object.freeze([
  'BOOT', 'DEBUG', 'BUILD', 'VERIFY', 'DECISION',
  'PROJECT_STATUS', 'INCIDENT', 'LEARNING', 'ARCHITECTURE', 'PERSON_WORKSTYLE'
]);
const RELATIONS = Object.freeze([
  'supports', 'contradicts', 'derived_from', 'supersedes',
  'validates', 'caused_by', 'tested_by', 'applies_to'
]);
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

function inferIntent(goal = '', explicit = null) {
  if (INTENTS.includes(explicit)) return explicit;
  const text = cleanString(goal).toLowerCase();
  if (!text) return 'BOOT';
  if (/debug|bug|fall|error|falla|problema/.test(text)) return 'DEBUG';
  if (/verif|test|probar|valid/.test(text)) return 'VERIFY';
  if (/constru|implemen|crear|build/.test(text)) return 'BUILD';
  if (/arquitect|diseñ|estructura/.test(text)) return 'ARCHITECTURE';
  if (/aprend|lesson|lección/.test(text)) return 'LEARNING';
  if (/decid|decision|elegir/.test(text)) return 'DECISION';
  if (/estado|status|actual/.test(text)) return 'PROJECT_STATUS';
  return 'BOOT';
}

function rankRecall(items, { query = '', limit = 12 } = {}) {
  const tokens = new Set((cleanString(query).toLowerCase().match(/[a-z0-9áéíóúñ]{3,}/g) || []));
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((item, index) => {
      const text = [item.title, item.content].filter(Boolean).join(' ').toLowerCase();
      const overlap = [...tokens].reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
      const hybrid = Number.isFinite(item.hybrid_score) ? item.hybrid_score : 0;
      const confidence = Number.isFinite(item.confidence) ? item.confidence : 0;
      const importance = Number.isFinite(item.importance) ? item.importance : 0;
      const salience = Number.isFinite(item.salience) ? item.salience : 0;
      return {
        ...item,
        retrieval_score: Number((overlap + hybrid + confidence + importance + salience + (1 / (index + 1)) * 0.01).toFixed(6))
      };
    })
    .sort((a, b) => b.retrieval_score - a.retrieval_score)
    .slice(0, Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 12)));
}

function detectContradictions(records = []) {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const subject = cleanString(record?.subject);
    if (!subject) continue;
    const value = JSON.stringify(record?.value);
    const list = groups.get(subject) || [];
    list.push({ id: record.id || null, value, raw: record });
    groups.set(subject, list);
  }
  const conflicts = [];
  for (const [subject, values] of groups) {
    const uniqueValues = [...new Map(values.map(item => [item.value, item])).values()];
    if (uniqueValues.length > 1) {
      for (let i = 0; i < uniqueValues.length; i += 1) {
        for (let j = i + 1; j < uniqueValues.length; j += 1) {
          conflicts.push({ subject, left: uniqueValues[i].raw, right: uniqueValues[j].raw });
        }
      }
    }
  }
  return conflicts;
}

function evaluateFreshness({
  verified_at = null,
  freshness_window_days = null,
  now = new Date().toISOString()
} = {}) {
  const verified = verified_at ? Date.parse(verified_at) : Number.NaN;
  const current = Date.parse(now);
  if (!Number.isFinite(verified) || !Number.isFinite(current)) {
    return Object.freeze({ status: 'UNKNOWN', age_days: null, reason: 'missing_or_invalid_timestamp' });
  }
  const age_days = Math.max(0, (current - verified) / 86400000);
  if (!Number.isFinite(freshness_window_days) || freshness_window_days < 0) {
    return Object.freeze({ status: 'REVALIDATE', age_days, reason: 'freshness_window_missing' });
  }
  return age_days <= freshness_window_days
    ? Object.freeze({ status: 'CURRENT', age_days, reason: 'within_freshness_window' })
    : Object.freeze({ status: 'REVALIDATE', age_days, reason: 'freshness_window_exceeded' });
}

function buildEvidenceEdge({ from, to, relation } = {}) {
  if (!cleanString(from) || !cleanString(to)) throw new TypeError('evidence_edge_nodes_required');
  if (!RELATIONS.includes(relation)) throw new TypeError('invalid_evidence_relation');
  return Object.freeze({
    from: cleanString(from),
    to: cleanString(to),
    relation,
    version: 'evidence-graph-v1'
  });
}

function buildHealthSnapshot({
  continuity = true,
  consistency = true,
  freshness = true,
  evidence = true,
  integrity = true,
  retrievability = true,
  behavior = true,
  learning = true
} = {}) {
  const dimensions = { continuity, consistency, freshness, evidence, integrity, retrievability, behavior, learning };
  const failed = Object.entries(dimensions).filter(([, ok]) => ok !== true).map(([key]) => key);
  const status = failed.length === 0 ? 'HEALTHY' : failed.length >= 2 ? 'BLOCKED' : 'DEGRADED';
  return Object.freeze({ status, failed_dimensions: failed, dimensions: Object.freeze({ ...dimensions }) });
}

function planCleanup(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .filter(item => item.historical !== true)
    .filter(item => item.superseded === true || item.duplicate === true || item.broken_reference === true)
    .map(item => Object.freeze({
      id: item.id || null,
      action: item.broken_reference ? 'REPAIR' : 'ARCHIVE',
      reason: item.superseded ? 'superseded' : item.duplicate ? 'duplicate' : 'broken_reference'
    }));
}

function buildDashboardSnapshot({ health, runtime = null, blockers = [], gates = [] } = {}) {
  return Object.freeze({
    version: 'chatbending-dashboard-v1',
    status: health?.status || 'UNKNOWN',
    health: health || null,
    runtime: runtime || null,
    blockers: unique(blockers),
    gates: Array.isArray(gates) ? gates.map(g => ({ ...g })) : []
  });
}

function runContinuityCheck({
  context,
  expected_project = null,
  required_rules = [],
  require_source_of_truth = false
} = {}) {
  const checks = {
    goal: Boolean(cleanString(context?.goal)),
    project: !expected_project || context?.project === expected_project,
    rules: required_rules.every(rule => context?.active_rules?.includes(rule)),
    source_of_truth: !require_source_of_truth || Boolean(context?.source_of_truth)
  };
  return Object.freeze({
    verified: Object.values(checks).every(Boolean),
    checks,
    reason: Object.values(checks).every(Boolean) ? 'continuity_context_sufficient' : 'continuity_context_incomplete'
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
  if (contradiction) return Object.freeze({ mode: 'STOP', reason: 'critical_contradiction' });
  if (stale) return Object.freeze({ mode: 'REVALIDATE', reason: 'evidence_stale' });

  if (failure && Number.isInteger(failure.consecutive_failures) && failure.consecutive_failures > 0) {
    const escalation = decideFailureEscalation(failure);
    if (escalation.action === 'request_human_decision') {
      return Object.freeze({ mode: 'BLOCKED', reason: escalation.reason, escalation });
    }
    if (escalation.action === 'change_path' || escalation.action === 'escalate_to_another_ai') {
      return Object.freeze({ mode: 'STOP', reason: escalation.reason, escalation });
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
  if (!explicit_approval) return Object.freeze({ promoted: false, status: 'CANDIDATE', reason: 'approval_required' });
  if (!validation_passed) return Object.freeze({ promoted: false, status: 'CANDIDATE', reason: 'validation_required' });
  return Object.freeze({ promoted: true, status: 'ACTIVE', reason: 'explicit_approval_and_validation' });
}

module.exports = Object.freeze({
  TERMINAL,
  INTENTS,
  RELATIONS,
  PROMOTION_STATES,
  buildMissionContext,
  inferIntent,
  rankRecall,
  detectContradictions,
  evaluateFreshness,
  buildEvidenceEdge,
  buildHealthSnapshot,
  planCleanup,
  buildDashboardSnapshot,
  runContinuityCheck,
  evaluateBehavior,
  verifyClosure,
  buildLearningCandidate,
  promoteLearning
});
