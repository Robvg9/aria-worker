# OmniRoute Phase 7 — Router Integration Contract v1.0.0

## Purpose
Expose OmniRoute to the ARIA Router as an explicit opt-in route, without adding OmniRoute to the default candidate pool.

## Authority boundary
ARIA remains authoritative for task/capability selection, permissions/authorization, evidence and persistence, route opt-in, and mission state.
OmniRoute remains subordinate infrastructure that may choose a provider/model only inside the explicitly authorized gateway.

## Hard gates
1. opt_in === true.
2. provider_id === omniroute.
3. capability === text_generation.
4. model_id and account_id are present.
5. Gateway endpoint is HTTP loopback only.
6. Availability evidence is explicitly verified, healthy, tied to omniroute.gateway, and bound to the same endpoint.
7. The default router.route() path remains unchanged.

## Non-goals
Phase 7 does not add OmniRoute to default routing, invent capacity/quota, call OmniRoute from the control-plane Router, store secrets, replace the existing fallback engine, or certify canonical mission E2E.

## Test coverage

Phase 7 assertions are integrated into `tests/intelligent-router-current.test.js`, which is part of the canonical `npm test` suite. A separate duplicate test file is intentionally not maintained.

## Gate
Implementation gate: ARIA can construct a deterministic, explicitly opted-in OmniRoute route while existing default routing remains unchanged.
Live/E2E gate: deferred to later canonical execution phases; static implementation is not claimed as LIVE/E2E PASS.