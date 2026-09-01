# ARIA Quota / Capacity Manager Contract v1.0.0

Mission 10.5. Control-plane declarative layer. No execution, no routing, no billing, no secrets.

```
Provider Registry (10.1)
        ↓
Account Manager (10.4)
        ↓
Model Registry (10.2)
        ↓
Capability Matrix (10.3)
        ↓
Quota / Capacity Manager (10.5)  ← this layer
        ↓
Intelligent Router (10.6)
```

## Purpose

Represent **known** capacity and operational restrictions of an account / provider / model so 10.6 can later *read* them.

This layer answers:

> “this account/model has this known capacity/quota”

It does **not** answer:

> “use this account instead of that one”

That decision belongs to the Intelligent Router (10.6).

## Planes (do not mix)

| Plane | Authority | This layer stores |
|---|---|---|
| Account | Account Manager (10.4) | `account_id` only |
| Provider | Provider Registry (10.1) | `provider_id` only |
| Model | Model Registry (10.2) | `model_id` only |
| Capability | Capability Matrix (10.3) | nothing |
| **Quota** | this layer | known limit configuration (`unknown` if unevidenced) |
| **Capacity** | this layer | known capacity status (`unknown` if unevidenced) |
| **Usage** | this layer (schema only) | observed consumption; **never simulated** |
| Routing | Intelligent Router (10.6) | nothing |

## Known limits vs observed usage

**Configuration / known limit** (declarative, static until evidenced):

- documented limit
- requests/minute
- tokens/minute
- requests/day
- tokens/day
- concurrency
- max known capacity
- quota window

**Observed usage** (dynamic; not invented):

- requests consumed
- tokens consumed
- remaining
- reset time

If a value is not backed by ChatBending or a physical seed, it is `null` and its `status` is `unknown`.

Do **not** mix static limits with live metrics in the same field.

## Record shape

| Field | Type | Required | Notes |
|---|---|---|---|
| provider_id | string | yes | Canonical ref to Provider Registry |
| account_id | string | yes | Canonical ref to Account Manager |
| model_id | string | yes | Canonical ref to Model Registry |
| quota | object | yes | Known-limit configuration |
| quota.status | string | yes | see Status |
| quota.limits | object \| null | yes | Shape below when known; `null` when unknown |
| capacity | object | yes | Known capacity |
| capacity.status | string | yes | see Status |
| capacity.max_known | number \| null | yes | `null` when unknown |
| rate_limit | object | yes | Known rate-limit configuration |
| rate_limit.status | string | yes | see Status |
| rate_limit.limits | object \| null | yes | `null` when unknown |
| usage | object | yes | Dynamic slot; not an ingestion system |
| usage.status | string | yes | `unknown` until observed |
| usage.requests_consumed | number \| null | yes | `null` when unknown |
| usage.tokens_consumed | number \| null | yes | `null` when unknown |
| usage.remaining | number \| null | yes | `null` when unknown |
| usage.reset_at | string \| null | yes | ISO-8601 or `null` |
| metadata | object | no | Non-secret provenance only |

When `quota.limits` or `rate_limit.limits` is an object (only with evidence), allowed keys are:

`requests_per_minute`, `tokens_per_minute`, `requests_per_day`, `tokens_per_day`, `concurrency`, `max_capacity`, `window`.

Absent evidence → the whole `limits` object is `null`. Do not fill keys with guessed numbers.

## Status

Canonical statuses for this layer (ChatBending):

| status | Meaning |
|---|---|
| `unknown` | No verified evidence. **Never** coerced to 0, available, or exhausted. |
| `known` | A documented numeric/config limit exists (with evidence). |
| `available` | Evidence shows remaining capacity; never inferred from `unknown`. |
| `unavailable` | Evidence shows capacity is not usable. |
| `exhausted` | Evidence shows the quota is spent. |

`unknown ≠ 0`. `unknown ≠ available`. `quota unknown` does not become usable capacity.

Do not invent extra statuses (including `unlimited`) without ChatBending evidence.

## Distinctions (named, not implemented here)

ChatBending (Visión Maestra §14 / 10.15) requires distinguishing these concerns. 10.5 **names** them so they are not collapsed; it does **not** implement them:

- API limit, project quota, account quota, rate limit → this layer (when evidenced)
- billing limit → **out of scope** (not a billing system)
- transient error, invalid credential, insufficient permissions → Account / Policy / future Health; not quota numbers

## Rules

1. Every `account_id` MUST exist in Account Manager.
2. Every `model_id` MUST exist in Model Registry.
3. Every `provider_id` MUST be a Provider Registry seed (`openrouter`).
4. Do not copy provider / account / model / capability records.
5. No secrets, API keys, tokens, or credential values.
6. Do not invent RPM, TPM, RPD, TPD, concurrency, prices, remaining, or reset times.
7. Do not simulate usage (`used: 5` / `remaining: 95` is forbidden without observation).
8. No metrics ingestion runtime in 10.5.
9. No router, fallback, account selection, or execution logic.
10. `unknown` is preserved; never coerced.
11. Only materialize rows backed by ChatBending or the physical seed.

## Logical queries

- `getCapacity(account_id)` → capacity projection \| null
- `getQuota(account_id)` → quota projection \| null
- `getCapacityForModel(model_id)` → list (empty when unknown)
- `getQuotaForModel(model_id)` → list (empty when unknown)

Missing entities return controlled, deterministic results (`null` / `[]`).

## Verified seed (Control Plane materialization 2026-08-31 + ChatBending)

ChatBending `aria_internal.quota_registry` has **one** row:

- account_id: `acct_openrouter_primary`
- provider_id: `openrouter`
- model_id: `google/gemini-2.5-flash-lite`
- quota status: `unknown`
- capacity status: `unknown`
- rate_limit status: `unknown`
- usage status: `unknown`
- limits, usage numbers, capacity max, rate-limit numbers: **null**

No OpenRouter or Gemini numeric quota was evidenced. None is materialized.

## Prepared for 10.6

The Router may consult account, model, capability, capacity, and quota. 10.5 does not choose a route.

## Version

`aria-quota-capacity-v1.0.0`
