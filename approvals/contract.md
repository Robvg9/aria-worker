# ARIA Persistent Human Approval Store — Block A / A2

## Purpose
Define a durable approval boundary for operations that Governance classifies as requiring human approval. The store records decisions; it does not execute tools, resolve secrets, select routes, or grant permissions beyond the recorded decision.

## Approval identity
Each approval is bound to:
- `authorization_id`
- `request_id`
- `execution_id`
- `tool_id`
- `operation`
- `risk_class`
- `target` (canonical, non-secret descriptor)
- `policy_version`

## States
`pending | approved | rejected | expired | revoked`

Missing, unknown, malformed, expired, or mismatched approval is non-executable.

## Approval record
```json
{
  "authorization_id": "string",
  "request_id": "string",
  "execution_id": "string",
  "tool_id": "string",
  "operation": "string",
  "risk_class": "READ|LOW_RISK_WRITE|HIGH_RISK_WRITE|DESTRUCTIVE",
  "target": "object",
  "status": "pending|approved|rejected|expired|revoked",
  "approved_by": "string|null",
  "approved_at": "string|null",
  "expires_at": "string|null",
  "verification_ref": "string|null",
  "policy_version": "string",
  "created_at": "string",
  "updated_at": "string"
}
```

## Durable store boundary
The PR provides a durable Supabase store schema under `aria_internal.execution_approvals` plus an injected Supabase adapter. The control layer remains storage-agnostic and requires the adapter contract:
- `create(record)`
- `get(authorization_id)`
- `transition(authorization_id, expected_status, next_status, decision)`

The database is intentionally not exposed to `anon` or `authenticated`; service-role access is the operational boundary. The migration does not seed approvals.

## Transition rules
New records must start `pending`. Approval requires an explicit approver and approval timestamp. High-risk/destructive execution additionally requires a non-secret `verification_ref`. Expired, rejected, or revoked records are non-executable. Race-safe transition belongs to the durable adapter/database condition, not to caller-side optimism.

## Human verification
For `HIGH_RISK_WRITE` and `DESTRUCTIVE`, `verification_ref` identifies an external verification result. Plaintext passwords, passphrases, OTPs, bearer tokens, or credential material are never accepted or stored.

## Production status
Design-controlled durable persistence. The schema and adapter are present, but the live approval UI/identity verification flow is intentionally not activated by this block.
