const asObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const numericStatus = (value) => {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
};

export function m6ClassifyFallbackFailure(input, httpStatus = 0) {
  const payload = asObject(input) ? input : {};
  const nested = asObject(payload.error) ? payload.error : {};
  const rawMessage = [
    typeof input === 'string' ? input : '',
    typeof payload.error === 'string' ? payload.error : '',
    nested.message,
    payload.message,
    payload.details
  ].filter((part) => typeof part === 'string').join(' ').toLowerCase();
  const code = String(nested.code ?? payload.code ?? '').trim().toLowerCase();
  const outerStatus = numericStatus(httpStatus);
  const embeddedStatus = numericStatus(
    nested.provider_status ?? payload.provider_status ?? nested.status ?? payload.status_code
  );
  // A non-2xx HTTP response from the execution runtime is authoritative when
  // it conflicts with a nested provider status. For HTTP 2xx wrappers, use the
  // provider status carried in the structured error.
  const status = outerStatus >= 400 ? outerStatus : (embeddedStatus || outerStatus);

  if (status === 402) return 'quota_exhausted';
  if (status === 429) return 'rate_limit';
  if (code === 'quota_exhausted' || code === 'insufficient_credits' ||
      code === 'billing_hard_limit' || code === 'usage_limit_exceeded' ||
      /insufficient\s+(?:credits|credit|funds)|quota\s+(?:has\s+been\s+)?(?:exhausted|exceeded)|billing\s+hard\s+limit|credit\s+balance\s+(?:is\s+)?(?:empty|insufficient)/i.test(rawMessage)) {
    return 'quota_exhausted';
  }
  if (code === 'rate_limit' || code === 'rate_limited' ||
      /rate[\s_-]*limit|too many requests|requests per minute|tokens per minute/i.test(rawMessage)) {
    return 'rate_limit';
  }
  if (status === 401 || status === 403 ||
      code === 'credential_unavailable' || code === 'account_unavailable' ||
      code === 'invalid_api_key' || code === 'unauthorized') {
    return 'account_unavailable';
  }
  if (status === 408 || status === 504 || code === 'timeout' ||
      code === 'provider_timeout' || /timed?\s*out|timeout/i.test(rawMessage)) {
    return 'timeout';
  }
  if (status >= 500 || code === 'provider_unavailable' ||
      code === 'network_error' || /service unavailable|connection refused|network error/i.test(rawMessage)) {
    return 'provider_unavailable';
  }
  return 'execution_failure';
}

export function m6FallbackRouteKey(route) {
  return [
    String(route?.provider_id ?? ''),
    String(route?.account_id ?? ''),
    String(route?.model_id ?? '')
  ].join('|');
}

export function m6GovernFallback(primary, alternatives, failureKind, policy = {}) {
  if (!primary || !Array.isArray(alternatives) || alternatives.length === 0) return [];
  if (failureKind === 'rate_limit' && policy.allow_rate_limit_fallback !== true) return [];

  const visited = new Set(Array.isArray(policy.visited) ? policy.visited.map(String) : []);
  visited.add(m6FallbackRouteKey(primary));
  const seen = new Set();
  const output = [];

  for (const candidate of alternatives) {
    const key = m6FallbackRouteKey(candidate);
    if (!candidate?.provider_id || !candidate?.account_id || !candidate?.model_id ||
        visited.has(key) || seen.has(key)) continue;
    seen.add(key);

    const sameProvider = candidate.provider_id === primary.provider_id;
    const sameAccount = candidate.account_id === primary.account_id;

    // Do not move between models/accounts under the same provider to work
    // around an exhausted quota or an HTTP 429. Use an independent provider.
    if (failureKind === 'quota_exhausted' && (sameProvider || sameAccount)) continue;
    if (failureKind === 'rate_limit' && (sameProvider || sameAccount)) continue;
    if ((failureKind === 'provider_unavailable' || failureKind === 'timeout') && sameProvider) continue;
    if (failureKind === 'account_unavailable' && sameAccount) continue;

    output.push(candidate);
  }
  return output;
}
