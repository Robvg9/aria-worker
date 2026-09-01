/**
 * ARIA Execution Engine — Credential Resolution interface (Mission 10.8)
 *
 * 10.4 delivers only `credential_ref` (secret://{provider}/{account}).
 * ChatBending does NOT define the concrete secure secret store yet, so this
 * module only exposes the interface and a null resolver. Nothing here reads
 * env vars, files, or networks.
 */
const CREDENTIAL_RESOLVER_NOTE = 'CREDENTIAL RESOLVER NOT IMPLEMENTED';

const RESOLVED = 'resolved';
const UNAVAILABLE = 'unavailable';

function isCredentialRef(ref) {
  return typeof ref === 'string' && /^secret:\/\/[^/\s]+\/[^/\s]+$/.test(ref);
}

/**
 * Default resolver: never resolves. Documents the pending point explicitly.
 */
const nullCredentialResolver = {
  resolver_id: 'null',
  resolve() {
    return { status: UNAVAILABLE, reason: CREDENTIAL_RESOLVER_NOTE };
  }
};

/**
 * Validates a resolver result shape without ever echoing the secret.
 */
function normalizeResolution(result) {
  if (!result || typeof result !== 'object') {
    return { status: UNAVAILABLE, reason: 'resolver_invalid_result' };
  }
  if (result.status === RESOLVED) {
    if (typeof result.secret !== 'string' || result.secret.length === 0) {
      return { status: UNAVAILABLE, reason: 'resolver_empty_secret' };
    }
    return { status: RESOLVED, secret: result.secret };
  }
  return {
    status: UNAVAILABLE,
    reason: typeof result.reason === 'string' ? result.reason : 'unavailable'
  };
}

function resolveCredential(credentialRef, resolver) {
  if (!isCredentialRef(credentialRef)) {
    return { status: UNAVAILABLE, reason: 'credential_ref_invalid' };
  }
  const r = resolver && typeof resolver.resolve === 'function' ? resolver : nullCredentialResolver;
  let out;
  try {
    out = r.resolve(credentialRef);
  } catch (e) {
    return { status: UNAVAILABLE, reason: 'resolver_error' };
  }
  return normalizeResolution(out);
}

module.exports = {
  CREDENTIAL_RESOLVER_NOTE,
  RESOLVED,
  UNAVAILABLE,
  isCredentialRef,
  nullCredentialResolver,
  resolveCredential
};
