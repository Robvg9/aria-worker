'use strict';

/**
 * ARIA Core Identity — Mission 1.1
 * Pure identity/metadata surface. No secrets, network, storage or execution.
 */

const IDENTITY = Object.freeze({
  id: 'aria',
  name: 'ARIA',
  role: 'autonomous-ai-agent',
  architecture: 'core-plus-tools',
  memory_authority: 'chatbending',
  execution_authority: 'governance-gated'
});

function getIdentity() {
  return { ...IDENTITY };
}

function createCoreContext(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('overrides must be an object');
  }
  return Object.freeze({
    ...getIdentity(),
    ...overrides
  });
}

module.exports = { IDENTITY, getIdentity, createCoreContext };
