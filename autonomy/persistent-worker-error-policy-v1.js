'use strict';

function classifyClaimError(error) {
  const message = String(error && error.message || error || '');
  const match = message.match(/coordinator_http_(\d{3})(?::([a-z0-9_-]+))?/i);
  if (!match) return Object.freeze({ action: 'retry', reason: 'TRANSIENT_OR_UNKNOWN', exitCode: 0 });

  const status = Number(match[1]);
  const detail = String(match[2] || '').toLowerCase();

  if (status === 423 && detail === 'mission_execution_paused') {
    return Object.freeze({ action: 'stop', reason: 'MISSION_EXECUTION_PAUSED', exitCode: 0 });
  }
  if (status === 401 || status === 403) {
    return Object.freeze({ action: 'stop', reason: 'AUTHENTICATION_REJECTED', exitCode: 1 });
  }
  if (status >= 400 && status < 500 && ![408, 425, 429].includes(status)) {
    return Object.freeze({ action: 'stop', reason: 'NON_RETRYABLE_HTTP_' + status, exitCode: 1 });
  }
  return Object.freeze({ action: 'retry', reason: 'RETRYABLE_HTTP_' + status, exitCode: 0 });
}

module.exports = Object.freeze({ classifyClaimError });
