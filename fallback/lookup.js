/**
 * ARIA Fallback Engine lookup helpers (declarative)
 * Mission 10.7 — pure functions, no side effects, no secrets, no execution.
 *
 * Consumes 10.6 Router + 10.2–10.5 registries. Does not duplicate their data.
 */
const router = require('../router/lookup.js');
const modelLookup = require('../models/lookup.js');
const capLookup = require('../capabilities/lookup.js');
const accountLookup = require('../accounts/lookup.js');
const registry = require('./registry.json');

const PRIMARY = 'primary';
const FALLBACK = 'fallback';
const NO_FALLBACK = 'no_fallback';

const POLICY_NOTE = 'POLICY INPUT NOT IMPLEMENTED';

/**
 * Activation kinds are not equivalent.
 * exclude: what must not be used as the alternative when this kind fired.
 * rate_limit requires an explicit policy permit (do not evade rate limits).
 */
const ACTIVATIONS = {
  provider_unavailable: { exclude: 'provider' },
  account_unavailable: { exclude: 'account' },
  credential_failure: { exclude: 'account' },
  quota_exhausted: { exclude: 'account' },
  rate_limit: { exclude: 'account', requires_rate_limit_policy: true },
  capacity_unavailable: { exclude: 'candidate' },
  execution_failure: { exclude: 'candidate' },
  policy_rejection: { exclude: 'candidate' }
};

function candidateKey(c) {
  if (!c || typeof c !== 'object') return '';
  return [c.provider_id, c.account_id, c.model_id].join('|');
}

function compareCandidates(a, b) {
  if (a.provider_id < b.provider_id) return -1;
  if (a.provider_id > b.provider_id) return 1;
  if (a.account_id < b.account_id) return -1;
  if (a.account_id > b.account_id) return 1;
  if (a.model_id < b.model_id) return -1;
  if (a.model_id > b.model_id) return 1;
  return 0;
}

function noFallback() {
  return { status: NO_FALLBACK };
}

function selectedShape(status, c, capability) {
  return {
    status,
    provider_id: c.provider_id,
    account_id: c.account_id,
    model_id: c.model_id,
    capability
  };
}

function realDeps() {
  return {
    route: router.route,
    collectCandidates: router.collectCandidates,
    capacityAllows: router.capacityAllows,
    isAccountActive: accountLookup.isAccountActive,
    supports: capLookup.supports,
    getModel: modelLookup.getModel,
    credentialRefOf: accountLookup.credentialRefOf
  };
}

function mergeDeps(overrides) {
  const base = realDeps();
  if (!overrides || typeof overrides !== 'object') return base;
  return Object.assign(base, overrides);
}

function looksLikeSecret(value) {
  if (typeof value !== 'string') return true;
  return /^(sk-|or-v1-|Bearer\s+)/.test(value) ||
    /^(api[_-]?key|token|password)=/i.test(value);
}

function isCredentialAuthorized(accountId, deps) {
  const ref = deps.credentialRefOf(accountId);
  if (!ref || typeof ref !== 'string' || ref.trim() === '') return false;
  if (looksLikeSecret(ref)) return false;
  // 10.4 scheme: reference only. Never a raw secret.
  return ref.indexOf('secret://') === 0;
}

function unauthorizedKeys(policy) {
  const set = new Set();
  if (!policy || !Array.isArray(policy.unauthorized)) return set;
  for (const item of policy.unauthorized) {
    if (typeof item === 'string') set.add(item);
    else if (item && typeof item === 'object') set.add(candidateKey(item));
  }
  return set;
}

function visitedKeys(input, primary) {
  const set = new Set();
  const raw = input && Array.isArray(input.visited) ? input.visited : [];
  for (const item of raw) {
    if (typeof item === 'string') set.add(item);
    else if (item && typeof item === 'object') set.add(candidateKey(item));
  }
  if (primary && primary.provider_id && primary.account_id && primary.model_id) {
    set.add(candidateKey(primary));
  }
  return set;
}

/**
 * rate_limit fallback is denied unless policy explicitly allows it.
 * Unknown kinds are not assumed equivalent to a known activation.
 * policy.allow_fallback === false blocks every alternative.
 */
function activationAllows(kind, policy) {
  if (policy && policy.allow_fallback === false) return false;
  if (kind === undefined || kind === null || kind === '') return true;
  if (!Object.prototype.hasOwnProperty.call(ACTIVATIONS, kind)) return false;
  if (ACTIVATIONS[kind].requires_rate_limit_policy) {
    return !!(policy && policy.allow_rate_limit_fallback === true);
  }
  return true;
}

function excludedByActivation(candidate, primary, kind) {
  if (!kind || !primary) return false;
  const spec = ACTIVATIONS[kind];
  if (!spec) return false;
  if (spec.exclude === 'provider') return candidate.provider_id === primary.provider_id;
  if (spec.exclude === 'account') return candidate.account_id === primary.account_id;
  if (spec.exclude === 'candidate') return candidateKey(candidate) === candidateKey(primary);
  return false;
}

/**
 * Positive evidence required. unknown ≠ available.
 */
function candidateSelectable(c, capability, deps, policy) {
  if (!c || typeof c !== 'object') return false;
  if (!c.provider_id || !c.account_id || !c.model_id) return false;
  if (!capability || typeof capability !== 'string') return false;

  if (unauthorizedKeys(policy).has(candidateKey(c))) return false;

  if (!deps.isAccountActive(c.account_id)) return false;
  if (!isCredentialAuthorized(c.account_id, deps)) return false;

  const model = deps.getModel(c.model_id);
  if (!model) return false;
  if (model.status && model.status !== 'available') return false;
  if (model.provider_id && model.provider_id !== c.provider_id) return false;

  if (deps.supports(c.model_id, capability) !== true) return false;

  if (!deps.capacityAllows(c.account_id, c.model_id)) return false;

  return true;
}

function applyPreferences(candidates, input) {
  if (!candidates.length) return [];

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

  return pool;
}

function resolvePrimary(input, deps) {
  if (input.router_result && typeof input.router_result === 'object') {
    return input.router_result;
  }
  return deps.route({
    capability: input.capability,
    preferred_provider: input.preferred_provider,
    preferred_account: input.preferred_account,
    preferred_model: input.preferred_model
  });
}

/**
 * resolve(input, deps?) → { status: "primary"|"fallback"|"no_fallback", ... }
 *
 * Pure. Deterministic. No side effects. No external calls.
 */
function resolve(input, depsOverride) {
  if (!input || typeof input !== 'object') {
    return noFallback();
  }

  const deps = mergeDeps(depsOverride);
  const policy = input.policy && typeof input.policy === 'object' ? input.policy : null;
  const primary = resolvePrimary(input, deps);

  if (!primary || primary.status !== 'selected') {
    return noFallback();
  }

  const capability = (primary.capability || input.capability || '').trim();
  if (!capability) {
    return noFallback();
  }

  const failureKind = input.failure && input.failure.kind;
  const primaryStillValid =
    !failureKind &&
    candidateSelectable(primary, capability, deps, policy);

  if (primaryStillValid) {
    return selectedShape(PRIMARY, primary, capability);
  }

  if (!activationAllows(failureKind, policy)) {
    return noFallback();
  }

  const pool = deps.collectCandidates(capability);
  if (!Array.isArray(pool) || pool.length === 0) {
    return noFallback();
  }

  const seen = visitedKeys(input, primary);
  const remaining = [];

  for (const c of pool) {
    const key = candidateKey(c);
    if (!key || seen.has(key)) continue;
    if (excludedByActivation(c, primary, failureKind)) continue;
    if (!candidateSelectable(c, capability, deps, policy)) continue;
    remaining.push({
      provider_id: c.provider_id,
      account_id: c.account_id,
      model_id: c.model_id
    });
  }

  remaining.sort(compareCandidates);
  const preferred = applyPreferences(remaining, input);
  const chosen = preferred[0];

  if (!chosen) {
    return noFallback();
  }

  return selectedShape(FALLBACK, chosen, capability);
}

module.exports = {
  version: registry.version,
  resolve,
  candidateKey,
  candidateSelectable,
  activationAllows,
  POLICY_NOTE,
  registry
};
