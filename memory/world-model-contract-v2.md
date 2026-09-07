# ARIA World Model 2.0 — Contract

Version: `world-model-v2.0.0`

## Purpose

Represent the operational world as a provenance-aware graph:

`ENTITIES → STATE → RELATIONSHIPS → EVENTS → CAUSES → DEPENDENCIES`

## Guarantees

- Every operational entity, relationship, event, cause and dependency carries explicit provenance and bounded confidence.
- Unknown state remains `unknown`; the World Model never infers availability or truth from missing evidence.
- Dependency traversal is deterministic, bounded and cycle-safe.
- `impactOf(entity)` traverses reverse dependencies and returns affected entities with paths and propagated confidence.
- `causeChain(event)` returns bounded causal ancestry with evidence confidence.
- State observations become explicit events and preserve previous/current state transitions.
- Stable IDs/hashes are deterministic and do not require wall-clock time or randomness.
- Secret values are never required by the model; references such as `ref:...` may identify protected material without storing it.
- The World Model is descriptive/read-only for governance purposes. It does not authorize execution or grant permissions.

## Canonical dependency semantics

`from --depends_on/type--> to` means **from depends on to**. Reverse traversal from `to` produces the potentially impacted dependents.

## Canonical reasoning

Given `worker → depends_on → function → writes_to → database`, a change to `function` must surface the worker and database as affected when those links are explicitly represented.

## Fail-closed boundaries

Malformed identifiers, invalid confidence, missing provenance, self-dependencies and invalid self-relationships are rejected. Missing graph references are reported by `integrity()` instead of silently repaired.
