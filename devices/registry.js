'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REGISTRY_PATH = path.join(__dirname, 'registry.json');
const VERSION = 'aria-device-registry-v1.0.0';
const CLASSES = new Set(['mobile','desktop','browser','cloud_runtime','database_runtime','local_runtime','iot']);
const HEALTH = new Set(['unknown','healthy','degraded','unhealthy','offline']);
const SECURITY = new Set(['unknown','trusted','restricted','blocked']);
const SECRET_LIKE = /(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----|bearer\s+[A-Za-z0-9._-]{16,})/i;

function assertSafe(value) {
  if (SECRET_LIKE.test(JSON.stringify(value))) throw new Error('secret_material_rejected');
}

function loadRegistry() {
  const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  if (raw.version !== VERSION || !Array.isArray(raw.resources)) throw new Error('device_registry_invalid');
  assertSafe(raw);
  const ids = new Set();
  for (const d of raw.resources) {
    if (!d.device_id || ids.has(d.device_id)) throw new Error('device_id_duplicate');
    if (!CLASSES.has(d.resource_class)) throw new Error('resource_class_invalid');
    if (!Array.isArray(d.capabilities) || d.capabilities.length === 0) throw new Error('capabilities_missing');
    if (!HEALTH.has(d.health) || !SECURITY.has(d.security)) throw new Error('device_state_invalid');
    ids.add(d.device_id);
  }
  return Object.freeze(raw.resources.map(d => Object.freeze({ ...d, capabilities: Object.freeze([...d.capabilities]) })));
}

const REGISTRY = loadRegistry();

function getDevice(deviceId) {
  return REGISTRY.find(d => d.device_id === deviceId) || null;
}
function listDevices() { return REGISTRY.map(d => ({ ...d, capabilities: [...d.capabilities] })); }
function devicesByCapability(capability) {
  if (typeof capability !== 'string' || !capability) return [];
  return REGISTRY.filter(d => d.capabilities.includes(capability)).map(d => ({ ...d, capabilities: [...d.capabilities] }));
}
function capabilitiesOf(deviceId) { return getDevice(deviceId)?.capabilities.slice() || []; }
function classOf(deviceId) { return getDevice(deviceId)?.resource_class || null; }
function isKnown(deviceId) { return !!getDevice(deviceId); }

module.exports = Object.freeze({ VERSION, REGISTRY, getDevice, listDevices, devicesByCapability, capabilitiesOf, classOf, isKnown });
