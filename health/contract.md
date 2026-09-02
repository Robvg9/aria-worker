# ARIA Health / Availability Manager — Mission 10.11

Design-controlled declarative contract.

## Scope

Answers only whether ARIA has **observed evidence** about the health/availability of a provider, model, or account. It does not execute providers, mutate quota/capacity, select routes, or perform fallback.

## Authority and evidence

- `unknown` is the safe default when no health observation exists.
- A registry entry is not proof of live availability.
- Live observation is dependency-injected; this repository does not perform a network call by itself.
- Evidence must identify its source and observation time when known.
- An observation is evidence, not execution authorization.

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

## Observation boundary

`observe(filter, probeFn)` accepts a dependency-injected probe. The probe owns transport/protocol details; Health owns normalization and safe interpretation. If no probe is configured, the result remains `unknown`/`probe_not_configured`. Malformed or incomplete evidence becomes `insufficient_evidence` rather than a positive state.

## Semantics

- `unknown` means there is insufficient evidence; it is neither success nor failure.
- `healthy` does not grant permission to execute.
- `available` does not grant permission to execute.
- Health/availability does not override 10.5 quota/capacity, 10.6 routing, 10.7 fallback, 10.8 execution, or 10.12 governance rules.
- The observation boundary may be used by a future live-probe service, but this mission does not enable one.

## Required invariants

1. No implicit provider/network calls.
2. No credential resolution.
3. No mutation of other registries.
4. No routing authority.
5. No fallback authority.
6. No memory writes.
7. Missing records return `null` or `[]`.
8. Unknown values remain `unknown` and are never converted to `available`/`healthy` by inference.
9. Errors and evidence are sanitized; secret-looking values never become output data.
