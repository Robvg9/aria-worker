/**
 * ARIA Health / Availability Manager — Mission 10.11.
 * Pure declarative lookups. No network, credentials, routing, fallback,
 * quota mutation, or memory writes.
 */
const registry = require('./registry.json');

function normalizeId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function matches(entry, { provider_id, model_id, account_id }) {
  const provider = normalizeId(provider_id);
  const model = normalizeId(model_id);
  const account = normalizeId(account_id);
  return (!provider || entry.provider_id === provider)
    && (!model || entry.model_id === model)
    && (!account || entry.account_id === account);
}

function findEntries(filter = {}) {
  if (!filter || typeof filter !== 'object') return [];
  return registry.entries.filter(entry => matches(entry, filter));
}

function getHealth(filter = {}) {
  const entry = findEntries(filter)[0];
  if (!entry) return null;
  return {
    provider_id: entry.provider_id,
    model_id: entry.model_id,
    account_id: entry.account_id,
    health: { ...entry.health },
    availability: { ...entry.availability }
  };
}

function listHealth(filter = {}) {
  return findEntries(filter).map(entry => ({
    provider_id: entry.provider_id,
    model_id: entry.model_id,
    account_id: entry.account_id,
    health: { ...entry.health },
    availability: { ...entry.availability }
  }));
}

function isObserved(filter = {}) {
  const result = getHealth(filter);
  return Boolean(result && (
    result.health.status !== 'unknown'
    || result.availability.status !== 'unknown'
  ));
}

function isAvailable(filter = {}) {
  const result = getHealth(filter);
  return Boolean(result && result.availability.status === 'available');
}

module.exports = {
  version: registry.version,
  getHealth,
  listHealth,
  isObserved,
  isAvailable,
  registry
};
