'use strict';

const crypto = require('node:crypto');

const STATES = Object.freeze({
  INCIDENT: 'incident',
  RECURRENT: 'recurrent',
  CANDIDATE: 'pattern_candidate',
  CONFIRMED: 'pattern_confirmed',
  ROOT_CAUSE_REQUIRED: 'root_cause_required',
  PREVENTION_REQUIRED: 'prevention_required',
  STABLE: 'stable'
});

const DEFAULT_THRESHOLDS = Object.freeze({
  recurrent: 2,
  candidate: 3,
  confirmed: 4,
  rootCauseRequired: 5
});

function text(value, max = 500) {
  return String(value ?? '').trim().replace(/\\s+/g, ' ').slice(0, max);
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function signatureSource(episode = {}) {
  return {
    executor_type: text(episode.executor_type, 80),
    operation: text(episode.operation, 120),
    stage: text(episode.stage, 80),
    component: text(episode.component, 120),
    error_code: text(episode.error_code, 120),
    failure_mode: text(episode.failure_mode, 250),
    symptom: text(episode.symptom, 250)
  };
}

function failureSignature(episode = {}) {
  const source = signatureSource(episode);
  return `fp_${crypto.createHash('sha256').update(stable(source)).digest('hex').slice(0, 24)}`;
}

function outcomeIsFailure(episode = {}) {
  return ['failed', 'blocked', 'timeout', 'cancelled'].includes(String(episode.result?.status || episode.status || '').toLowerCase());
}

function repairedByEpisode(episode = {}) {
  return episode.repair_verified === true || episode.learning_mode === 'failure_prevention' || episode.prevention_verified === true;
}

function classify(count, thresholds = DEFAULT_THRESHOLDS) {
  if (count >= thresholds.rootCauseRequired) return STATES.ROOT_CAUSE_REQUIRED;
  if (count >= thresholds.confirmed) return STATES.CONFIRMED;
  if (count >= thresholds.candidate) return STATES.CANDIDATE;
  if (count >= thresholds.recurrent) return STATES.RECURRENT;
  return STATES.INCIDENT;
}

function detectPattern(history = [], { thresholds = DEFAULT_THRESHOLDS } = {}) {
  if (!Array.isArray(history)) throw new TypeError('history_must_be_array');
  const episodes = history.filter(outcomeIsFailure);
  const groups = new Map();
  for (const episode of episodes) {
    const signature = failureSignature(episode);
    const group = groups.get(signature) || [];
    group.push(episode);
    groups.set(signature, group);
  }

  const patterns = [...groups.entries()].map(([signature, items]) => {
    const ordered = [...items].sort((a, b) => String(a.created_at || a.timestamp || '').localeCompare(String(b.created_at || b.timestamp || '')));
    const repairCount = ordered.filter(repairedByEpisode).length;
    const recurrenceAfterRepair = ordered.some((item, index) => repairedByEpisode(item) && ordered.slice(index + 1).some(outcomeIsFailure));
    const state = recurrenceAfterRepair && ordered.length >= thresholds.candidate
      ? STATES.ROOT_CAUSE_REQUIRED
      : classify(ordered.length, thresholds);
    return Object.freeze({
      pattern_id: `pattern_${signature.slice(3)}`,
      signature,
      state,
      occurrence_count: ordered.length,
      first_seen: ordered[0]?.created_at || ordered[0]?.timestamp || null,
      last_seen: ordered.at(-1)?.created_at || ordered.at(-1)?.timestamp || null,
      repair_count: repairCount,
      recurrence_after_repair: recurrenceAfterRepair,
      episode_refs: ordered.map(item => text(item.mission_id || item.episode_id || item.id, 120)).filter(Boolean).slice(-20),
      representative: signatureSource(ordered.at(-1))
    });
  });

  return Object.freeze(patterns.sort((a, b) => b.occurrence_count - a.occurrence_count));
}

function buildCountermeasure(pattern, { preventionProcedure = [], evidenceRefs = [] } = {}) {
  if (!pattern || pattern.state === STATES.INCIDENT || pattern.state === STATES.RECURRENT) {
    return Object.freeze({ status: 'not_ready', reason: 'insufficient_recurrence' });
  }
  const needsRootCause = pattern.state === STATES.ROOT_CAUSE_REQUIRED || pattern.recurrence_after_repair === true;
  const readyForPrevention = Array.isArray(preventionProcedure) && preventionProcedure.length > 0;
  return Object.freeze({
    status: readyForPrevention ? 'ready' : 'needs_prevention_procedure',
    pattern_id: pattern.pattern_id,
    signature: pattern.signature,
    action: needsRootCause ? 'root_cause_then_prevention' : 'prevention',
    evidence_refs: evidenceRefs.slice(0, 20),
    prevention_procedure: preventionProcedure.slice(0, 12)
  });
}

function evaluateRecurrence(pattern, episode = {}) {
  if (!pattern) throw new TypeError('pattern_required');
  const same = failureSignature(episode) === pattern.signature;
  if (!same || !outcomeIsFailure(episode)) return Object.freeze({ same_pattern: false, recurrence: false, state: STATES.STABLE });
  return Object.freeze({
    same_pattern: true,
    recurrence: true,
    state: pattern.recurrence_after_repair ? STATES.ROOT_CAUSE_REQUIRED : classify(pattern.occurrence_count + 1),
    next_action: pattern.recurrence_after_repair ? 'reopen_root_cause' : 'apply_known_countermeasure'
  });
}

module.exports = Object.freeze({ STATES, DEFAULT_THRESHOLDS, failureSignature, signatureSource, outcomeIsFailure, detectPattern, buildCountermeasure, evaluateRecurrence });
