'use strict';

const crypto = require('node:crypto');

function observationKey(event) {
  return [
    event.capability_id || 'unknown',
    event.route || 'unknown',
    event.error_code || 'none',
    event.outcome || 'unknown',
  ].join('|');
}

function updateLearningLedger(ledger = {}, event = {}, threshold = 3) {
  if (!event || !event.outcome) throw new Error('Learning observation outcome is required');

  const key = observationKey(event);
  const previous = ledger[key] || {
    key,
    observations: 0,
    successes: 0,
    failures: 0,
    evidence_refs: [],
  };

  const next = {
    ...previous,
    observations: previous.observations + 1,
    successes: previous.successes + (event.outcome === 'success' ? 1 : 0),
    failures: previous.failures + (event.outcome === 'failure' ? 1 : 0),
    evidence_refs: [...new Set([...(previous.evidence_refs || []), ...(event.evidence_refs || [])])].sort(),
  };

  const proposal_state = next.failures >= threshold
    ? 'CANDIDATE_FOR_REVIEW'
    : 'OBSERVED';

  return {
    ...ledger,
    [key]: {
      ...next,
      proposal_state,
    },
  };
}

function buildLearningSnapshot(ledger = {}) {
  const observations = Object.values(ledger).sort((a, b) => a.key.localeCompare(b.key));
  const canonical = {
    schema: 'aria.ecc-learning-adapter.v1',
    deterministic: true,
    observations,
    policy: {
      auto_promote: false,
      auto_disable: false,
      human_review_required: true,
      failure_threshold: 3,
    },
  };

  return {
    ...canonical,
    snapshot_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    summary: {
      keys: observations.length,
      candidates_for_review: observations.filter(x => x.proposal_state === 'CANDIDATE_FOR_REVIEW').length,
      auto_promoted: 0,
      auto_disabled: 0,
    },
  };
}

module.exports = { observationKey, updateLearningLedger, buildLearningSnapshot };
