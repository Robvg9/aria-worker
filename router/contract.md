# ARIA Intelligent Router Contract v1.0.0

Mission 10.6. Control-plane declarative selection layer. No execution, no inference, no secrets, no mutation of registries.

```
Provider Registry (10.1)
        ↓
Model Registry (10.2)
        ↓
Capability Matrix (10.3)
        ↓
Account Manager (10.4)
        ↓
Quota / Capacity Manager (10.5)
        ↓
Intelligent Router (10.6)  ← this layer
```

## Purpose

Answer:

> Given a capability requirement and the current declarative state of the registries, which Provider → Account → Model combination (if any) may be selected?

This layer **selects**. It does **not** execute.

```
Request
   ↓
Capability requirement
   ↓
Model Registry
   ↓
Capability Matrix
   ↓
Account Manager
   ↓
Quota / Capacity Manager
   ↓
INTELLIGENT ROUTER
   ↓
Selected Provider + Account + Model   |   no_route
```

## Authority boundaries

| Concern | Authority | This layer |
|---|---|---|
| Provider identity | 10.1 / Model Registry seed | reads only |
| Model identity | Model Registry (10.2) | reads only |
| Capability support | Capability Matrix (10.3) | reads only |
| Account status | Account Manager (10.4) | reads only |
| Quota / capacity / rate-limit / usage | Quota/Capacity (10.5) | reads only |
| **Selection** | **this layer** | **owns** |
| Execution / inference / token consumption | future execution layer | nothing |
| Secrets / credentials | credential store | never |

## Input contract

Minimal:

```json
{
  "capability": "text_generation"
}
```

Optional filters (only when supplied; ignored when absent):

| Field | Type | Meaning |
|---|---|---|
| capability | string | Required. Canonical capability_id |
| preferred_model | string | Optional. Prefer this model_id when it is a valid candidate |
| preferred_provider | string | Optional. Prefer this provider_id when it is a valid candidate |
| preferred_account | string | Optional. Prefer this account_id when it is a valid candidate |

No other input fields are defined in 10.6. Do not invent requirements.

## Resolution pipeline (deterministic)

1. Validate input: `capability` must be a non-empty string. Otherwise → `no_route`.
2. Candidate models = models that **support** the capability via Capability Matrix (`supports(model_id, capability) === true`).
   - `null` or `false` from supports → excluded.
   - Capability id that appears in no row → empty candidate set → `no_route`.
3. For each candidate model:
   - Resolve `provider_id` from Model Registry.
   - Model status must be `available` (other statuses excluded).
4. Candidate accounts = accounts from Account Manager where:
   - `provider_id` matches,
   - `isAccountActive(account_id) === true`,
   - `model_refs` contains the model_id (when model_refs is present and non-empty).
5. Capacity / quota gate (per account+model via 10.5):
   - If any of `capacity.status`, `quota.status`, `rate_limit.status` is `unavailable` or `exhausted` → exclude.
   - If the entry is missing → exclude (cannot affirm usability).
   - If status is `unknown` → **exclude**.  
     Rationale (ChatBending / 10.5): `unknown ≠ available`. There is insufficient evidence to affirm the candidate can be used. The Router must not coerce unknown into selectable.
   - Only `available` (or future evidenced positive statuses) would pass the gate. No such seed exists today.
6. Remaining candidates are sorted deterministically by stable key:
   ```
   provider_id ASC | account_id ASC | model_id ASC
   ```
7. Optional preferred_* filters: if a preferred value is supplied and matches a remaining candidate, that candidate is chosen; otherwise the first after sort is chosen.
8. If zero candidates remain → `{ "status": "no_route" }`.
9. If one or more remain → select the first and emit the selected shape.

## Output contract

### Selected

```json
{
  "status": "selected",
  "provider_id": "openrouter",
  "account_id": "acct_openrouter_primary",
  "model_id": "google/gemini-2.5-flash-lite",
  "capability": "text_generation"
}
```

### No route

```json
{
  "status": "no_route"
}
```

No additional error codes, scoring objects, fallback chains, or diagnostic payloads are defined in 10.6. Reasons are not required in the wire shape.

## Behaviour for "unknown" (quota / capacity / rate_limit)

- `unknown` is **not** treated as available.
- `unknown` is **not** treated as exhausted/unavailable.
- Because the Router may only select a candidate when evidence affirms usability, a candidate whose capacity/quota/rate_limit status is `unknown` is **not selectable**.
- Consequently the verified seed (quota/capacity/rate_limit = unknown) yields `no_route` for every capability until capacity evidence is materialised in 10.5.

This is intentional and matches the 10.5 contract: “unknown ≠ available”.

## Determinism

- Same input + same registry state → identical output.
- No randomness, timestamps, wall-clock, external network, or unstable object-key order.
- Candidate ordering is explicit lexical sort on stable ids.

## Forbidden in 10.6

- Calling OpenRouter, Gemini, or any provider.
- Executing inference / sending prompts / consuming tokens.
- Mutating any registry, usage, or quota.
- Storing or reading secrets.
- Complex scoring, weights, or ML ranking.
- Retry engine, circuit breaker, failover, load balancer, adaptive routing.
- Duplicating provider / model / account / capability / quota records.
- Inventing capacity numbers or coercing `unknown` → available.

## Logical API

```js
route({ capability: "text_generation" }) → selected | no_route
```

Pure function. No side effects.

## Version

`aria-intelligent-router-v1.0.0`
