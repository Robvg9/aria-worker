'use strict';

const { getHealth } = require('./lookup');

const HEALTH = Object.freeze(['unknown', 'healthy', 'degraded', 'unavailable']);
const AVAILABILITY = Object.freeze(['unknown', 'available', 'unavailable']);

function isIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function sanitize(value) {
  return String(value ?? '')
    .replace(/Bearer\s+\S+/gi, '[REDACTED]')
    .replace(/\b(?:sk|gh[pousr]|xox[baprs])_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .slice(0, 500);
}

function normalizeObservation(filter, observation) {
  if (!observation || typeof observation !== 'object') {
    return {
      ...getHealth(filter),
      observation_valid: false,
      error: 'observation_invalid'
    };
  }

  const healthStatus = HEALTH.includes(observation.health_status) ? observation.health_status : 'unknown';
  const availabilityStatus = AVAILABILITY.includes(observation.availability_status)
    ? observation.availability_status
    : 'unknown';
  const observedAt = isIso(observation.observed_at) ? observation.observed_at : null;

  if (healthStatus === 'unknown' && availabilityStatus === 'unknown') {
    return {
      ...getHealth(filter),
      observation_valid: false,
      error: 'insufficient_evidence'
    };
  }

  return {
    provider_id: filter.provider_id ?? null,
    model_id: filter.model_id ?? null,
    account_id: filter.account_id ?? null,
    health: {
      status: healthStatus,
      observed_at: observedAt,
      source: typeof observation.source === 'string' ? observation.source : null,
      evidence_ref: typeof observation.evidence_ref === 'string' ? observation.evidence_ref : null,
      last_error: observation.last_error == null ? null : sanitize(observation.last_error)
    },
    availability: {
      status: availabilityStatus,
      observed_at: observedAt,
      source: typeof observation.source === 'string' ? observation.source : null,
      evidence_ref: typeof observation.evidence_ref === 'string' ? observation.evidence_ref : null
    },
    observation_valid: true,
    error: null
  };
}

async function observe(filter = {}, probeFn) {
  if (typeof probeFn !== 'function') {
    return { ...getHealth(filter), observation_valid: false, error: 'probe_not_configured' };
  }
  let observation;
  try {
    observation = await probeFn({ ...filter });
  } catch (error) {
    return {
      ...getHealth(filter),
      observation_valid: false,
      error: sanitize(error instanceof Error ? error.message : error)
    };
  }
  return normalizeObservation(filter, observation);
}

module.exports = {
  HEALTH,
  AVAILABILITY,
  observe,
  normalizeObservation,
  sanitize
};
