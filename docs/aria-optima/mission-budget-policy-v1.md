# ARIA Optima — Mission Budget Policy v1

## Purpose

Provide an auditable, versioned budget policy and reservation ledger per mission_id.
This is a data and enforcement primitive for the execution control plane. It is deliberately separate
from provider quota: provider quota limits what an account/model can consume; a mission budget limits
what one mission is authorized to reserve.

## Safety semantics

- A missing policy, a draft policy, or a revoked policy blocks reservation.
- NULL means not configured or unknown, never unlimited.
- No policy rows or budget values are seeded by this migration.
- A policy must be created as draft and approved with an approval reference, approver, timestamp,
  and at least one explicit ceiling.
- Approved policies are immutable. To change one, revoke it and create a new, higher version.
- One approved policy per mission is enforced by a partial unique index.
- Request, token, and cost ceilings are optional independently. When a ceiling is configured, its
  corresponding estimate must be known before reservation.
- Cost is checked only with a supplied amount and the exact approved three-letter currency. No
  provider price, exchange rate, or currency is inferred.
- Test and closure reserves are absolute request/token/cost quantities. They are not percentages.
  There is no default reserve ratio. The owner must specify values explicitly.
- An unknown outcome retains the estimate against the budget. Only released frees a reservation,
  and callers may use that outcome only when reliable evidence proves no upstream request was sent.
- Settlement is single-use. Actual consumption may exceed estimates; the settlement records the
  measured values and returns budget_overrun=true without deleting or rewriting history.
- Reservation calls serialize on the approved policy row (FOR UPDATE) to prevent concurrent
  requests from overspending the same policy.

## Database artifacts

- aria_internal.mission_budget_policies_v1 — versioned owner-approved policy.
- aria_internal.mission_budget_reservations_v1 — append-only reservation and settlement ledger.
- mission_budget_reserve_request_v1 — pre-execution reservation gate.
- mission_budget_settle_request_v1 — one-time settlement and overrun detection.

Both tables reference aria_internal.mission_state(mission_id). Tables have RLS enabled and direct access
is revoked from PUBLIC, anon, and authenticated. Function execution is granted only to service_role.

## Critical integration limitation

This migration and its PostgreSQL tests establish the schema, ledger semantics, grants, and atomic
reservation/settlement functions. **They do not yet prove that the existing ARIA gateway/runtime calls
the reservation function before every provider request.** Until the provider execution path is wired
to call mission_budget_reserve_request_v1 and to settle the matching reservation on every terminal
outcome, this schema is not a complete runtime spend guard.

Do not describe missions as economically enforced until that call-path integration and its end-to-end
tests pass. No Supabase LIVE migration, budget policy approval, provider request, or mission execution
is part of this PR.

## Owner decisions required before activation

For each mission that may incur cost, the owner must explicitly approve:

1. Maximum request count and/or token ceiling.
2. Maximum monetary amount and currency, only where provider price evidence exists.
3. Absolute test reserve and closure reserve quantities.
4. Approval reference and approver identity.

No dollar value, currency, token ceiling, request count, or reserve ratio is assigned by this implementation.
