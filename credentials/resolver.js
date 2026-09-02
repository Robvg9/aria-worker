'use strict';

/**
 * ARIA Block B — Concrete Credential Resolver
 *
 * This module makes the existing secret:// contract executable without
 * choosing a secret-management vendor or persisting credentials.
 *
 * A caller injects getSecret(ref, context). The resolver:
 * - accepts only canonical secret://provider/account refs;
 * - never reads process.env, files, databases, logs, or registries;
 * - never exposes resolver exceptions or secret material;
 * - returns a transient secret only to the execution caller.
 */

const { validateRef } = require('./boundary');

const RESOLVED = 'resolved';
const UNAVAILABLE = 'unavailable';

function createCredentialResolver({ getSecret }) {
  if (typeof getSecret !== 'function') {
    throw new TypeError('getSecret must be injected');
  }

  return Object.freeze({
    resolver_id: 'injected-secret-store-v1',

    async resolve(credentialRef, context = {}) {
      const check = validateRef(credentialRef);
      if (!check.valid) {
        return { status: UNAVAILABLE, reason: check.reason };
      }

      let secret;
      try {
        secret = await getSecret(check.credential_ref, context);
      } catch {
        // Never surface resolver/vendor errors: they may contain secret data.
        return { status: UNAVAILABLE, reason: 'resolver_error' };
      }

      if (typeof secret !== 'string' || secret.length === 0) {
        return { status: UNAVAILABLE, reason: 'credential_unavailable' };
      }

      return { status: RESOLVED, secret };
    }
  });
}

/**
 * Cloudflare-compatible binding adapter.
 * `bindings` is expected to be the Worker `env` object or an equivalent
 * injected binding container. `bindingsByRef` contains only non-secret
 * binding names, never credential values.
 */
function createBindingCredentialResolver({ bindings, bindingsByRef }) {
  if (!bindings || typeof bindings !== 'object') {
    throw new TypeError('bindings must be injected');
  }
  if (!bindingsByRef || typeof bindingsByRef !== 'object') {
    throw new TypeError('bindingsByRef must be injected');
  }

  return createCredentialResolver({
    getSecret(ref) {
      const bindingName = bindingsByRef[ref];
      if (typeof bindingName !== 'string' || !bindingName) return null;
      const secret = bindings[bindingName];
      return typeof secret === 'string' && secret.length > 0 ? secret : null;
    }
  });
}

module.exports = {
  RESOLVED,
  UNAVAILABLE,
  createCredentialResolver,
  createBindingCredentialResolver
};
