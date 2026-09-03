'use strict';

function createCredentialManager({ resolver, allowRef = (ref) => typeof ref === 'string' && /^secret:\/\/[a-zA-Z0-9._:-]+$/.test(ref) } = {}) {
  if (typeof resolver !== 'function') throw new TypeError('resolver is required');
  async function resolve(ref, context = {}) {
    if (!allowRef(ref)) throw new Error('invalid_credential_ref');
    const secret = await resolver(ref, context);
    if (typeof secret !== 'string' || !secret) throw new Error('credential_unavailable');
    return secret;
  }
  return Object.freeze({ resolve, isValidRef: allowRef });
}

module.exports = { createCredentialManager };
