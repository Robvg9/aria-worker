# Universal Execution Orchestration — UO-1 Contract

Version: `aria-universal-execution-v1.0.0`

## Responsibility
UO-1 defines the stable boundary between a mission step and the executor that can perform it. It does not choose providers/models, credentials, routes, fallbacks, or governance decisions.

## Canonical step

```json
{
  "id": "step_1",
  "operation": "shell.execute",
  "executor_type": "device",
  "target": { "type": "device", "device_id": "android-termux" },
  "input": {},
  "risk_class": "READ"
}
```

## Executor types

- `connector`: routes an operation to an existing connector/runtime boundary. Target requires `connector_id`.
- `device`: routes execution to a device executor. UO-1 registers `shell.execute`; target requires `device_id`.
- `agent`: delegates to a registered agent executor. UO-1 registers `delegate`; target requires `agent_id`.

## Resolution rules

1. `executor_type` is preferred when present.
2. Otherwise `target.type` may provide the executor type.
3. Unknown executor types are rejected deterministically.
4. Missing target identifiers are rejected deterministically.
5. Registry lookup is side-effect free.
6. Registry lookup never receives or exposes credential material.

## Non-responsibilities

UO-1 does not perform execution, retries, recovery, fallback, account hopping, provider selection, model selection, policy approval, persistence, or canonical memory writes.

## PASS criteria

UO-1 is complete only when:

- registry metadata parses and is deterministic;
- all three executor types are registered with explicit operation/target contracts;
- lookup rejects unknown executors and malformed targets;
- existing `autonomy/universal-executor.js` can consume the normalized executor type without changing its execution semantics;
- unit tests cover positive and negative lookup cases;
- the complete repository test suite remains green;
- no canonical memory path is modified.
