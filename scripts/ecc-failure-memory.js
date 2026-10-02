'use strict';

const crypto = require('node:crypto');

function failureKey(event) {
  return [
    event.capability_id || 'unknown',
    event.route || 'unknown',
    event.error_code || 'unknown',
  ].join('|');
}

function recordFailure(memory = {}, event = {}, threshold = 3) {
  if (!event || event.outcome !== 'failure') {
    throw new Error('Failure Memory requires a failure event');
  }

  const key = failureKey(event);
  const prior = memory[key] || {
    key,
    failures: 0,
    evidence_refs: [],
    last_seen: null,
  };

  const next = {
    ...prior,
    failures: prior.failures + 1,
    evidence_refs: [...new Set([...(prior.evidence_refs || []), ...(event.evidence_refs || [])])].sort(),
    last_seen: event.observed_at || prior.last_seen || null,
  };

  const prevention_state = next.failures >= threshold
    ? 'ALTERNATIVE_REQUIRED'
    : 'RETRY_ALLOWED';

  return {
    ...memory,
    [key]: {
      ...next,
      prevention_state,
    },
  };
}

function buildFailureMemorySnapshot(memory = {}) {
  const failures = Object.values(memory).sort((a, b) => a.key.localeCompare(b.key));
  const canonical = {
    schema: 'aria.ecc-failure-memory.v1',
    deterministic: true,
    failures,
    policy: {
      threshold: 3,
      repeated_failure_action: 'REQUIRE_ALTERNATIVE',
      auto_block: false,
      auto_disable: false,
    },
  };

  return {
    ...canonical,
    memory_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    summary: {
      patterns: failures.length,
      alternative_required: failures.filter(x => x.prevention_state === 'ALTERNATIVE_REQUIRED').length,
      retry_allowed: failures.filter(x => x.prevention_state === 'RETRY_ALLOWED').length,
    },
  };
}

module.exports = { failureKey, recordFailure, buildFailureMemorySnapshot };
