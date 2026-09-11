'use strict';

const crypto = require('node:crypto');
const { buildRegression } = require('../self-development/regression-builder-v2');

function normalizeText(value, max = 4000) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function deriveConfidence({ verifier, outcome, evidenceCount = 0, failurePreventionVerified = false } = {}) {
  let score = verifier?.passed ? 0.80 : 0.20;
  if (outcome?.status === 'succeeded') score += 0.10;
  if (failurePreventionVerified) score += 0.08;
  if (evidenceCount > 0) score += Math.min(0.08, evidenceCount * 0.02);
  return Math.min(0.98, Number(score.toFixed(3)));
}

function extractLesson({ episode = {}, verifier = {} } = {}) {
  const goal = normalizeText(episode.goal);
  const result = episode.result && typeof episode.result === 'object' ? episode.result : {};
  const prevention = episode.learning_mode === 'failure_prevention' && Array.isArray(episode.prevention_procedure)
    ? episode.prevention_procedure : [];
  const baseProcedure = Array.isArray(episode.procedure)
    ? episode.procedure.map((s) => normalizeText(s, 500)).filter(Boolean).slice(0, 12)
    : [];
  const procedure = (episode.learning_mode === 'failure_prevention' && prevention.length > 0)
    ? prevention.map((s) => normalizeText(s, 500)).filter(Boolean).slice(0, 12)
    : baseProcedure;
  const failurePreventionVerified = episode.learning_mode === 'failure_prevention'
    && result.status === 'failed'
    && prevention.length > 0
    && verifier.passed === true;
  const summary = failurePreventionVerified
    ? `Verified prevention for failure: ${goal}`
    : (verifier.passed ? `Verified procedure for goal: ${goal}` : `Failed/insufficient verification for goal: ${goal}`);
  const evidence = {
    verifier_version: verifier.version || null,
    verified: Boolean(verifier.passed),
    failed_checks: Array.isArray(verifier.failed_checks) ? verifier.failed_checks : [],
    outcome_status: result.status || null,
    learning_mode: episode.learning_mode || 'success_learning',
    evidence_refs: Array.isArray(episode.evidence_refs) ? episode.evidence_refs.slice(0, 20) : [],
    failure_mode: normalizeText(episode.failure_mode, 300) || null,
  };
  const category = failurePreventionVerified ? 'failure_prevention' : (verifier.passed ? 'verified_procedure' : 'diagnostic');
  const confidence = deriveConfidence({
    verifier,
    outcome: result,
    evidenceCount: evidence.evidence_refs.length,
    failurePreventionVerified
  });
  const reusable = failurePreventionVerified || (verifier.passed && result.status === 'succeeded' && procedure.length > 0);
  const source = `${goal}|${JSON.stringify(procedure)}|${verifier.version || ''}|${evidence.learning_mode}|${evidence.failure_mode || ''}`;
  return Object.freeze({ category, summary: normalizeText(summary), procedure, evidence, confidence, reusable, content_hash: hash(source) });
}

function promoteToSkill(lesson, { minConfidence = 0.90, minEvidence = 1 } = {}) {
  const verified = Boolean(lesson?.evidence?.verified);
  const enoughEvidence = Array.isArray(lesson?.evidence?.evidence_refs) && lesson.evidence.evidence_refs.length >= minEvidence;
  const promoted = verified && lesson.reusable === true && Number(lesson.confidence) >= minConfidence && enoughEvidence;
  return Object.freeze({ promoted, status: promoted ? 'verified' : 'candidate', reason: promoted ? 'verified_reusable_evidence' : 'insufficient_verified_reusable_evidence' });
}

function createLearningEngine({ persistLesson = null, persistSkill = null, persistRegression = null, regressionBuilder = buildRegression, minConfidence = 0.90, minEvidence = 1 } = {}) {
  async function learn({ episode, verifier } = {}) {
    const lesson = extractLesson({ episode, verifier });
    const promotion = promoteToSkill(lesson, { minConfidence, minEvidence });
    let regression = null;
    if (typeof persistLesson === 'function') await persistLesson(lesson, episode);
    if (promotion.promoted && typeof persistSkill === 'function') {
      const skill = { ...lesson, promotion };
      regression = typeof regressionBuilder === 'function'
        ? regressionBuilder({ capability: episode?.capability_id || episode?.capability || episode?.goal, procedure: { steps: lesson.procedure }, evidence: lesson.evidence })
        : null;
      if (regression) skill.regression = regression;
      await persistSkill(skill, episode);
      if (regression && typeof persistRegression === 'function') await persistRegression(regression, episode);
    }
    return Object.freeze({ version: 'skills-learning-v2', lesson, promotion, regression });
  }
  return Object.freeze({ version: 'skills-learning-v2', learn });
}

module.exports = Object.freeze({ extractLesson, promoteToSkill, createLearningEngine });
