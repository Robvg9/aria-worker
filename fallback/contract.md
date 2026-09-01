# ARIA Fallback Engine Contract v1.0.0

Mission 10.7. Control-plane declarative alternative-selection layer. No execution, no inference, no secrets, no mutation of registries.

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
Intelligent Router (10.6)
        ↓
Fallback Engine (10.7)  ← this layer
```

## Purpose

Decide what to do when the **primary** route selected by Intelligent Router (10.6) cannot be used.

```
Request
   ↓
Intelligent Router
   ↓
Primary Candidate
   ↓
¿Puede ejecutarse?
   ├── sí → primary
   └── no
        ↓
     Fallback Engine
        ↓
     siguiente candidato válido   |   no_fallback
```

This layer **selects an alternative**. It does **not** execute. It does **not** retry. It does **not** rotate accounts to evade limits.

## Authority boundaries

| Concern | Authority | This layer |
|---|---|---|
| Provider identity | 10.1 / Model Registry seed | reads only |
| Model identity | Model Registry (10.2) | reads only |
| Capability support | Capability Matrix (10.3) | reads only |
| Account status | Account Manager (10.4) | reads only |
| Quota / capacity / rate-limit | Quota/Capacity (10.5) | reads only |
| Primary selection | Intelligent Router (10.6) | consumes; does not re-implement |
| **Alternative selection** | **this layer** | **owns** |
| Execution / inference / token consumption | future Execution Engine | nothing |
| Policy / governance | Policy Engine (design 10.11; **not physical**) | consume input if present; never invent |
| Secrets / credentials | credential store | never |
| Memory | ChatBending / CAPTURE→GATE→COMMIT→SYNC | none |

```
Policy ≠ Fallback
Fallback ≠ Execution
Fallback ≠ Memory Authority
Fallback ≠ Credential Store
Fallback ≠ Router
```

## Consume 10.6 — do not duplicate the Router

10.6 answers: which primary route, if any, may be selected.

10.7 answers: given that primary (or its failure), which **next** already-registered, already-authorized candidate may be used.

Input is the 10.6 result:

```json
{
  "status": "selected",
  "provider_id": "openrouter",
  "account_id": "acct_openrouter_primary",
  "model_id": "google/gemini-2.5-flash-lite",
  "capability": "text_generation"
}
```

or:

```json
{ "status": "no_route" }
```

`no_route` means 10.6 already found zero usable primaries. 10.7 does not invent a route the Router rejected. Result: `no_fallback`.

## Input contract

```json
{
  "router_result": { "status": "selected|no_route", "provider_id": "", "account_id": "", "model_id": "", "capability": "" },
  "capability": "text_generation",
  "preferred_provider": "optional",
  "preferred_account": "optional",
  "preferred_model": "optional",
  "failure": { "kind": "provider_unavailable" },
  "visited": [],
  "policy": null
}
```

| Field | Type | Meaning |
|---|---|---|
| router_result | object | 10.6 output. If omitted, 10.7 calls `route()` (read-only). |
| capability | string | Required when router_result does not carry it. |
| preferred_* | string | Optional. Same semantics as 10.6: apply only if the preferred candidate remains valid. Never force an invalid candidate. |
| failure.kind | string | Why the primary cannot be used. See Activations. |
| visited | array | Candidate keys already attempted. Anti-loop. |
| policy | object \| omitted | Optional policy input. See Policy. |

No other input fields are defined in 10.7. Do not invent requirements.

## Activations (not equivalent)

Fallback **activates** only when the primary cannot be used. Each kind has its own exclusion rule. They are not interchangeable.

| kind | Activates fallback? | Exclusion of alternatives | Notes |
|---|---|---|---|
| `provider_unavailable` | yes | same `provider_id` | other authorized providers may be used |
| `account_unavailable` | yes | same `account_id` | other active accounts of allowed providers |
| `credential_failure` | yes | same `account_id` | other accounts with a `credential_ref`; never read the secret |
| `quota_exhausted` | yes | same `account_id` | other accounts with **their own** usable quota. Not evasion of the exhausted quota. |
| `rate_limit` | **only when policy explicitly allows** | same `account_id` | Default **deny**. Must not be used to evade rate limits. |
| `capacity_unavailable` | yes | same candidate | other candidates with evidenced capacity |
| `execution_failure` | yes | same candidate | declarative next candidate only; no retry of the same route |
| `policy_rejection` | yes, for **other** candidates | same candidate | if policy rejects fallback itself → `no_fallback` |

Unknown `failure.kind` is **not** assumed equivalent to a known kind → `no_fallback`.

A missing `failure` still activates fallback when the primary fails the 10.3–10.5 gates on re-evaluation (account inactive, capacity unknown/unavailable/exhausted, capability not verified, missing credential_ref).

## Fundamental rule

An alternative is **not** valid merely because it exists.

It must satisfy **all** of:

1. provider allowed (registered; not excluded by activation)
2. account active (`status === active`; `status != active` is never selectable)
3. model available in Model Registry
4. required capability **verified** (`supports === true`; `null`/`false` excluded)
5. capacity usable (10.5 / 10.6 `capacityAllows`)
6. quota usable (same gate)
7. credential authorized (`credential_ref` present as a reference, never a secret)
8. policy does not reject it

Only then is it a valid fallback.

## `unknown` behaviour

Inherited from 10.5 / 10.6 and unchanged:

- `unknown ≠ available`
- `unknown ≠ 0`
- A candidate whose capacity/quota/rate_limit status is `unknown` is **not** selectable as fallback.
- Missing capacity/quota evidence → not selectable.
- Fallback must not coerce unknown into a valid option just because it is an alternative.

## Selection pipeline (deterministic)

1. Resolve primary from `router_result` or by calling 10.6 `route()` (pure, no side effects).
2. If primary `status !== selected` → `{ "status": "no_fallback" }`.
3. If primary is still executable (no blocking failure **and** 10.3–10.5 gates pass) → `{ "status": "primary", ... }`. Stop. No alternative is considered.
4. If activation does not allow fallback (`rate_limit` without explicit permit, `policy.allow_fallback === false`, unknown kind) → `{ "status": "no_fallback" }`.
5. Candidate pool = 10.6 `collectCandidates(capability)` (does not duplicate registries).
6. Exclude, in order:
   1. policy unauthorized / `allow_fallback === false`
   2. invalid / incomplete candidate records
   3. resources not authorized (inactive account, missing `credential_ref`, leaked-secret-shaped ref)
   4. capacity/quota blocked (`unknown` / `unavailable` / `exhausted` / missing)
   5. capability not verified for the **required** capability
   6. visited keys (anti-loop) and the current primary
   7. activation-specific exclusion (same provider / account / candidate)
7. Remaining candidates sorted by stable key:
   ```
   provider_id ASC | account_id ASC | model_id ASC
   ```
8. Optional preferred_* : if a preferred value matches a remaining candidate, restrict to that subset; otherwise ignore the preference.
9. First remaining → `{ "status": "fallback", ... }`.
10. Zero remaining → `{ "status": "no_fallback" }`.

No scoring. No random. No timestamps. No accidental object-key order.

## Output contract

### PRIMARY VALID

```json
{
  "status": "primary",
  "provider_id": "openrouter",
  "account_id": "acct_openrouter_primary",
  "model_id": "google/gemini-2.5-flash-lite",
  "capability": "text_generation"
}
```

### FALLBACK SELECTED

```json
{
  "status": "fallback",
  "provider_id": "openrouter",
  "account_id": "acct_openrouter_secondary",
  "model_id": "google/gemini-2.5-flash-lite",
  "capability": "text_generation"
}
```

### NO FALLBACK

```json
{
  "status": "no_fallback"
}
```

No additional error codes are defined in 10.7. Reasons are not required in the wire shape.

## Fallback chain (declarative only)

```
Primary
   ↓ fail
Fallback 1
   ↓ fail
Fallback 2
   ↓ fail
NO FALLBACK
```

10.7 resolves **one** next candidate per call. It does not execute, retry, or sleep.

The caller (future Execution / Orchestration) may call again with:

- `router_result` set to the failed fallback (as the new "primary" of this step)
- `visited` containing every previously attempted candidate key
- the same `failure` / `capability` / preferences

There is **no** retry engine in 10.7. ChatBending does not define a numeric retry limit for this layer; none is invented.

## Anti-loop

Candidate key:

```
provider_id + "|" + account_id + "|" + model_id
```

- The current primary is always treated as visited for this call.
- Any key in `visited` is excluded.
- Therefore `A → B → A` cannot occur: after `A → B`, a subsequent call with `visited: ["A|..."]` will not return A.
- Same input + same visited + same registry state → same result.
- No random, no wall-clock, no external data.

## Policy

**POLICY INPUT NOT IMPLEMENTED**

The Policy / Governance Engine (10.11) is design-only. 10.7 does **not** implement a Policy Engine.

- If `policy` is omitted: no permissions are invented. Technical gates (10.3–10.5, account, credential_ref) still apply. `rate_limit` fallback remains denied until explicitly allowed.
- If `policy.allow_fallback === false`: result is `no_fallback`.
- If `policy.allow_rate_limit_fallback === true`: `rate_limit` may consider other accounts.
- If `policy.unauthorized` lists candidate keys/objects: those candidates are excluded.
- A preference never overrides policy or safety gates.

Selecting a declarative fallback **is not** authorization to execute. Execution remains behind future Execution Engine + Human Gate (10.12). `fallback` ≠ `approved_to_execute`.

## Forbidden in 10.7

- Calling OpenRouter, Gemini, or any provider.
- Executing inference / sending prompts / consuming tokens.
- Mutating any registry, usage, or quota.
- Storing or reading secrets.
- Using fallback to evade rate limits, quotas, provider restrictions, or policy.
- Abusive account hopping / illegal account rotation.
- Hiding errors.
- Complex scoring, weights, ML ranking, random, timestamps.
- Retry engine, circuit breaker, load balancer.
- Duplicating provider / model / account / capability / quota records.
- Inventing capacity numbers or coercing `unknown` → available.
- Creating accounts or credentials.
- Implementing a new Policy Engine, Router, Account Manager, Quota Manager, or Memory system.

## Logical API

```js
resolve({ router_result, failure, visited, policy, capability, preferred_* })
  → primary | fallback | no_fallback
```

Pure function. No side effects.

## Version

`aria-fallback-v1.0.0`
