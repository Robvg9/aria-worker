'use strict';

function verifyAgentResult(result = {}) {
  if (!result || typeof result !== 'object') return { verified: false, reason: 'invalid_result' };
  const allowed = new Set(['succeeded','failed','blocked','cancelled']);
  if (!allowed.has(result.status)) return { verified: false, reason: 'invalid_status' };
  if (result.status === 'succeeded' && (result.output === undefined || result.output === null)) return { verified: false, reason: 'missing_output' };
  if (result.error && typeof result.error !== 'string') return { verified: false, reason: 'invalid_error' };
  return { verified: true, reason: 'contract_valid' };
}

function acceptVerifiedResult(result) {
  const check = verifyAgentResult(result);
  return check.verified && result.verified === true;
}

module.exports = { verifyAgentResult, acceptVerifiedResult };