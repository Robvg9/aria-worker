# Mission 11.3 — Tool Operation Planner / Normalizer

## Purpose
Normalize a deterministic 11.2 Tool Router result into an explicit, scope-preserving operation plan for downstream Governance authorization and Tool/MCP Gateway dispatch.

## Position
`Tool Registry (10.9) → Tool Router (11.2) → Operation Planner (11.3) → Governance (10.12) → Tool/MCP Gateway (11.1) → Execution`

## Responsibilities
- Accept a valid route result from 11.2.
- Normalize each selected operation into an explicit step.
- Preserve task/request identity, tool, operation, risk and ordering.
- Reject malformed, ambiguous, unsupported or duplicated operations.
- Produce stable input for Governance.

## Non-responsibilities
- No execution/network dispatch.
- No credential or secret resolution.
- No authorization or approval.
- No quota/capacity mutation.
- No retry/fallback.
- No canonical memory writes.
- No scope broadening or step injection.

## Input
```json
{
  "status": "route",
  "task_id": "string",
  "request_id": "string",
  "plan": [
    {
      "tool_id": "string",
      "operation": "string",
      "risk_class": "READ|LOW_RISK_WRITE|HIGH_RISK_WRITE|DESTRUCTIVE",
      "selection_reason": "string"
    }
  ]
}
```

## Output
```json
{
  "status": "plan",
  "task_id": "string",
  "request_id": "string",
  "steps": [
    {
      "step_id": "step-1",
      "index": 0,
      "tool_id": "string",
      "operation": "string",
      "risk_class": "READ|LOW_RISK_WRITE|HIGH_RISK_WRITE|DESTRUCTIVE",
      "selection_reason": "string"
    }
  ],
  "authorization_required": true
}
```

## Fail-closed rules
- Non-route input is rejected.
- Missing task/request identity is rejected.
- Empty plan is rejected.
- Missing tool, operation, risk or selection reason is rejected.
- Unknown risk class is rejected.
- Duplicate identical tool/operation entries are rejected to avoid ambiguous downstream authorization.
- Router order is preserved exactly.
- The planner never changes availability, authorization or execution state.
- `authorization_required` is always true in v1.

## V1
Design-controlled normalization only. LIVE dispatch remains disabled.
