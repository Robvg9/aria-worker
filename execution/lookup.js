/**
 * ARIA Execution Engine (Mission 10.8) — Data Plane / Execution Layer
 *
 * Converts a route already selected by 10.6/10.7 and explicitly authorized
 * (10.12) into ONE provider call through a Provider Adapter (10.13).
 *
 * Does not route, does not fallback, does not retry, does not switch accounts,
 * does not store/print secrets, does not write canonical memory.
 */
const crypto = require('crypto');
const fallback = require('../fallback/lookup.js');
const router = require('../router/lookup.js');
const modelLookup = require('../models/lookup.js');
const capLookup = require('../capabilities/lookup.js');
const accountLookup = require('../accounts/lookup.js');
const credentials = require('./credentials.js');
const openrouterAdapter = require('./adapters/openrouter.js');
const registry = require('./registry.json');

const SUCCEEDED = 'succeeded';
const FAILED = 'failed';
const BLOCKED = 'blocked';

const CREDENTIAL_RESOLVER_NOTE = credentials.CREDENTIAL_RESOLVER_NOTE;

const ADAPTERS = Object.freeze({
  [openrouterAdapter.descriptor.provider_id]: openrouterAdapter
});

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-]+/g,
  /\bsk-[A-Za-z0-9_\-]{8,}/g,
  /\bor-v1-[A-Za-z0-9_\-]{8,}/g,
  /(api[_-]?key|token|secret|password)\s*[=:]\s*\S+/gi
];

function realDeps() {
  return {
    resolveRoute: fallback.resolve,
    candidateSelectable: fallback.candidateSelectable,
    capacityAllows: router.capacityAllows,
    isAccountActive: accountLookup.isAccountActive,
    supports: capLookup.supports,
    getModel: modelLookup.getModel,
    credentialRefOf: accountLookup.credentialRefOf,
    credentialResolver: credentials.nullCredentialResolver,
    adapters: ADAPTERS,
    transport: defaultTransport,
    onEvent: null
  };
}

function mergeDeps(overrides) {
  const base = realDeps();
  if (!overrides || typeof overrides !== 'object') return base;
  return Object.assign(base, overrides);
}

/**
 * Real HTTP transport. Only used when no transport is injected.
 * Never logs. Never inspects headers.
 */
async function defaultTransport(url, opts) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch unavailable');
  }
  const res = await fetch(url, opts);
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    json = null;
  }
  return { status: res.status, json };
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
}

function executionId(parts) {
  const h = crypto.createHash('sha256').update(canonicalJson(parts)).digest('hex');
  return 'exec_' + h.slice(0, 32);
}

function sanitizeMessage(msg) {
  let out = typeof msg === 'string' ? msg : 'error';
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

function routeShape(r, capability) {
  return {
    provider_id: r && r.provider_id ? r.provider_id : null,
    account_id: r && r.account_id ? r.account_id : null,
    model_id: r && r.model_id ? r.model_id : null,
    capability: capability || null
  };
}

function unknownUsage() {
  return { status: 'unknown', prompt_tokens: null, completion_tokens: null, total_tokens: null };
}

function metadata(adapterId, mode) {
  return {
    engine_version: registry.version,
    adapter_id: adapterId || null,
    mode: mode || 'mock',
    attempt: 1,
    memory_authority: 'none',
    canonical_write: false
  };
}

function emit(deps, event) {
  if (typeof deps.onEvent !== 'function') return;
  try {
    deps.onEvent(event);
  } catch (e) {
    /* observability must never affect execution */
  }
}

function blocked(id, route, reason, detail, deps, adapterId) {
  const result = {
    execution_id: id,
    status: BLOCKED,
    route,
    reason,
    usage: unknownUsage(),
    metadata: metadata(adapterId, 'mock')
  };
  if (detail) result.detail = detail;
  emit(deps, { event: 'execution.blocked', execution_id: id, route, status: BLOCKED, reason });
  return result;
}

function failed(id, route, error, deps, adapterId, mode) {
  const err = {
    code: error && error.code ? error.code : 'adapter_error',
    message: sanitizeMessage(error && error.message),
    stage: error && error.stage ? error.stage : 'provider_call'
  };
  if (error && typeof error.provider_status === 'number') err.provider_status = error.provider_status;
  const result = {
    execution_id: id,
    status: FAILED,
    route,
    error: err,
    usage: unknownUsage(),
    metadata: metadata(adapterId, mode)
  };
  emit(deps, { event: 'execution.failed', execution_id: id, route, status: FAILED, error_code: err.code });
  return result;
}

/**
 * Explains why 10.7 rejected a route. Diagnostic only — the gate is
 * candidateSelectable; this never overrides it.
 */
function diagnoseRoute(r, capability, deps) {
  if (!r.provider_id || !r.account_id || !r.model_id) return 'route_incomplete';
  const model = deps.getModel(r.model_id);
  if (!model) return 'model_not_found';
  if (model.provider_id && model.provider_id !== r.provider_id) return 'provider_mismatch';
  if (model.status && model.status !== 'available') return 'model_unavailable';
  if (!deps.isAccountActive(r.account_id)) return 'account_not_active';
  if (!deps.credentialRefOf(r.account_id)) return 'credential_ref_missing';
  if (deps.supports(r.model_id, capability) !== true) return 'capability_not_verified';
  if (!deps.capacityAllows(r.account_id, r.model_id)) return 'insufficient_evidence';
  return 'route_not_selectable';
}

const ACCEPTED_ROUTE_STATUS = ['selected', 'primary', 'fallback'];

function resolveSelectedRoute(input, deps) {
  if (input.selected_route && typeof input.selected_route === 'object') {
    return { source: 'input', route: input.selected_route };
  }
  if (!input.capability || typeof input.capability !== 'string') {
    return { source: 'none', route: null };
  }
  const r = deps.resolveRoute({ capability: input.capability, policy: input.policy });
  return { source: 'fallback', route: r };
}

/**
 * execute(input, deps?) → Promise<ExecutionResult>
 * See execution/contract.md.
 */
async function execute(input, depsOverride) {
  const deps = mergeDeps(depsOverride);

  if (!input || typeof input !== 'object') {
    return blocked(executionId({ input: null }), routeShape(null, null), 'input_missing', null, deps);
  }

  const resolved = resolveSelectedRoute(input, deps);
  const rawRoute = resolved.route;
  const capability = (rawRoute && rawRoute.capability) || input.capability || null;
  const route = routeShape(rawRoute, capability);
  const id = executionId({
    task_id: input.task_id || null,
    provider_id: route.provider_id,
    account_id: route.account_id,
    model_id: route.model_id,
    capability,
    input: input.input || null
  });

  if (!rawRoute || typeof rawRoute !== 'object') {
    return blocked(id, route, 'route_missing', null, deps);
  }
  if (rawRoute.status === 'no_route' || rawRoute.status === 'no_fallback') {
    return blocked(id, route, 'no_route', null, deps);
  }
  if (ACCEPTED_ROUTE_STATUS.indexOf(rawRoute.status) === -1) {
    return blocked(id, route, 'route_not_selectable', 'route_status_invalid', deps);
  }
  if (!capability) {
    return blocked(id, route, 'capability_missing', null, deps);
  }
  if (input.capability && rawRoute.capability && input.capability !== rawRoute.capability) {
    return blocked(id, route, 'route_not_selectable', 'capability_mismatch', deps);
  }

  // 10.7 gate: consumes 10.2/10.3/10.4/10.6. unknown ≠ available.
  const policy = input.policy && typeof input.policy === 'object' ? input.policy : null;
  if (!deps.candidateSelectable(route, capability, deps, policy)) {
    const detail = diagnoseRoute(route, capability, deps);
    const reason = detail === 'insufficient_evidence' || detail === 'credential_ref_missing'
      ? detail
      : 'route_not_selectable';
    return blocked(id, route, reason, detail, deps);
  }

  // 10.12 gate: selected ≠ approved_to_execute.
  const auth = input.authorization;
  if (!auth || typeof auth !== 'object') {
    return blocked(id, route, 'authorization_missing', null, deps);
  }
  if (auth.status !== 'approved') {
    return blocked(id, route, 'authorization_not_approved', null, deps);
  }

  const adapter = deps.adapters && deps.adapters[route.provider_id];
  if (!adapter || typeof adapter.execute !== 'function' || !adapter.descriptor) {
    return blocked(id, route, 'adapter_unavailable', null, deps);
  }
  const adapterId = adapter.descriptor.adapter_id;
  if (Array.isArray(adapter.descriptor.operations) &&
      adapter.descriptor.operations.indexOf(capability) === -1) {
    return blocked(id, route, 'adapter_unavailable', 'capability_not_supported_by_adapter', deps, adapterId);
  }

  if (!input.input || typeof input.input !== 'object') {
    return blocked(id, route, 'input_missing', null, deps, adapterId);
  }

  const credentialRef = deps.credentialRefOf(route.account_id);
  if (!credentialRef) {
    return blocked(id, route, 'credential_ref_missing', null, deps, adapterId);
  }
  const cred = credentials.resolveCredential(credentialRef, deps.credentialResolver);
  const mode = deps.transport === defaultTransport ? 'live' : 'mock';
  if (cred.status !== credentials.RESOLVED) {
    return failed(id, route, {
      code: 'credential_unavailable',
      message: cred.reason || 'credential unavailable',
      stage: 'credential_resolution'
    }, deps, adapterId, mode);
  }

  emit(deps, { event: 'execution.started', execution_id: id, route, status: 'running' });

  let out;
  try {
    out = await adapter.execute({
      route,
      input: input.input,
      secret: cred.secret,
      transport: deps.transport
    });
  } catch (e) {
    return failed(id, route, { code: 'adapter_error', message: 'adapter threw', stage: 'provider_call' },
      deps, adapterId, mode);
  }

  if (!out || typeof out !== 'object') {
    return failed(id, route, { code: 'invalid_response', message: 'adapter returned nothing' },
      deps, adapterId, mode);
  }
  if (!out.ok) {
    return failed(id, route, out.error, deps, adapterId, mode);
  }

  const result = {
    execution_id: id,
    status: SUCCEEDED,
    route,
    response: out.response,
    usage: out.usage && typeof out.usage === 'object' ? out.usage : unknownUsage(),
    metadata: metadata(adapterId, mode)
  };
  emit(deps, { event: 'execution.completed', execution_id: id, route, status: SUCCEEDED });
  return result;
}

module.exports = {
  version: registry.version,
  execute,
  executionId,
  canonicalJson,
  sanitizeMessage,
  diagnoseRoute,
  ADAPTERS,
  CREDENTIAL_RESOLVER_NOTE,
  SUCCEEDED,
  FAILED,
  BLOCKED,
  registry
};
