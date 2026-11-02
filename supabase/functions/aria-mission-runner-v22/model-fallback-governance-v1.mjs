const numericLimit = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
};

const numericStatus = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599 ? parsed : 0;
};

/**
 * Fail closed unless exactly one available quota row proves capacity for this
 * exact provider/account/model route. Account-wide (model_id NULL) rows do not
 * authorize a model route because they may describe a different quota scope.
 */
export function m22QuotaAllowsModelRoute(rows, expected) {
  if (!Array.isArray(rows) || !expected) return false;
  const providerId = String(expected.provider_id ?? "");
  const accountId = String(expected.account_id ?? "");
  const modelId = String(expected.model_id ?? "");
  if (!providerId || !accountId || !modelId) return false;

  const matches = rows.filter((row) =>
    String(row?.provider_id ?? "") === providerId &&
    String(row?.account_id ?? "") === accountId &&
    String(row?.model_id ?? "") === modelId
  );
  if (matches.length !== 1) return false;

  const quota = matches[0];
  if (String(quota?.status ?? "").toLowerCase() !== "available") return false;

  const counters = [
    ["limits_requests", "usage_requests"],
    ["limits_tokens_input", "usage_tokens_input"],
    ["limits_tokens_output", "usage_tokens_output"],
    ["limits_tokens_total", "usage_tokens_total"],
  ];
  for (const [limitField, usageField] of counters) {
    const limit = numericLimit(quota[limitField]);
    if (Number.isNaN(limit)) return false;
    if (limit === null || limit === 0) continue;
    const usage = Number(quota[usageField]);
    if (!Number.isFinite(usage) || usage < 0 || usage >= limit) return false;
  }
  return true;
}

/**
 * Match the Gateway's status precedence: an outer HTTP error takes precedence
 * over a conflicting nested provider status. 402 and 429 remain distinct.
 */
export function m22ClassifyModelFallbackFailure(httpStatus, providerStatus, code, message) {
  const outer = numericStatus(httpStatus);
  const embedded = numericStatus(providerStatus);
  const status = outer >= 400 ? outer : (embedded || outer);
  const detail = String(code ?? "") + " " + String(message ?? "");
  if (
    status === 402 ||
    /\b(?:quota|payment[\s_-]+required|insufficient[\s_-]+(?:credits?|funds)|out[\s_-]+of[\s_-]+credits?|credit[\s_-]+(?:exhausted|depleted)|billing[\s_-]+limit)\b/i.test(detail)
  ) return "quota_exhausted";
  if (
    status === 429 ||
    /\b(?:rate_limit|rate_limited)\b|rate[\s_-]*limit|too many requests|requests per minute|tokens per minute/i.test(detail)
  ) return "rate_limit";
  return "other";
}

/** HTTP 429 fallback is opt-in; truthy values other than boolean true do not count. */
export function m22RateLimitFallbackAllowed(policy) {
  return policy?.allow_rate_limit_fallback === true;
}
