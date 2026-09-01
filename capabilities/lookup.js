/**
 * ARIA Capability Matrix lookup helpers (declarative)
 * Mission 10.3 — pure functions, no side effects, no secrets, no routing.
 */
const registry = require('./registry.json');

function capabilitiesOf(modelId) {
  if (!modelId || typeof modelId !== 'string') return [];
  return registry.capabilities.filter(c => c.model_id === modelId);
}

function modelsByCapability(capabilityId) {
  if (!capabilityId || typeof capabilityId !== 'string') return [];
  return registry.capabilities
    .filter(c => c.capability_id === capabilityId)
    .map(c => c.model_id);
}

function supports(modelId, capabilityId) {
  if (!modelId || !capabilityId) return null;
  const row = registry.capabilities.find(
    c => c.model_id === modelId && c.capability_id === capabilityId
  );
  if (!row) return null;
  if (row.status === 'verified') return true;
  if (row.status === 'unsupported') return false;
  return null; // claimed / unknown
}

function listCapabilityIds() {
  return [...new Set(registry.capabilities.map(c => c.capability_id))];
}

function getCapability(modelId, capabilityId) {
  if (!modelId || !capabilityId) return null;
  return registry.capabilities.find(
    c => c.model_id === modelId && c.capability_id === capabilityId
  ) || null;
}

module.exports = {
  version: registry.version,
  capabilitiesOf,
  modelsByCapability,
  supports,
  listCapabilityIds,
  getCapability,
  registry
};
