'use strict';

const { DEFAULT_MANIFEST, normalizeManifest } = require('./config');
const { CONNECTOR_STATES, normalizeState, validateConnectorConfig, RISK_CLASSES } = require('./contract');
const { createEnvironmentSecretResolver, envNameForRef } = require('./secrets');
const { adapters } = require('./connectors');

function createActivationRuntime({ manifest = DEFAULT_MANIFEST, env = process.env, fetchImpl = globalThis.fetch, authorize = null } = {}) {
  const entries = normalizeManifest(manifest);
  const resolver = createEnvironmentSecretResolver(env);
  const state = new Map(entries.map(e => [e.connector_id, e.enabled ? 'configured' : 'disabled']));

  function status(id) { return normalizeState(state.get(id)); }

  async function probe(entry) {
    const adapter = adapters[entry.connector_id];
    if (!entry.enabled) return { connector_id:entry.connector_id, state:'disabled', healthy:false, reason:'disabled' };
    if (!adapter) return { connector_id:entry.connector_id, state:'unavailable', healthy:false, reason:'adapter_missing' };
    const ref = entry.credential_ref;
    const cred = ref ? await resolver.resolve(ref) : { status:'resolved', secret:null };
    if (ref && cred.status !== 'resolved') return { connector_id:entry.connector_id, state:'unconfigured', healthy:false, reason:'credential_unconfigured' };
    try {
      const result = await adapter.health({ ...entry, secret:cred.secret, fetchImpl });
      const healthy = result && result.ok === true;
      const next = healthy ? 'healthy' : (result && result.status >= 400 && result.status < 500 ? 'unavailable' : 'degraded');
      state.set(entry.connector_id, next);
      return { connector_id:entry.connector_id, state:next, healthy, http_status:result && result.status || null };
    } catch (error) {
      state.set(entry.connector_id, 'degraded');
      return { connector_id:entry.connector_id, state:'degraded', healthy:false, reason:String(error && error.message || error) };
    }
  }

  async function probeAll() {
    const results = [];
    for (const entry of entries) results.push(await probe(entry));
    return results;
  }

  async function execute(id, operation, context = {}) {
    const entry = entries.find(e => e.connector_id === id);
    if (!entry) return { status:'blocked', reason:'connector_unknown' };
    const check = validateConnectorConfig(entry);
    if (!check.valid) return { status:'blocked', reason:check.reason };
    if (!entry.enabled) return { status:'blocked', reason:'connector_disabled' };
    const adapter = adapters[id];
    if (!adapter || !adapter.descriptor.operations.includes(operation)) return { status:'blocked', reason:'operation_not_supported' };
    if (status(id) !== 'healthy') return { status:'blocked', reason:'connector_not_healthy', state:status(id) };
    const risk = context.risk_class || 'READ';
    if (!RISK_CLASSES.includes(risk)) return { status:'blocked', reason:'invalid_risk_class' };
    if (typeof authorize !== 'function') return { status:'blocked', reason:'authorization_unavailable' };
    const auth = await authorize({ connector_id:id, operation, risk_class:risk, input:context.input || {} });
    if (!auth || auth.status !== 'approved') return { status:'blocked', reason:'authorization_not_approved' };
    const cred = entry.credential_ref ? await resolver.resolve(entry.credential_ref) : { status:'resolved', secret:null };
    if (cred.status !== 'resolved') return { status:'blocked', reason:'credential_unconfigured' };
    const result = await adapter.execute(operation, { ...context, ...entry, secret:cred.secret, fetchImpl });
    return { status:result && result.ok ? 'succeeded' : 'failed', connector_id:id, operation, http_status:result && result.status || null, data:result && result.data || null };
  }

  function snapshot() {
    return entries.map(entry => ({ connector_id:entry.connector_id, enabled:entry.enabled, state:status(entry.connector_id), required:entry.required, credential_configured: entry.credential_ref ? Boolean(env && env[envNameForRef(entry.credential_ref)]) : true }));
  }

  return Object.freeze({ manifest:entries, snapshot, status, probe, probeAll, execute, resolver });
}

module.exports = { createActivationRuntime, CONNECTOR_STATES };
