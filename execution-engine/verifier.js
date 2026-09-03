'use strict';

function verifyStep(result, rules = {}) {
  if (!result || typeof result !== 'object') return { verified:false, reason:'result_missing' };
  if (result.status !== 'succeeded') return { verified:false, reason:'execution_not_succeeded' };
  if (typeof rules.verify !== 'function') return { verified:true, reason:'status_only' };
  try {
    return rules.verify(result) === true ? { verified:true, reason:'custom_verifier' } : { verified:false, reason:'custom_verifier_failed' };
  } catch (_) { return { verified:false, reason:'custom_verifier_error' }; }
}

async function verifyTask(results, verify = null) {
  if (!Array.isArray(results)) return { verified:false, reason:'results_missing' };
  if (results.some(r => !r || r.status !== 'succeeded')) return { verified:false, reason:'step_failed' };
  if (typeof verify !== 'function') return { verified:true, reason:'all_steps_succeeded' };
  try { return (await verify(results)) === true ? { verified:true, reason:'custom_verifier' } : { verified:false, reason:'custom_verifier_failed' }; }
  catch (_) { return { verified:false, reason:'custom_verifier_error' }; }
}

module.exports = { verifyStep, verifyTask };
