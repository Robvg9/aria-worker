# ARIA Execution Governance / Human-Gate Contract v1.0

## Purpose
Separate route selection from permission to execute. `selected` is not authorization.

This layer is Control Plane only. It does not route, fallback, execute, resolve credentials, mutate quota/capacity, or write memory.

## Risk classes
- `READ`
- `LOW_RISK_WRITE`
- `HIGH_RISK_WRITE`
- `DESTRUCTIVE`

## Authorization states
- `pending_approval`
- `approved`
- `rejected`
- `expired`
- `invalid`

## Decision contract
A governance decision is valid only when it is bound to the concrete execution/request and the requested operation.

```json
{
  "authorization_id": "string",
  "execution_id": "string",
  "task_id": "string|null",
  "request_id": "string|null",
  "risk_class": "READ|LOW_RISK_WRITE|HIGH_RISK_WRITE|DESTRUCTIVE",
  "decision": "pending_approval|approved|rejected|expired|invalid",
  "reviewed_by": "string|null",
  "reviewed_at": "string|null",
  "reason": "string|null",
  "evidence_ref": "string|null",
  "policy_version": "string"
}
```

## Invariants
1. `selected` never implies `approved`.
2. Missing authorization blocks execution.
3. `rejected`, `expired`, and `invalid` block execution.
4. Authorization is scoped to the concrete `execution_id` and request/operation.
5. Material changes to target, operation, or risk require reevaluation.
6. Governance cannot create or alter a route.
7. Governance cannot resolve or reveal secrets.
8. Governance cannot mutate quota/capacity.
9. Governance cannot write canonical memory.
10. v1 has no auto-approval.

## Human Gate
`READ` may proceed without a human approval only when an explicit policy says so. In the absence of such policy, the safe default is block.

`LOW_RISK_WRITE`, `HIGH_RISK_WRITE`, and `DESTRUCTIVE` require explicit approval in v1.

## Fail-closed rules
- unknown policy → `blocked`
- missing evidence → `blocked`
- scope mismatch → `blocked`
- expired authorization → `blocked`
- rejection → `blocked`

## Runtime boundary
v1 is a pure decision layer for controlled execution. It does not activate LIVE execution, create a persistent approval store, or provide a UI.
