# Mission 11.3 — Tool Operation Planner / Normalizer v1.1

## Purpose
Normalize a deterministic 11.2 Tool Router result into an explicit, scope-preserving operation plan for downstream Governance authorization and Tool/MCP Gateway dispatch.

## Position
`Tool Registry (10.9) → Tool Router (11.2) → Operation Planner (11.3) → Governance (10.12) → Tool/MCP Gateway (11.1) → Adapter Boundary (11.4) → Execution`

## Responsibilities
- Accept a valid route result from 11.2.
- Normalize every selected operation into an explicit ordered step.
- Preserve task/request identity, tool, operation, risk, selection reason and order.
- Reject malformed, ambiguous, unsupported, secret-bearing or duplicated operations.
- Produce stable input for Governance and Gateway.

## Non-responsibilities
No execution/network dispatch, credential or secret resolution, authorization/approval, quota/capacity mutation, retry/fallback, canonical memory writes, scope broadening or step injection.

## Fail-closed rules
- Non-route input is rejected.
- Missing task/request identity is rejected.
- Empty plans are rejected.
- Missing tool/operation/risk/selection reason is rejected.
- Unknown risk class is rejected.
- Duplicate identical tool/operation entries are rejected.
- Router order is preserved exactly.
- `authorization_required` is always `true` in v1.

## Runtime posture
Normalization is implemented and remains side-effect free. Dispatch occurs only after downstream Governance through the controlled Gateway boundary.
