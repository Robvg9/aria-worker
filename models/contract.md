# ARIA Model Registry Contract v1.0.0

Mission 10.2. Control-plane interface layer. Memory plane unchanged.

```
Provider Registry (10.1)
        ↓
Model Registry (10.2)
        ↓
Capability Matrix (10.3)
        ↓
Account Manager → Quota → Router
```

## Purpose

Represent available models so the future Intelligent Router can select them without hard-coding model names in runtime logic.

## Universal fields

| Field | Type | Required | Notes |
|---|---|---|---|
| model_id | string | yes | Canonical ID (stable) |
| provider_id | string | yes | FK logical to Provider Registry |
| canonical_name | string | yes | Human / display name |
| upstream_model | string | yes | Provider-facing / upstream identifier |
| upstream_provider_id | string\|null | no | Origin provider when mediated (e.g. google via openrouter) |
| status | string | yes | `available` \| `deprecated` \| `unavailable` \| `unknown` |
| availability | string | yes | `public` \| `restricted` \| `internal` \| `unknown` |
| metadata | object | no | Non-secret selection hints for Router |
| capability_refs | string[] | no | Placeholder for 10.3; empty until Capability Matrix |

## Rules

1. Every model belongs to exactly one provider_id.
2. model_id is unique.
3. No API keys, tokens, secrets or credentials.
4. Do not invent models; only document verified ones.
5. `unknown` is preserved; never coerced to false/available.
6. Model Registry does not execute models, write memory, or store accounts.
7. Provider Registry remains authoritative for provider identity.

## Relation queries (logical)

- models_by_provider(provider_id) → list of model records
- provider_of(model_id) → provider_id
- get_model(model_id) → record | null

## Verified seed (from Control Plane materialization 2026-08-31)

- provider_id: `openrouter`
- model_id: `google/gemini-2.5-flash-lite`
- upstream_provider_id: `google`
- status: available
- capability_refs: ready for 10.3 (`text_generation` already evidenced elsewhere)

## Versioning

`aria-model-registry-v1.0.0`
