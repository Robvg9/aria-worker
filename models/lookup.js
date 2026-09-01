/**
 * ARIA Model Registry lookup helpers (declarative)
 * Mission 10.2 — pure functions, no side effects, no secrets.
 */
const registry = require('./registry.json');

function getModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  return registry.models.find(m => m.model_id === modelId) || null;
}

function modelsByProvider(providerId) {
  if (!providerId || typeof providerId !== 'string') return [];
  return registry.models.filter(m => m.provider_id === providerId);
}

function providerOf(modelId) {
  const m = getModel(modelId);
  return m ? m.provider_id : null;
}

function listModelIds() {
  return registry.models.map(m => m.model_id);
}

module.exports = {
  version: registry.version,
  getModel,
  modelsByProvider,
  providerOf,
  listModelIds,
  registry
};
