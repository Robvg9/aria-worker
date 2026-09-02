# ARIA Tool/MCP Gateway Contract v1.1

## Purpose
Provide one governed boundary between ARIA and external tools/services. The gateway validates normalized requests and performs controlled adapter dispatch without becoming the Tool Registry, Tool Router, Governance engine, or Execution Engine.

## Responsibilities
- Accept a normalized tool invocation request.
- Resolve a registered tool and operation.
- Enforce that the request carries the governance decision required by 10.12.
- Enforce risk and scope metadata before dispatch.
- Dispatch through an injected tool adapter boundary.
- Return a sanitized normalized result.
- Emit metadata-only observability events when the caller supplies the hook.

## Non-responsibilities
The gateway does not invent tools, choose the best tool, create approvals, resolve secrets, bypass quotas, perform fallback, write canonical memory, silently change the requested operation, or create external network clients.

## Tool lifecycle
`discovered → registered → selectable → authorized → dispatched → completed|failed|blocked`

Unknown or unavailable tools are never treated as available.

## Request contract
```json
{
  "request_id": "string",
  "task_id": "string|null",
  "execution_id": "string",
  "tool_id": "string",
  "operation": "string",
  "input": "object",
  "authorization_id": "string",
  "risk_class": "READ|LOW_RISK_WRITE|HIGH_RISK_WRITE|DESTRUCTIVE"
}
```

## Authorization binding
The gateway rejects requests when authorization is missing, not approved, expired, invalid, or scoped to a different execution/request/tool/operation/risk class.

## Human verification
For high-risk or destructive operations, Governance may require an additional human verification step. The gateway accepts only a verification result/token reference; it never accepts or stores a plaintext password.

## Dispatch
The Gateway exposes `dispatchAuthorized(...)` through the controlled runtime boundary. The caller supplies an adapter with an async `execute(normalizedRequest)` operation. The Gateway preserves exact identity and operation scope, normalizes adapter output, and rejects sensitive output.

## Result contract
```json
{
  "request_id": "string",
  "execution_id": "string",
  "tool_id": "string",
  "operation": "string",
  "status": "succeeded|failed|blocked",
  "result": "object|null",
  "error_code": "string|null",
  "metadata": "object"
}
```

## Fail-closed
- missing tool → blocked
- unknown tool status → blocked
- unavailable tool → blocked
- missing operation → blocked
- unknown operation → blocked
- missing authorization → blocked
- authorization mismatch → blocked
- required verification missing → blocked
- adapter unavailable → blocked
- adapter error → blocked
- sensitive adapter output → blocked

## Security invariants
1. No direct secret resolution in gateway code.
2. No plaintext password handling or storage.
3. No automatic approval of high-risk/destructive operations.
4. No account hopping to evade quota or policy.
5. No route mutation.
6. No fallback mutation.
7. No canonical memory write.
8. No execution outside the authorized operation scope.
9. No sensitive payload logging by default.
10. Unknown evidence never becomes permission.

## Live boundary
Controlled injected-adapter dispatch is implemented. Live external dispatch remains disabled by default; production network access belongs to an explicitly provisioned adapter/runtime outside this repository boundary.
