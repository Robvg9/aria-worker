# OmniRoute Phase 8 — Auto-Combo / Intelligent Routing Contract v1.0.0

## Objective
Expose OmniRoute selection modes to ARIA without delegating routing authority.

## Authority boundary
ARIA decides task, capability, allowed set, constraints, permissions, and context.
OmniRoute Auto-Combo may only select provider/account/model entries already present in the ARIA-approved allowed set.

## Supported modes
- `auto`
- `auto/coding`
- `auto/fast`
- `auto/cheap`
- `auto/offline`

## Hard gates
1. `task_id`, task and canonical capability are present.
2. Mode is explicitly supported.
3. `allowed_routes` is non-empty.
4. Every selectable route is explicitly `allowed=true` and `availability_status=available`.
5. Evidence source is `aria.router.allowed_set`.
6. Evidence target/provider/model exactly matches the selected route.
7. Offline mode requires `offline=true` and `local=true`.
8. Selection is deterministic and has no network, secret or registry mutation authority.
9. Constraints are applied before selection.

## Selection rules
- `auto`: stable provider/account/model ordering after gates.
- `auto/coding`: only routes tagged `coding`, then stable ordering.
- `auto/fast`: lowest observed latency, then stable ordering.
- `auto/cheap`: lowest observed cost, then stable ordering.
- `auto/offline`: only local offline routes, then stable ordering.

## Gate
Reproducible selection + evidence of target/provider/model.

## Non-goals
This phase does not add OmniRoute to the default Router pool, does not execute providers, does not read secrets, and does not certify canonical LIVE/E2E mission execution.