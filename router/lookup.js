/**
 * ARIA Intelligent Router lookup helpers (declarative)
 * Mission 10.6 — pure functions, no side effects, no secrets, no execution.
 *
 * Consumes existing registries. Does not duplicate their data.
 */
const modelLookup = require('../models/lookup.js');
const capLookup = require('../capabilities/lookup.js');
const accountLookup = require('../accounts/lookup.js');
const quotaLookup = require('../quota/lookup.js');
const registry = require('./registry.json');

const SELECTED = 'selected';
const NO_ROUTE = 'no_route';
const AVAILABLE_CAPACITY = 'available';
const BLOCKING_CAPACITY = new Set(['unavailable', 'exhausted', 'unknown']);

/**
 * Deterministic comparator for candidates.
 * provider_id ASC | account_id ASC | model_id ASC
 */
function compareCandidates(a, b) {
  if (a.provider_id < b.provider_id) return -1;
  if (a.provider_id > b.provider_id) return 1;
  if (a.account_id < b.account_id) return -1;
  if (a.account_id > b.account_id) return 1;
  if (a.model_id < b.model_id) return -1;
  if (a.model_id > b.model_id) return 1;
  return 0;
}

/**
 * Capacity/quota gate.
 * Returns true only when evidence affirms the candidate is usable.
 * unknown / missing / unavailable / exhausted → false.
 */
function capacityAllows(accountId, modelId) {
  const cap = quotaLookup.getCapacity(accountId);
  const quota = quotaLookup.getQuota(accountId);

  // Missing entry → cannot affirm usability
  if (!cap || !quota) return false;

  // Must match the requested model when the entry is model-scoped
  if (cap.model_id && cap.model_id !== modelId) return false;
  if (quota.model_id && quota.model_id !== modelId) return false;

  // Blocking statuses (includes unknown per 10.5 / contract)
  if (BLOCKING_CAPACITY.has(cap.status)) return false;
  if (BLOCKING_CAPACITY.has(quota.status)) return false;
  if (quota.rate_limit && BLOCKING_CAPACITY.has(quota.rate_limit.status)) return false;

  // Only an explicit positive status would pass. None seeded today.
  return cap.status === AVAILABLE_CAPACITY && quota.status === AVAILABLE_CAPACITY;
}

/**
 * Build the ordered list of selectable candidates for a capability.
 */
function collectCandidates(capability) {
  const modelIds = capLookup.modelsByCapability(capability);
  const candidates = [];

  for (const modelId of modelIds) {
    // Capability must be verified (supports === true)
    if (capLookup.supports(modelId, capability) !== true) continue;

    const model = modelLookup.getModel(modelId);
    if (!model) continue;
    if (model.status !== 'available') continue;

    const providerId = model.provider_id;
    const accounts = accountLookup.accountsForProvider(providerId);

    for (const account of accounts) {
      if (!accountLookup.isActiveStatus(account)) continue;

      // If model_refs is present and non-empty, the model must be listed
      if (Array.isArray(account.model_refs) && account.model_refs.length > 0) {
        if (!account.model_refs.includes(modelId)) continue;
      }

      if (!capacityAllows(account.account_id, modelId)) continue;

      candidates.push({
        provider_id: providerId,
        account_id: account.account_id,
        model_id: modelId
      });
    }
  }

  candidates.sort(compareCandidates);
  return candidates;
}

/**
 * Apply optional preferred_* filters. Returns the preferred candidate
 * if it is among the remaining set; otherwise the first after sort.
 */
function applyPreferences(candidates, input) {
  if (!candidates.length) return null;

  let pool = candidates;

  if (input.preferred_provider) {
    const filtered = pool.filter(c => c.provider_id === input.preferred_provider);
    if (filtered.length) pool = filtered;
  }
  if (input.preferred_account) {
    const filtered = pool.filter(c => c.account_id === input.preferred_account);
    if (filtered.length) pool = filtered;
  }
  if (input.preferred_model) {
    const filtered = pool.filter(c => c.model_id === input.preferred_model);
    if (filtered.length) pool = filtered;
  }

  return pool[0] || null;
}

/**
 * route(input) → { status: "selected", ... } | { status: "no_route" }
 *
 * Pure. Deterministic. No side effects. No external calls.
 */
function route(input) {
  if (!input || typeof input !== 'object') {
    return { status: NO_ROUTE };
  }

  const capability = input.capability;
  if (!capability || typeof capability !== 'string' || capability.trim() === '') {
    return { status: NO_ROUTE };
  }

  const candidates = collectCandidates(capability.trim());
  const chosen = applyPreferences(candidates, input);

  if (!chosen) {
    return { status: NO_ROUTE };
  }

  return {
    status: SELECTED,
    provider_id: chosen.provider_id,
    account_id: chosen.account_id,
    model_id: chosen.model_id,
    capability: capability.trim()
  };
}

module.exports = {
  version: registry.version,
  route,
  collectCandidates,
  capacityAllows,
  registry
};
