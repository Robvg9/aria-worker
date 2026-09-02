# Mission 11.4 — Tool Adapter / Dispatch Boundary

## Purpose
Define the protocol-neutral adapter boundary used by the Tool/MCP Gateway after Governance authorization. Adapters translate one already-authorized ARIA operation into a protocol-specific invocation without broadening scope.

## Responsibilities
- Validate adapter identity and supported protocol.
- Accept only a gateway request that is already authorized.
- Preserve request/task/execution/authorization identity.
- Preserve exact tool and operation scope.
- Normalize success/failure/blocked results.
- Redact sensitive output before returning it.

## Non-responsibilities
- No routing or tool selection.
- No governance or approval creation.
- No credential resolution or secret storage.
- No quota/fallback decisions.
- No canonical memory writes.
- No operation expansion.
- No live network dispatch in v1.

## Request
```json
{
  "adapter_id": "string",
  "protocol": "mcp|api",
  "request_id": "string",
  "task_id": "string|null",
  "execution_id": "string",
  "authorization_id": "string",
  "tool_id": "string",
  "operation": "string",
  "input": "object",
  "risk_class": "READ|LOW_RISK_WRITE|HIGH_RISK_WRITE|DESTRUCTIVE"
}
```

## Result
```json
{
  "adapter_id": "string",
  "request_id": "string",
  "execution_id": "string",
  "tool_id": "string",
  "operation": "string",
  "status": "blocked|succeeded|failed",
  "result": "object|null",
  "error_code": "string|null"
}
```

## Fail-closed rules
- Missing adapter → blocked.
- Unsupported protocol → blocked.
- Missing authorization identity → blocked.
- Missing request/execution identity → blocked.
- Missing tool/operation/input → blocked.
- Unknown risk class → blocked.
- Adapter cannot change tool, operation, authorization_id or risk_class.
- v1 adapters never perform real external I/O.
