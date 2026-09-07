/**
 * ARIA Meta-Reasoning Engine v1.
 * Pure, deterministic, secret-free metacognitive gate.
 */
const VERSION = 'meta-reasoning-v1';

const ACTIONS = Object.freeze({
  PROCEED: 'proceed',
  INVESTIGATE: 'investigate',
  REPLAN: 'replan',
  BETTER_SKILL: 'use_better_skill',
  DELEGATE: 'delegate',
  EXPERIMENT: 'experiment',
  HUMAN_GATE: 'human_gate',
  ABSTAIN: 'abstain'
});

const clamp01 = n => Math.max(0, Math.min(1, n));
const finite01 = n => Number.isFinite(n) ? clamp01(n) : null;

function normalizeEvidence(input = {}) {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const valid = evidence.filter(e => e && typeof e === 'object');
  const independent = new Set(valid.map(e => e.source_id || e.source || 'unknown'));
  const observed = valid.filter(e => e.observed === true).length;
  const verified = valid.filter(e => e.verified === true).length;
  const contradictions = valid.filter(e => e.contradiction === true).length;
  const relevant = valid.filter(e => e.relevant !== false).length;
  return {
    count: valid.length,
    independent_sources: independent.size,
    observed,
    verified,
    contradictions,
    relevant
  };
}

function evaluateFailures(input = {}) {
  const history = Array.isArray(input.strategy_history) ? input.strategy_history : [];
  const current = typeof input.current_strategy === 'string' ? input.current_strategy.trim() : '';
  const failures = history.filter(h => h && h.outcome === 'failed');
  const same = failures.filter(h => typeof h.strategy === 'string' && h.strategy.trim() === current).length;
  const recentSame = failures.slice(-3).filter(h => typeof h.strategy === 'string' && h.strategy.trim() === current).length;
  return {
    failed_attempts: failures.length,
    same_strategy_failures: same,
    recent_same_strategy_failures: recentSame,
    repeated_failure_pattern: same >= 2 || recentSame >= 2,
    current_strategy_known_failed: same >= 1
  };
}

function evaluateOptions(input = {}) {
  const skills = Array.isArray(input.skills) ? input.skills : [];
  const bestSkill = skills
    .filter(s => s && s.available === true && Number.isFinite(s.fit_score))
    .sort((a,b) => (b.fit_score - a.fit_score) || String(a.skill_id || '').localeCompare(String(b.skill_id || '')))[0] || null;
  const agents = Array.isArray(input.agents) ? input.agents : [];
  const bestAgent = agents
    .filter(a => a && a.available === true && Number.isFinite(a.fit_score))
    .sort((a,b) => (b.fit_score - a.fit_score) || String(a.agent_id || '').localeCompare(String(b.agent_id || '')))[0] || null;
  return {
    better_skill: bestSkill && bestSkill.fit_score >= 0.80 ? bestSkill : null,
    better_agent: bestAgent && bestAgent.fit_score >= 0.80 ? bestAgent : null
  };
}

function assess(input) {
  if (!input || typeof input !== 'object' || typeof input.task !== 'string' || !input.task.trim()) {
    return { status: 'abstain', reason: 'invalid_task', version: VERSION };
  }

  const evidence = normalizeEvidence(input);
  const failures = evaluateFailures(input);
  const options = evaluateOptions(input);
  const ambiguity = finite01(input.ambiguity) ?? 0.35;
  const risk = finite01(input.risk) ?? 0.35;
  const confidence = finite01(input.confidence);
  const expectedValue = Number.isFinite(input.expected_value) ? Math.max(0, input.expected_value) : 1;
  const explicitlyHuman = input.requires_human_approval === true || input.human_gate === true;
  const destructive = input.irreversible === true || input.destructive === true;
  const researchNeeded = input.needs_research === true;
  const experimentUseful = input.experiment_preferred === true || input.experiment_required === true;

  const contradictionsPenalty = Math.min(0.35, evidence.contradictions * 0.12);
  const evidenceScore = clamp01(
    0.30 * Math.min(1, evidence.verified / 2) +
    0.25 * Math.min(1, evidence.observed / 2) +
    0.20 * Math.min(1, evidence.independent_sources / 2) +
    0.15 * Math.min(1, evidence.relevant / 2) +
    0.10 * (evidence.count > 0 ? 1 : 0) -
    contradictionsPenalty
  );
  const minimumEvidence = destructive || risk >= 0.75 ? 0.85 : risk >= 0.50 ? 0.72 : 0.60;
  const evidenceSufficient = evidenceScore >= minimumEvidence && evidence.contradictions === 0;
  const computedConfidence = confidence == null ? clamp01(0.55 * evidenceScore + 0.25 * (1 - ambiguity) + 0.20 * (1 - contradictionsPenalty)) : confidence;

  let action = ACTIONS.PROCEED;
  let reason = 'sufficient_evidence_and_no_higher_priority_metacognitive_block';

  if (explicitlyHuman) {
    action = ACTIONS.HUMAN_GATE;
    reason = 'explicit_human_approval_required';
  } else if (!evidenceSufficient || computedConfidence < minimumEvidence) {
    action = researchNeeded ? ACTIONS.INVESTIGATE : ACTIONS.ABSTAIN;
    reason = researchNeeded ? 'evidence_insufficient_research_first' : 'evidence_or_confidence_below_threshold';
  } else if (failures.repeated_failure_pattern) {
    action = options.better_skill ? ACTIONS.BETTER_SKILL : options.better_agent ? ACTIONS.DELEGATE : experimentUseful ? ACTIONS.EXPERIMENT : ACTIONS.REPLAN;
    reason = 'current_strategy_repeats_known_failure_pattern';
  } else if (failures.current_strategy_known_failed) {
    action = options.better_skill ? ACTIONS.BETTER_SKILL : experimentUseful ? ACTIONS.EXPERIMENT : ACTIONS.REPLAN;
    reason = 'current_strategy_has_prior_failure';
  } else if (options.better_skill && options.better_skill.fit_score >= 0.90) {
    action = ACTIONS.BETTER_SKILL;
    reason = 'higher_fit_skill_available';
  } else if (researchNeeded || ambiguity >= 0.70) {
    action = ACTIONS.INVESTIGATE;
    reason = researchNeeded ? 'research_explicitly_required' : 'material_ambiguity_requires_information';
  } else if (options.better_agent && options.better_agent.fit_score >= 0.90) {
    action = ACTIONS.DELEGATE;
    reason = 'specialized_agent_has_substantially_better_fit';
  } else if (experimentUseful || (risk >= 0.65 && expectedValue < 1.0)) {
    action = ACTIONS.EXPERIMENT;
    reason = 'bounded_experiment_reduces_downside_or_uncertainty';
  } else if (risk >= 0.90 && expectedValue < 0.50) {
    action = ACTIONS.ABSTAIN;
    reason = 'risk_exceeds_justified_value';
  }

  const shouldNotAct = [ACTIONS.INVESTIGATE, ACTIONS.REPLAN, ACTIONS.BETTER_SKILL, ACTIONS.DELEGATE, ACTIONS.EXPERIMENT, ACTIONS.HUMAN_GATE, ACTIONS.ABSTAIN].includes(action);
  return {
    status: action,
    version: VERSION,
    task: input.task.trim(),
    confidence: Number(computedConfidence.toFixed(8)),
    evidence_score: Number(evidenceScore.toFixed(8)),
    evidence_sufficient: evidenceSufficient,
    minimum_evidence_threshold: minimumEvidence,
    evidence_summary: evidence,
    failure_assessment: failures,
    options: {
      better_skill: options.better_skill && { skill_id: options.better_skill.skill_id, fit_score: options.better_skill.fit_score },
      better_agent: options.better_agent && { agent_id: options.better_agent.agent_id, fit_score: options.better_agent.fit_score }
    },
    signals: { ambiguity, risk, expected_value, research_needed: researchNeeded, destructive, explicitly_human: explicitlyHuman },
    should_not_act: shouldNotAct,
    recommended_action: action,
    reason,
    stop_conditions: [
      'new_contradictory_evidence',
      'confidence_below_threshold',
      'risk_increase_without_new_evidence',
      'human_gate_triggered'
    ],
    uncertainty: [
      ...(evidence.contradictions ? ['evidence_conflict'] : []),
      ...(evidence.count === 0 ? ['no_evidence'] : []),
      ...(ambiguity >= 0.70 ? ['material_ambiguity'] : []),
      ...(failures.current_strategy_known_failed ? ['strategy_failure_history'] : [])
    ]
  };
}

module.exports = { version: VERSION, ACTIONS, assess, normalizeEvidence, evaluateFailures, evaluateOptions };
