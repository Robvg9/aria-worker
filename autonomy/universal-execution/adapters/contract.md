# UO-2 — Executor / Adapter Contract

**Version:** `aria-universal-execution-adapters-v1.0.0`

## Purpose
UO-2 provides one physical adapter boundary for each executor family. The orchestrator may invoke an executor only through this boundary.

## Adapter interface

```js
{
  adapter_id,
  executor_type,
  status,
  operations,
  async execute({ missionId, step, attempt, policy, request, transport })
}
```

`execute()` returns a normalized result and MUST NOT expose secrets in the result, logs, or thrown errors.

## Initial executor families

- `connector`: GitHub/Supabase and future connector providers. The adapter delegates to the existing activation boundary.
- `device`: Termux/Android device execution. The adapter delegates to the existing device dispatcher/live device boundary.
- `agent`: delegated AI agents. The adapter delegates only to an explicitly registered agent executor.

## Invariants

- Adapter selection is by explicit executor family, never by provider/model inference.
- Adapters do not choose routes, models, accounts, credentials, fallback candidates, or governance outcomes.
- Credentials never pass through registry metadata.
- Adapter errors normalize to `adapter_error` without leaking secrets.
- The adapter boundary is dependency-injected so tests use mocks and production uses live transports.
- Existing execution, memory, governance, and activation contracts remain authoritative.
