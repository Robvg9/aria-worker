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
  "created_at": "string"
}
```

## Store boundary
The production store is injected through an adapter with durable persistence. No database, filesystem persistence, approval secret, or identity provider is hardcoded here because ChatBending does not designate a concrete approval store yet.

Required adapter operations:
- `create(record)`
- `get(authorization_id)`
- `transition(authorization_id, expected_status, next_status, decision)`

The control layer validates identity/scope before allowing a transition and treats adapter failure as fail-closed.

## Human verification
For `HIGH_RISK_WRITE` and `DESTRUCTIVE`, `verification_ref` may identify an external verification result. Plaintext passwords, passphrases, OTPs, or credential material are never accepted or stored.

## Production status
Design-controlled. The adapter contract is production-ready; a concrete durable store and human approval UI remain separate implementation work.
