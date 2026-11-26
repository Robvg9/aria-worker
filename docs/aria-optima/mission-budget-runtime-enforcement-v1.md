# ARIA Optima — Runtime Mission Budget Enforcement v1

## Scope

This change connects the per-mission ledger from PR #1478 to the actual cloud provider adapters in
`aria-execution-runtime-v1`. It protects the Google Gemini Direct, xAI Responses, and OpenRouter
inference POST requests. It does not apply a cost ceiling to local Windows device execution.

The device-gateway Mission 5 direct model probe, Mission 6 single/parallel router, and Mission 5
agent probe now require real caller-supplied mission/step context and pass it through the same
ledger. Agent runtime request IDs follow the required mission:step:nonce shape. Mission 6 fallback
also stops immediately on any mission-budget denial or uncertain settlement.

The separate Gemini diagnostic live-check no longer calls Google directly: it requires mission ID,
step ID, and its one-shot diagnostic nonce, then calls the shared execution runtime. Its cost and
token estimates remain unknown, so configured ceilings on those dimensions still block it.

Unscoped maintenance paths are intentionally not exempted: the RWHT direct model probe and the
All-for-One model reviewer are blocked until each has a real mission_state-backed mission and an
approved policy. The Grok MCP inbound function contains no xAI provider API call; the xAI domain
string found there is documentation only. This distinction is covered by the edge-function audit.

## Required call order

For a mission-backed provider attempt:

1. Validate the request's mission ID, step ID and request ID. The reservation key must be the runner's
   `mission_id:step_id:unique-request-id` and must fit the ledger's 240-character key limit.
2. Reserve against the approved per-mission budget using
   `mission_budget_reserve_request_v1`.
3. Reserve provider/account quota using the existing provider quota gate.
4. Only after both reservations are accepted, send the upstream inference request.
5. Settle the provider quota and mission ledger with `succeeded`, `failed`, or `unknown`.

No tokenizer or trustworthy, pre-call price source is currently wired. Therefore estimated tokens,
estimated cost, and currency are passed as NULL. A mission policy that configures a token or monetary
ceiling is intentionally rejected as unknown until those estimates can be grounded. Request-count
policies can be used when explicitly approved. Actual token counts are recorded when providers report
them; no price is inferred.

## Exemptions and test lane

Only two validated no-mission flows are exempt from the ledger:
- ARIA app conversation-only requests with their existing strict read-only contract.
- The signed Cloudflare workspace plan-preview request with its existing read-only/no-tools contract.

The supervised Mission Wonder 2 Gate 3 probe is classified as `test` only after the runtime independently
validates its scoped mission, step, human-gate proof and route. All other mission provider requests are
classified as `execution`. The caller cannot choose `test` or `closure` using free-form metadata.
The closure reserve remains protected until a dedicated trusted closure lane is implemented.

## Quota denial, uncertain outcomes, and fallback

If the provider quota gate denies a request after the mission reservation but before inference POST,
the mission reservation is released with a persisted evidence reference. If that release cannot be
confirmed, the response becomes `mission_budget_settlement_pending`.

A transport failure after dispatch is recorded as `unknown`, not released, because the request may
have reached the provider. HTTP failures and invalid responses are recorded as `failed`. A success is
returned to the runner only after the mission settlement is confirmed.

The mission runner treats every `mission_budget_*` error as mission-wide and terminal for that step.
It must not try another provider route after a denial or uncertain settlement, so a fallback cannot
circumvent the budget gate or duplicate uncertain spend.

## Safety state and limitations

- `MISSION_EXECUTION_PAUSED=true` remains unchanged. Ordinary mission execution is still frozen.
- No LIVE Supabase migration, policy row, provider call, secret read/write, merge or deployment is part
  of this PR.
- No budget ceiling, dollar amount, currency, reserve percentage or token estimate is invented.
- A token ceiling requires a trusted pre-call token estimator; a monetary ceiling requires a verified
  pre-call provider price source. Until then those dimensions fail closed.
- Runtime integration tests prove the guard wiring and RPC contracts. PostgreSQL integration tests from
  the parent PR prove the database semantics on an isolated PostgreSQL 16 instance; neither proves a
  production deploy or an external paid-provider transaction.
