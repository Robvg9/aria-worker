'use strict';

const crypto = require('node:crypto');

const STATUS = Object.freeze(['candidate', 'verified', 'degraded', 'retired']);

function normalizeKey(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (!key) throw new TypeError('skill_key_required');
  if (key.length > 200) throw new TypeError('skill_key_too_long');
  return key;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value, Object.keys(value).sort())).digest('hex');
}

function createSkillRegistry({ minConfidence = 0.90, minEvidence = 1 } = {}) {
  if (!(Number.isFinite(minConfidence) && minConfidence >= 0 && minConfidence <= 1)) throw new TypeError('minConfidence must be 0..1');
  if (!Number.isInteger(minEvidence) || minEvidence < 1) throw new TypeError('minEvidence must be >= 1');

  const entries = new Map();

  function put(lesson, { version = null, source = 'learning-engine', now = () => new Date().toISOString() } = {}) {
    if (!lesson || typeof lesson !== 'object') throw new TypeError('lesson_required');
    const key = normalizeKey(lesson.skill_key || lesson.capability || lesson.summary);
    const evidenceCount = Array.isArray(lesson?.evidence?.evidence_refs) ? lesson.evidence.evidence_refs.length : 0;
    const confidence = Number(lesson.confidence);
    const verified = lesson?.evidence?.verified === true && lesson.reusable === true && confidence >= minConfidence && evidenceCount >= minEvidence;
    const previous = entries.get(key);
    const nextVersion = version || `v${previous ? previous.version_number + 1 : 1}`;
    const entry = {
      skill_key: key,
      version: nextVersion,
      version_number: previous ? previous.version_number + 1 : 1,
      status: verified ? 'verified' : 'candidate',
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      evidence_count: evidenceCount,
      procedure: Array.isArray(lesson.procedure) ? lesson.procedure.slice(0, 20) : [],
      source,
      created_at: previous?.created_at || now(),
      updated_at: now(),
      uses: previous?.uses || 0,
      successes: previous?.successes || 0,
      failures: previous?.failures || 0,
      regression_count: previous?.regression_count || 0,
      content_hash: lesson.content_hash || hash({ key, procedure: lesson.procedure, confidence }),
      metadata: lesson.metadata || null
    };
    entries.set(key, Object.freeze(entry));
    return entries.get(key);
  }

  function recordOutcome(skillKey, outcome, { now = () => new Date().toISOString() } = {}) {
    const key = normalizeKey(skillKey);
    const previous = entries.get(key);
    if (!previous) throw new Error('skill_not_found');
    const succeeded = outcome === 'succeeded' || outcome === 'verified' || outcome === true;
    const failed = outcome === 'failed' || outcome === 'regression' || outcome === false;
    if (!succeeded && !failed) throw new TypeError('outcome_invalid');
    const uses = previous.uses + 1;
    const successes = previous.successes + (succeeded ? 1 : 0);
    const failures = previous.failures + (failed ? 1 : 0);
    const successRate = uses ? successes / uses : 0;
    const degraded = previous.regression_count > 0 || (uses >= 5 && successRate < 0.70);
    const updated = Object.freeze({ ...previous, uses, successes, failures, status: previous.status === 'retired' ? 'retired' : (degraded ? 'degraded' : previous.status), updated_at: now() });
    entries.set(key, updated);
    return updated;
  }

  function recordRegression(skillKey, { now = () => new Date().toISOString() } = {}) {
    const key = normalizeKey(skillKey);
    const previous = entries.get(key);
    if (!previous) throw new Error('skill_not_found');
    const updated = Object.freeze({ ...previous, regression_count: previous.regression_count + 1, status: 'degraded', updated_at: now() });
    entries.set(key, updated);
    return updated;
  }

  function retire(skillKey, reason = 'manual') {
    const key = normalizeKey(skillKey);
    const previous = entries.get(key);
    if (!previous) throw new Error('skill_not_found');
    const updated = Object.freeze({ ...previous, status: 'retired', retirement_reason: String(reason).slice(0, 500) });
    entries.set(key, updated);
    return updated;
  }

  function resolve(skillKey, { allowDegraded = false } = {}) {
    const key = normalizeKey(skillKey);
    const entry = entries.get(key);
    if (!entry || entry.status === 'retired' || (!allowDegraded && entry.status === 'degraded')) return null;
    return entry;
  }

  function rank({ limit = 20, includeCandidates = false } = {}) {
    const rows = [...entries.values()].filter(entry => entry.status !== 'retired' && (includeCandidates || entry.status !== 'candidate'));
    rows.sort((a, b) => {
      const scoreA = a.confidence * 0.65 + (a.uses ? a.successes / a.uses : 0) * 0.35;
      const scoreB = b.confidence * 0.65 + (b.uses ? b.successes / b.uses : 0) * 0.35;
      return scoreB - scoreA || a.skill_key.localeCompare(b.skill_key);
    });
    return Object.freeze(rows.slice(0, Math.max(1, Math.min(100, limit))));
  }

  function snapshot() {
    return Object.freeze([...entries.values()].map(entry => ({ ...entry })));
  }

  return Object.freeze({ version: 'skill-registry-v1.0', put, recordOutcome, recordRegression, retire, resolve, rank, snapshot });
}

module.exports = Object.freeze({ STATUS, normalizeKey, createSkillRegistry });
