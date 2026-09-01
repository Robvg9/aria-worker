# ARIA Capability Matrix Contract v1.0.0

Mission 10.3. Control-plane declarative layer. No execution, no routing, no accounts, no quota.

```
Provider Registry (10.1)
        ↓
Model Registry (10.2)
        ↓
Capability Matrix (10.3)  ← this layer
        ↓
Account Manager (10.4) → Quota → Router
```

## Purpose

Represent which capabilities each model supports so the future Intelligent Router can filter candidates without hard-coding capability names.

## Canonical capability IDs

Only IDs already evidenced in ChatBending / physical seed are allowed.

| capability_id | Meaning (lab) |
|---|---|
| `text_generation` | Generate text / complete prompts (verified for the seed model) |

Do **not** invent synonyms (`text`, `generate_text`, etc.).

## Record shape

| Field | Type | Required | Notes |
|---|---|---|---|
| capability_id | string | yes | Canonical stable ID |
| model_id | string | yes | FK logical to Model Registry |
| status | string | yes | `verified` \| `claimed` \| `unknown` \| `unsupported` |
| evidence | string\|null | no | Provenance of the claim |
| metadata | object | no | Non-secret hints only |

## Rules

1. capability_id is unique within a model (no duplicate rows for same model+capability).
2. Model Registry holds `capability_refs: string[]` pointing to capability_id values.
3. Capability Matrix owns the status/evidence; Model Registry only holds references.
4. `unknown` is preserved; never coerced to verified/unsupported.
5. No secrets, tokens, API keys, or credentials.
6. No router selection logic, no account logic, no quota logic.
7. Only materialize capabilities backed by ChatBending or physical seed.

## Logical queries

- capabilitiesOf(model_id) → list of capability records
- modelsByCapability(capability_id) → list of model_ids
- supports(model_id, capability_id) → boolean | null (null when unknown)

## Verified seed (2026-08-31 materialization + ChatBending)

- model: `google/gemini-2.5-flash-lite`
- capability: `text_generation` status=`verified`

## Version

`aria-capability-matrix-v1.0.0`
