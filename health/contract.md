# ARIA Health / Availability Manager — Mission 10.11

Design-controlled declarative contract.

## Scope

Answers only whether ARIA has **observed evidence** about the health/availability of a provider, model, or account. It does not execute providers, mutate quota/capacity, select routes, or perform fallback.

## Authority and evidence

- `unknown` is the safe default when no health observation exists.
- A registry entry is not proof of live availability.
- No live probes are performed by this layer.
- Evidence must identify its source and observation time when known.

## Record shape

```json
{
  "provider_id": "string|null",
  "model_id": "string|null",
  "account_id": "string|null",
  "health": {
    "status": "unknown|healthy|degraded|unavailable",
    "observed_at": "string|null",
    "source": "string|null",
    "evidence_ref": "string|null",
    "last_error": "string|null"
  },
  "availability": {
    "status": "unknown|available|unavailable",
    "observed_at": "string|null",
    "source": "string|null",
    "evidence_ref": "string|null"
  }
}
```

## Semantics

- `unknown` means there is insufficient evidence; it is neither success nor failure.
- `healthy` does not grant permission to execute.
- `available` does not grant permission to execute.
- Health/availability does not override 10.5 quota/capacity, 10.6 routing, 10.7 fallback, or 10.8 execution rules.
- This mission provides a controlled schema and pure lookups only. Live observation belongs to a later operational layer.

## Required invariants

1. No provider/network calls.
2. No credential resolution.
3. No mutation of other registries.
4. No routing authority.
5. No fallback authority.
6. No memory writes.
7. Missing records return `null` or `[]`.
8. Unknown values remain `unknown` and are never converted to `available`/`healthy` by inference.
