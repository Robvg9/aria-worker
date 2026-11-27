const UNKNOWN_CODE = "mission_budget_execution_runtime_outcome_unknown";

function unknown(status = null) {
  return {
    kind: "unknown",
    status: Number.isInteger(status) ? status : null,
    error: {
      code: UNKNOWN_CODE,
      message: "The internal execution runtime response was lost or unusable; provider outcome may be unknown. Agent fallback and mission retries are forbidden.",
    },
  };
}

export async function fetchAgentExecutionOutcome(fetchImpl, endpoint, init) {
  if (typeof fetchImpl !== "function") return unknown();
  let response;
  try {
    response = await fetchImpl(endpoint, init);
  } catch {
    return unknown();
  }
  const status = Number.isInteger(response?.status) ? response.status : null;
  let body;
  try {
    body = await response.json();
  } catch {
    return unknown(status);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return unknown(status);
  const budgetCode = String(body?.error?.code || body?.error?.reason || "");
  if (!response.ok && status !== null && status >= 500 && !budgetCode.startsWith("mission_budget_")) {
    return unknown(status);
  }
  if (response.ok && typeof body.status !== "string") return unknown(status);
  return { kind: "response", ok: Boolean(response.ok), status, body };
}
