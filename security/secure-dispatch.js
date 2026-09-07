'use strict';

function createSecureDispatch({ security, executor } = {}) {
  if (!security || typeof security.verifyActionEnvelope !== 'function') throw new TypeError('security control plane required');
  if (typeof executor !== 'function') throw new TypeError('executor function required');
  return Object.freeze({
    async dispatch({ envelope, input } = {}) {
      const verification = security.verifyActionEnvelope(envelope);
      if (!verification.valid) return { status:'blocked', reason:verification.reason, executed:false };
      const result = await executor({ envelope, input });
      return { status:'succeeded', executed:true, result };
    }
  });
}

module.exports = Object.freeze({ createSecureDispatch });
