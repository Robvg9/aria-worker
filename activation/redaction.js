'use strict';

const SENSITIVE_KEY = /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|bearer|private[-_]?key|credential/i;
const SENSITIVE_VALUE = /Bearer\s+\S+|(?:sk|or-v1|gh[pousr]_[A-Za-z0-9_]+)[A-Za-z0-9._-]{8,}/i;

function redact(value, key = '', secrets = []) {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') {
    if (secrets.some(secret => typeof secret === 'string' && secret.length > 0 && value.includes(secret))) return '[redacted]';
    return SENSITIVE_VALUE.test(value) ? '[redacted]' : value;
  }
  if (Array.isArray(value)) return value.map(item => redact(item, '', secrets));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k, secrets);
    return out;
  }
  return value;
}

module.exports = { redact };
