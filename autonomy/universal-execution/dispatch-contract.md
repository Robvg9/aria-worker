# UO-11.4 — Tool Adapter / Dispatch Boundary Contract

**Version:** `aria-tool-adapter-dispatch-boundary-v1.0.0`

## Responsibility

This boundary is the final control-plane handoff from normalized tool operations to an already-selected executor adapter. It does not choose providers, models, accounts, credentials, routes, fallbacks, or governance outcomes.

## Input contract

A dispatch request contains a normalized `step` plus mission/request context. The boundary resolves the adapter only from `executor_type` (or `target.type` when executor type is omitted).

## Scope rules

- The adapter executor family must match `step.executor_type` when explicit.
- The adapter executor family must match `step.target.type` when explicit.
- A contradictory executor/target pair is blocked with `scope_mismatch`.
- The adapter operation must be declared by `adapter.operations` or the adapter must explicitly expose `*`.
- Missing target identifiers are blocked before adapter execution.

## Adapter rules

Adapters must expose `adapter_id`, `executor_type`, `status`, `operations`, and `execute()`.
Only adapters with `status=ready` may receive a dispatch.

## Output rules

Adapter output is returned only after a sensitive-output boundary check. Credential material, authorization headers, token-like secrets, API keys, passwords, and similarly sensitive fields are rejected. Rejection is normalized to:

```json
{"status":"blocked","reason":"sensitive_output_rejected"}
```

Adapter exceptions are normalized to `adapter_error` without propagating the original error text.

## Non-responsibilities

The boundary does not authorize requests, resolve secrets, write memory, persist state, retry providers, reroute candidates, or mutate registries.

## Required verification

- exact executor/target scope is enforced;
- unsupported operations are blocked;
- missing targets are blocked;
- adapter errors cannot leak original error text;
- sensitive output is rejected;
- non-sensitive usage metadata remains observable;
- existing UO-1 through UO-9 tests remain green.
