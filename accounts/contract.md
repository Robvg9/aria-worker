# ARIA Account Manager Contract v1.0.0

Mission 10.4. Control-plane declarative layer. No execution, no routing, no quota, no secrets.

```
Provider Registry (10.1)
        ↓
Model Registry (10.2)
        ↓
Capability Matrix (10.3)
        ↓
Account Manager (10.4)  ← this layer
        ↓
Quota/Capacity (10.5) → Intelligent Router (10.6)
```

## Purpose

Represent authorized access identities (accounts) so later Quota (10.5) and Router (10.6) can resolve **which account** may be used for a provider — without ever seeing the secret.

```
provider_id
    ↓
account_id
    ↓
model_id          (canonical ref only; owned by Model Registry)
    ↓
capability_refs   (owned by Capability Matrix / Model Registry)
```

## Account ≠ Credential

| Entity | Authority | This layer stores |
|---|---|---|
| Provider | Provider Registry (10.1) | `provider_id` only |
| Account | Account Manager (10.4) | identity + status + credential **reference** |
| Credential | Credential store (outside registries) | nothing — never the secret |
| Model | Model Registry (10.2) | `model_refs[]` of canonical `model_id` |
| Capability | Capability Matrix (10.3) | nothing — resolve via Model Registry |

An account is an access identity/configuration. The real credential lives outside this registry.

## Credential reference convention

ChatBending (10.15) requires `credential_ref` to identify a secret without exposing it. No literal URI scheme is canonized beyond that rule. This layer adopts:

```
secret://{provider_id}/{account_id}
```

Example (seed): `secret://openrouter/acct_openrouter_primary`

This matches the conceptual `secret://openrouter/account-1` form using the ChatBending-canonical account_id.

**Forbidden in this registry, tests, logs, and docs:** API keys, access tokens, refresh tokens, passwords, private keys, OAuth client secrets, and live credential values.

## Record shape

| Field | Type | Required | Notes |
|---|---|---|---|
| account_id | string | yes | Canonical stable ID |
| provider_id | string | yes | Logical FK to Provider Registry |
| credential_ref | string | yes | Reference only (`secret://…`) |
| status | string | yes | `active` \| `inactive` \| `revoked` \| `unknown` |
| model_refs | string[] | no | Canonical `model_id`s this account may serve; do not copy model records |
| metadata | object | no | Non-secret provenance / notes only |

## Status

| status | Meaning for later Router |
|---|---|
| `active` | Authorized and selectable (quota still unknown until 10.5) |
| `inactive` | Registered, not selectable |
| `revoked` | Authorization withdrawn |
| `unknown` | Preserved; never coerced to active/inactive |

`isAccountActive` is true **only** when a record exists and `status === "active"`. Missing / inactive / revoked / unknown → false.

Quota, rate-limit, last_error, last_used, cooldown and usage are **out of scope** (10.5).

## Rules

1. `account_id` is unique.
2. Multiple accounts MAY share the same `provider_id`.
3. Every `provider_id` MUST be a provider evidenced in ChatBending / Provider Registry seed (`openrouter`).
4. `model_refs`, when present, MUST exist in Model Registry. Do not copy capabilities here.
5. No secrets. Account ≠ credential.
6. No provider API calls, no inference, no model selection, no quota math, no routing, no fallback.
7. `unknown` is preserved; never coerced.
8. Only materialize accounts backed by ChatBending or physical seed.

## Logical queries

- `getAccount(account_id)` → record \| null
- `accountsForProvider(provider_id)` → list (empty when unknown)
- `isAccountActive(account_id)` → boolean
- `modelsOfAccount(account_id)` → `model_id[]` (canonical refs; empty when unknown)
- `credentialRefOf(account_id)` → string \| null (the reference, never the secret)

Missing entities return controlled, deterministic results (`null` / `[]` / `false`).

## Verified seed (Control Plane materialization 2026-08-31 + ChatBending)

- account_id: `acct_openrouter_primary`
- provider_id: `openrouter`
- credential_ref: `secret://openrouter/acct_openrouter_primary`
- status: `active`
- route evidenced: `openrouter → acct_openrouter_primary → google/gemini-2.5-flash-lite`

No second live account is seeded. No inactive production account is documented in ChatBending.

## Version

`aria-account-manager-v1.0.0`
