# Mission 11.2 — Tool Router Contract v1.1

## Purpose
Define the deterministic Control Plane boundary that selects registered tool operations for a task before Governance authorization and Gateway dispatch.

## Position
`Tool Registry (10.9) → Tool Router (11.2) → Operation Planner (11.3) → Governance (10.12) → Tool/MCP Gateway (11.1) → Adapter Boundary (11.4) → Execution`

Selection is not authorization and authorization is not execution.

## Responsibilities
- Accept normalized task intent and requested capability/tool intent.
- Resolve candidates only from the Tool Registry.
- Filter by declared availability, operation support, capability fit and supplied policy constraints.
- Produce deterministic ordered selections.
- Support multi-tool chaining as independently governed steps.
- Preserve exact requested operation and scope.
- Return `no_route` when evidence is insufficient or no valid candidate exists.

## Non-responsibilities
No approval, credential resolution, dispatch, registry mutation, quota/capacity mutation, retry/fallback execution, or canonical memory write.

## Deterministic rules
1. Required task/request identity is mandatory.
2. Only registry-declared tools with `status=available` are candidates.
3. Requested operation must match exactly.
4. Requested capability must be declared by the candidate.
5. Preferences may narrow selection but cannot revive an invalid candidate.
6. Stable lexical ordering is used for deterministic plans.
7. Ambiguous selection fails closed.
8. Multi-step plans are composed independently and preserve order.

## Safety
`registered ≠ available ≠ selected ≠ authorized ≠ executed`.
