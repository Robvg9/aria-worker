# OmniRoute Phase 9 — Fallback / Quota / Circuit Resilience Contract v1.0.0

## Objective
Convert OmniRoute/provider failures into deterministic ARIA fallback decisions without false success.

## Failure classes
- provider A unavailable → B
- A/B unavailable → C
- all unavailable → no available provider
- 429 / rate limit
- 500 / 502 / 503
- timeout
- connection refused / gateway unavailable
- quota exhaustion
- circuit open
- cooldown active
- invalid response

## Hard gates
1. Unknown or unavailable candidate capacity is never treated as usable.
2. Candidate quota must be explicitly `available`.
3. Circuit must be explicitly `closed`.
4. Active cooldown blocks the candidate; no current time is inferred by this module.
5. Provider/account isolation is preserved after provider/gateway/quota/circuit failures.
6. Rate-limit fallback remains disabled unless ARIA explicitly allows it.
7. No execution call, retry loop, secret access, registry mutation, or `succeeded` terminalization.
8. All decisions are deterministic with stable provider/account/model ordering.

## Gate
Real fallback and coherent failure states.

## Non-goals
Live failover, mission persistence and physical stop/start recovery are deferred to later execution/recovery/E2E phases.