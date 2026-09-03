'use strict';

const ALLOWED = Object.freeze(['version','identity','capabilities','tools','connectors','providers','health','tests','git']);

function clone(value) { return structuredClone(value); }

function createSelfInspector({ snapshot } = {}) {
  if (typeof snapshot !== 'function') throw new TypeError('snapshot_required');
  return Object.freeze({
    async inspect({ include = ALLOWED } = {}) {
      if (!Array.isArray(include)) throw new TypeError('include_must_be_array');
      const requested = include.filter(k => ALLOWED.includes(k));
      const raw = await snapshot(requested);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 'failed', reason: 'invalid_snapshot' };
      const out = {};
      for (const key of requested) if (Object.prototype.hasOwnProperty.call(raw, key)) out[key] = clone(raw[key]);
      return { status: 'succeeded', scope: requested, snapshot: out };
    },
    allowedScopes: [...ALLOWED]
  });
}

module.exports = { createSelfInspector, ALLOWED_SCOPES: ALLOWED };
