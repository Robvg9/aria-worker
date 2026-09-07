'use strict';

const crypto = require('node:crypto');
const { getDevice } = require('./registry');

const HEALTH = new Set(['unknown','healthy','degraded','unhealthy','offline']);
const SECURITY = new Set(['unknown','trusted','restricted','blocked']);
const SECRET_LIKE = /(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----|bearer\s+[A-Za-z0-9._-]{16,})/i;

function assertSafe(value) { if (SECRET_LIKE.test(JSON.stringify(value))) throw new Error('secret_material_rejected'); }
function clone(value) { return value == null ? value : structuredClone(value); }
function observationKey(deviceId, observation) {
  return `obs_${crypto.createHash('sha256').update(JSON.stringify({ deviceId, observation })).digest('hex').slice(0, 24)}`;
}
function normalizeHealth(value) { return HEALTH.has(value) ? value : 'unknown'; }
function normalizeSecurity(value) { return SECURITY.has(value) ? value : 'unknown'; }

function deviceResource(deviceId, observed = {}) {
  const device = getDevice(deviceId);
  if (!device) return null;
  assertSafe(observed);
  return Object.freeze({
    resource_version: 'aria-device-resource-v1.0',
    resource_id: device.device_id,
    resource_class: device.resource_class,
    capabilities: device.capabilities.slice(),
    health: normalizeHealth(observed.health ?? device.health),
    security: normalizeSecurity(observed.security ?? device.security),
    provenance: observed.provenance || device.provenance,
    executor: device.executor,
    observation_id: observed.id || observationKey(device.device_id, observed)
  });
}

function selectDevice({ capability, resource_class = null, require_healthy = true, preferred_device_id = null, observed = {} } = {}) {
  if (typeof capability !== 'string' || !capability) return { status: 'blocked', reason: 'capability_missing' };
  const requested = preferred_device_id ? [preferred_device_id] : [];
  const candidates = requested.length ? requested : require('./registry').devicesByCapability(capability).map(d => d.device_id);
  const resources = candidates.map(id => deviceResource(id, observed[id] || {})).filter(Boolean).filter(r => r.capabilities.includes(capability));
  if (resource_class) resources.splice(0, resources.length, ...resources.filter(r => r.resource_class === resource_class));
  const allowed = resources.filter(r => r.security !== 'blocked' && (!require_healthy || r.health === 'healthy'));
  if (!allowed.length) return { status: 'blocked', reason: require_healthy ? 'no_healthy_device' : 'no_eligible_device', capability };
  const chosen = allowed[0];
  return { status: 'succeeded', resource: chosen, candidates: allowed };
}

function createDeviceRuntime({ executors = {}, cognition = null, authorize = null } = {}) {
  async function observe(deviceId, operation) {
    const device = getDevice(deviceId);
    if (!device) return { status: 'blocked', reason: 'device_not_found' };
    if (!device.capabilities.includes(operation)) return { status: 'blocked', reason: 'capability_unavailable' };
    const executor = executors[device.executor];
    if (!executor || typeof executor.observe !== 'function') return { status: 'blocked', reason: 'executor_unavailable' };
    const result = await executor.observe(device, operation);
    assertSafe(result);
    return { status: 'succeeded', resource: deviceResource(deviceId, result), observation: clone(result) };
  }

  async function execute({ device_id, operation, input = {}, authorization = null } = {}) {
    const device = getDevice(device_id);
    if (!device) return { status: 'blocked', reason: 'device_not_found' };
    if (!device.capabilities.includes(operation)) return { status: 'blocked', reason: 'capability_unavailable' };
    if (device.security === 'blocked') return { status: 'blocked', reason: 'device_security_blocked' };
    assertSafe(input);
    if (typeof authorize !== 'function') return { status: 'blocked', reason: 'authorization_required' };
    const gate = await authorize({ device, operation, input, authorization });
    if (!gate || gate.status !== 'approved') return { status: 'blocked', reason: 'authorization_required' };
    const executor = executors[device.executor];
    if (!executor || typeof executor.execute !== 'function') return { status: 'blocked', reason: 'executor_unavailable' };
    const result = await executor.execute(device, operation, input);
    assertSafe(result);
    return { status: 'succeeded', resource: deviceResource(device_id), result: clone(result) };
  }

  async function perceiveForCognition(deviceId, observed = {}) {
    const resource = deviceResource(deviceId, observed);
    if (!resource) return { status: 'blocked', reason: 'device_not_found' };
    if (typeof cognition !== 'function') return { status: 'succeeded', resource };
    const result = await cognition(resource);
    assertSafe(result);
    return { status: 'succeeded', resource, cognition: clone(result) };
  }

  return Object.freeze({ observe, execute, perceiveForCognition });
}

module.exports = Object.freeze({ deviceResource, selectDevice, createDeviceRuntime, normalizeHealth, normalizeSecurity });
