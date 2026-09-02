# Mission 11.4 — Tool Adapter / Dispatch Boundary v1.1

## Purpose
Define the protocol-neutral adapter boundary used by the Tool/MCP Gateway after Governance authorization. Adapters translate one already-authorized ARIA operation into a protocol-specific invocation without broadening scope.

## Responsibilities
- Validate adapter identity and supported protocol metadata.
- Accept only a Gateway request that is already authorized.
- Preserve request/task/execution/authorization identity.
- Preserve exact tool, operation and risk scope.
- Normalize success/failure/blocked results.
- Prevent sensitive output from crossing the Gateway boundary.

## Non-responsibilities
- No routing or tool selection.
- No governance or approval creation.
- No credential resolution or secret storage.
- No quota/fallback decisions.
- No canonical memory writes.
- No operation expansion.
- No automatic external network client creation by the boundary itself.

## Controlled runtime
The repository's Gateway passes a frozen normalized request to an injected adapter `execute(request)`. The adapter owns protocol-specific behavior. Tests use controlled adapters; production live I/O remains an explicit deployment concern.

## Request
```json
{
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
  "status": "blocked|succeeded|failed",
  "result": "object|null",
  "error_code": "string|null",
  "metadata": "object"
}
```

## Fail-closed rules
- Missing adapter → blocked.
- Unsupported/malformed request → blocked before adapter execution.
- Authorization scope mismatch → blocked before adapter execution.
- Required human verification missing → blocked before adapter execution.
- Adapter exception → normalized blocked/adapter_error at Gateway boundary.
- Sensitive adapter output → blocked.
- Adapter cannot change tool, operation, authorization_id or risk_class.
