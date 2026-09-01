/**
 * ARIA Quota / Capacity Manager lookup helpers (declarative)
 * Mission 10.5 — pure functions, no side effects, no secrets, no routing.
 */
const registry = require('./registry.json');

function entriesByAccount(accountId) {
  if (!accountId || typeof accountId !== 'string') return [];
  return registry.entries.filter(e => e.account_id === accountId);
}

function entriesByModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return [];
  return registry.entries.filter(e => e.model_id === modelId);
}

function firstByAccount(accountId) {
  const list = entriesByAccount(accountId);
  return list.length ? list[0] : null;
}

function quotaProjection(entry) {
  return {
    provider_id: entry.provider_id,
    account_id: entry.account_id,
    model_id: entry.model_id,
    status: entry.quota.status,
    limits: entry.quota.limits,
    rate_limit: {
      status: entry.rate_limit.status,
      limits: entry.rate_limit.limits
    },
    usage: {
      status: entry.usage.status,
      requests_consumed: entry.usage.requests_consumed,
      tokens_consumed: entry.usage.tokens_consumed,
      remaining: entry.usage.remaining,
      reset_at: entry.usage.reset_at
    }
  };
}

function capacityProjection(entry) {
  return {
    provider_id: entry.provider_id,
    account_id: entry.account_id,
    model_id: entry.model_id,
    status: entry.capacity.status,
    max_known: entry.capacity.max_known
  };
}

function getQuota(accountId) {
  const e = firstByAccount(accountId);
  return e ? quotaProjection(e) : null;
}

function getCapacity(accountId) {
  const e = firstByAccount(accountId);
  return e ? capacityProjection(e) : null;
}

function getQuotaForModel(modelId) {
  return entriesByModel(modelId).map(quotaProjection);
}

function getCapacityForModel(modelId) {
  return entriesByModel(modelId).map(capacityProjection);
}

function listAccountIds() {
  return [...new Set(registry.entries.map(e => e.account_id))];
}

function listModelIds() {
  return [...new Set(registry.entries.map(e => e.model_id))];
}

module.exports = {
  version: registry.version,
  getQuota,
  getCapacity,
  getQuotaForModel,
  getCapacityForModel,
  listAccountIds,
  listModelIds,
  registry
};
