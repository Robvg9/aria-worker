const safeInteger = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function parseOpenRouterFreeDailyQuota(payload) {
  const quota = payload?.data?.free_model_daily_requests;
  const used = quota?.used;
  const limit = quota?.limit;
  const remaining = quota?.remaining;

  if (!safeInteger(used) || !Number.isSafeInteger(limit) || limit <= 0 ||
      !safeInteger(remaining) || used > limit || remaining > limit) {
    return null;
  }

  return { used, limit, remaining };
}

const tokenCount = (...values) => {
  for (const value of values) {
    if (safeInteger(value)) return value;
  }
  return null;
};

export function extractProviderUsage(payload) {
  const usage = payload?.usage && typeof payload.usage === "object"
    ? payload.usage
    : payload?.usageMetadata && typeof payload.usageMetadata === "object"
      ? payload.usageMetadata
      : null;

  if (!usage) {
    return {
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
    };
  }

  const prompt = tokenCount(usage.prompt_tokens, usage.input_tokens, usage.promptTokenCount);
  const completion = tokenCount(usage.completion_tokens, usage.output_tokens, usage.candidatesTokenCount);
  const reportedTotal = tokenCount(usage.total_tokens, usage.totalTokenCount);
  const total = reportedTotal !== null
    ? reportedTotal
    : prompt !== null && completion !== null
      ? prompt + completion
      : null;

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

export function parseQuotaReservation(payload) {
  if (payload && typeof payload === "object" && payload.allowed === true &&
      typeof payload.reservation_key === "string" && payload.reservation_key.length > 0) {
    return { allowed: true, reservation_key: payload.reservation_key };
  }
  return {
    allowed: false,
    reason: typeof payload?.reason === "string" ? payload.reason : "quota_reservation_denied",
  };
}
