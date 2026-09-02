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

function validateRef(value) {
  const ref = normalizeRef(value);
  if (!ref) return { valid: false, credential_ref: null, reason: 'credential_ref_missing' };
  if (!/^secret:\/\/[^/\s]+\/[^/\s]+$/.test(ref)) {
    return { valid: false, credential_ref: null, reason: 'credential_ref_invalid' };
  }
  if (RAW_SECRET_PATTERNS.some((pattern) => pattern.test(ref))) {
    return { valid: false, credential_ref: null, reason: 'secret_material_rejected' };
  }
  return { valid: true, credential_ref: ref, reason: null };
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error ?? 'credential_resolution_failed');
  return message
    .replace(/Bearer\s+\S+/gi, '[REDACTED]')
    .replace(/\b(?:sk|gh[pousr]|xox[baprs])_[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/secret:\/\/[^\s)]+/gi, 'secret://[REDACTED]')
    .slice(0, 500);
}

function createCredentialBoundary({ resolve }) {
  if (typeof resolve !== 'function') {
    throw new TypeError('credential resolver must be injected');
  }

  async function withCredential(credentialRef, context, transport) {
    const check = validateRef(credentialRef);
    if (!check.valid) {
      throw new Error(check.reason);
    }
    if (typeof transport !== 'function') {
      throw new TypeError('transport callback must be injected');
    }

    let resolved;
    try {
      resolved = await resolve(check.credential_ref, context ?? {});
    } catch (error) {
      throw new Error(sanitizeError(error));
    }

    if (!resolved || typeof resolved.secret !== 'string' || !resolved.secret) {
      throw new Error('credential_unavailable');
    }

    try {
      return await transport(resolved.secret, { credential_ref: check.credential_ref });
    } catch (error) {
      throw new Error(sanitizeError(error));
    }
  }

  return {
    validateRef,
    withCredential,
    sanitizeError
  };
}

module.exports = {
  createCredentialBoundary,
  validateRef,
  sanitizeError
};
