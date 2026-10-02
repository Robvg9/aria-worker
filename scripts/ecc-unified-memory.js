'use strict';

const crypto = require('node:crypto');

const NAMESPACES = Object.freeze(['context', 'learning', 'failure']);

function canonicalNamespace(name) {
  if (!NAMESPACES.includes(name)) throw new Error(`Unsupported memory namespace: ${name}`);
  return name;
}

function putMemory(envelope, namespace, key, value) {
  const ns = canonicalNamespace(namespace);
  if (!key || typeof key !== 'string') throw new Error('Memory key is required');

  const current = envelope?.[ns] || {};
  if (Object.prototype.hasOwnProperty.call(current, key) && JSON.stringify(current[key]) !== JSON.stringify(value)) {
    throw new Error(`Memory conflict in namespace ${ns}: ${key}`);
  }

  return {
    ...(envelope || {}),
    [ns]: {
      ...current,
      [key]: value,
    },
  };
}

function buildUnifiedMemory(envelope = {}, provenance = {}) {
  const normalized = {
    context: envelope.context || {},
    learning: envelope.learning || {},
    failure: envelope.failure || {},
  };

  const canonical = {
    schema: 'aria.ecc-unified-memory.v1',
    deterministic: true,
    namespaces: normalized,
    provenance: {
      context_digest_sha256: provenance.context_digest_sha256 || null,
      learning_digest_sha256: provenance.learning_digest_sha256 || null,
      failure_digest_sha256: provenance.failure_digest_sha256 || null,
    },
    policy: {
      namespace_isolation: true,
      overwrite_conflict: 'REJECT',
      auto_promote: false,
      auto_disable: false,
    },
  };

  return {
    ...canonical,
    unified_memory_digest_sha256: crypto.createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
  };
}

module.exports = { putMemory, buildUnifiedMemory, canonicalNamespace };
