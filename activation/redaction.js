'use strict';

const SENSITIVE_KEY = /authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|bearer|private[-_]?key/i;
const SENSITIVE_VALUE = /Bearer\s+\S+|(?:sk|or-v1)-[A-Za-z0-9._-]{8,}/i;

function redact(value, key = '') {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (typeof value === 'string') return SENSITIVE_VALUE.test(value) ? '[redacted]' : value;
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, k);
    return out;
  }
  return value;
}

module.exports = { redact };
