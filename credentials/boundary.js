'use strict';

const RAW_SECRET_PATTERNS = [
  /^sk-[A-Za-z0-9_-]{8,}$/,
  /^Bearer\s+\S+/i,
  /^gh[pousr]_[A-Za-z0-9_]{8,}$/,
  /^xox[baprs]-[A-Za-z0-9-]{8,}$/,
  /^secret_[A-Za-z0-9_-]{8,}$/,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
];

function normalizeRef(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function looksLikeRawSecret(value) {
  return typeof value === 'string' && RAW_SECRET_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

function validateRef(value) {
  const ref = normalizeRef(value);
  if (!ref) return { valid: false, credential_ref: null, reason: 'credential_ref_missing' };
  if (!/^secret:\/\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(ref)) {
    return { valid: false, credential_ref: null, reason: looksLikeRawSecret(ref) ? 'secret_material_rejected' : 'credential_ref_invalid' };
  }
  return { valid: true, credential_ref: ref, reason: null };
}

function sanitizeError(error, secret = null) {
  const message = error instanceof Error ? error.message : String(error ?? 'credential_resolution_failed');
  let sanitized = message
    .replace(/Bearer\s+\S+/gi, '[REDACTED]')
    .replace(/\b(?:sk|gh[pousr]|xox[baprs])[-_][A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/secret:\/\/[^\s)]+/gi, 'secret://[REDACTED]');
  if (secret && sanitized.includes(secret)) sanitized = sanitized.split(secret).join('[REDACTED]');
  return sanitized.slice(0, 500);
}

function outputContainsSecret(value, secret) {
  if (!secret) return false;
  if (typeof value === 'string') return value.includes(secret);
  try { return JSON.stringify(value).includes(secret); } catch { return false; }
}

function createCredentialBoundary({ resolve }) {
  if (typeof resolve !== 'function') throw new TypeError('credential resolver must be injected');

  async function withCredential(credentialRef, context, transport) {
    const check = validateRef(credentialRef);
    if (!check.valid) throw new Error(check.reason);
    if (typeof transport !== 'function') throw new TypeError('transport callback must be injected');

    let resolved;
    try {
      resolved = await resolve(check.credential_ref, context ?? {});
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
    if (!resolved || typeof resolved.secret !== 'string' || !resolved.secret) throw new Error('credential_unavailable');

    const secret = resolved.secret;
    try {
      const result = await transport(secret, { credential_ref: check.credential_ref });
      if (outputContainsSecret(result, secret)) throw new Error('secret_output_blocked');
      return result;
    } catch (error) {
      throw new Error(sanitizeError(error, secret));
    }
  }

  return { validateRef, withCredential, sanitizeError };
}

module.exports = { createCredentialBoundary, validateRef, sanitizeError };
